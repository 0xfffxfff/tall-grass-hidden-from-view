// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TallGrass} from "../src/TallGrass.sol";
import {TallGrassMetadata} from "../src/TallGrassMetadata.sol";
import {Roles} from "../src/libraries/Roles.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";

contract MockVerifier is IVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

contract TallGrassMetadataTest is Test {
    TallGrass public tg;
    TallGrassMetadata public metadata;

    address internal owner = address(0xABCD);
    address internal editor = address(0xED17);
    address internal alice = address(0x1);
    uint256 internal oracleKey = 0xA11CE;
    address internal oracleAddr;

    function setUp() public {
        oracleAddr = vm.addr(oracleKey);

        MockVerifier mv = new MockVerifier();

        tg = new TallGrass(
            bytes32(uint256(0xdead)),  // seedCommitment
            bytes32(uint256(0xbeef)),  // terrainMerkleRoot
            bytes32(uint256(0xcafe)),  // entityTraitMerkleRoot
            bytes32(uint256(0xfeed)),  // entityMerkleRoot
            32, 32, 32,               // grid, supply
            0.2 ether,                 // mintPrice
            address(mv),
            address(mv),              // entityMovementVerifier
            address(mv),              // encounterVerifier
            bytes32(0),               // decryptionKeyCommitment
            bytes32(0),               // traitModuliCommitment
            owner
        );

        vm.prank(owner);
        tg.grantRoles(oracleAddr, Roles.ORACLE);

        metadata = new TallGrassMetadata(address(tg));

        vm.startPrank(owner);
        tg.setMetadataContract(address(metadata));
        tg.grantRoles(editor, Roles.EDITOR);
        vm.stopPrank();
    }

    // --- Access control ---------------------------------------------------

    function test_onlyEditor_owner() public {
        vm.prank(owner);
        metadata.setSharedDescription("test");
    }

    function test_onlyEditor_editor() public {
        vm.prank(editor);
        metadata.setSharedDescription("test");
    }

    function test_onlyEditor_revert_unauthorized() public {
        vm.prank(alice);
        vm.expectRevert("Unauthorized");
        metadata.setSharedDescription("test");
    }

    // --- Ciphertext (SSTORE2 chunked) ------------------------------------

    function test_setCiphertextPart_single() public {
        bytes memory data = hex"deadbeef0102030405060708";

        vm.prank(owner);
        metadata.setCiphertextPart(0, data, 0);

        assertEq(metadata.getCiphertext(0), data);
        assertEq(metadata.ciphertextHash(0), keccak256(data));
        assertEq(metadata.ciphertextPartsCount(0), 1);
    }

    function test_setCiphertextPart_multiChunk() public {
        bytes memory chunk0 = hex"aaaa";
        bytes memory chunk1 = hex"bbbb";

        vm.startPrank(owner);
        metadata.setCiphertextPart(0, chunk0, 0);
        metadata.setCiphertextPart(0, chunk1, 1);
        vm.stopPrank();

        bytes memory expected = abi.encodePacked(chunk0, chunk1);
        assertEq(metadata.getCiphertext(0), expected);
        assertEq(metadata.ciphertextHash(0), keccak256(expected));
        assertEq(metadata.ciphertextPartsCount(0), 2);
    }

    function test_setCiphertextPart_overwrite() public {
        bytes memory original = hex"aaaa";
        bytes memory replacement = hex"cccc";

        vm.startPrank(owner);
        metadata.setCiphertextPart(0, original, 0);
        metadata.setCiphertextPart(0, replacement, 0);
        vm.stopPrank();

        assertEq(metadata.getCiphertext(0), replacement);
    }

    function test_setCiphertextPart_revert_invalid_index() public {
        vm.prank(owner);
        vm.expectRevert("Invalid index");
        metadata.setCiphertextPart(0, hex"aa", 5); // gap
    }

    function test_ciphertextHash_empty() public view {
        assertEq(metadata.ciphertextHash(0), bytes32(0));
    }

    // --- Description -----------------------------------------------------

    function test_sharedDescription() public {
        vm.prank(owner);
        metadata.setSharedDescription("A shared description");

        assertEq(metadata.description(0), "A shared description");
        assertEq(metadata.description(1), "A shared description");
    }

    function test_tokenDescription_override() public {
        vm.startPrank(owner);
        metadata.setSharedDescription("shared");
        metadata.setTokenDescription(0, "specific to entity 0");
        vm.stopPrank();

        assertEq(metadata.description(0), "specific to entity 0");
        assertEq(metadata.description(1), "shared");
    }

    function test_description_empty() public view {
        assertEq(metadata.description(0), "");
    }

    // --- Per-entity image (raw JPEG bytes) ------------------------------

    function test_setEntityImagePart_roundtrip() public {
        bytes memory jpg = hex"ffd8ffe000104a46494600010100";

        vm.prank(owner);
        metadata.setEntityImagePart(0, jpg, 0);

        assertEq(metadata.getEntityImage(0), jpg);
        assertEq(metadata.entityImagePartsCount(0), 1);
    }

    function test_entityImageDataUrl_empty() public view {
        assertEq(metadata.entityImageDataUrl(0), "");
    }

    function test_entityImageDataUrl_prefix() public {
        vm.prank(owner);
        metadata.setEntityImagePart(0, hex"ffd8ff", 0);

        bytes memory url = bytes(metadata.entityImageDataUrl(0));
        bytes memory prefix = bytes("data:image/jpeg;base64,");
        for (uint256 i; i < prefix.length; i++) {
            assertEq(url[i], prefix[i]);
        }
    }

    // --- Inlined HTML viewer ---------------------------------------------

    function test_entityHtml_assembly() public {
        vm.startPrank(owner);
        metadata.setHtmlHeadPart(bytes("<html><head></head><body>"), 0);
        metadata.setHtmlScriptPart(bytes("<script>console.log(window.__TG_ID)</script>"), 0);
        metadata.setHtmlTailPart(bytes("</body></html>"), 0);
        vm.stopPrank();

        bytes memory html = metadata.entityHtml(7);
        // Per-token id-injection script is wedged between head and script.
        assertEq(
            string(html),
            "<html><head></head><body><script>window.__TG_ID=7;</script><script>console.log(window.__TG_ID)</script></body></html>"
        );
    }

    function test_entityHtmlDataUrl_prefix() public {
        vm.prank(owner);
        metadata.setHtmlHeadPart(bytes("<html>"), 0);

        bytes memory url = bytes(metadata.entityHtmlDataUrl(0));
        bytes memory prefix = bytes("data:text/html;base64,");
        for (uint256 i; i < prefix.length; i++) {
            assertEq(url[i], prefix[i]);
        }
    }

    // --- Collection Image ------------------------------------------------

    function test_setCollectionImagePart() public {
        vm.startPrank(owner);
        metadata.setCollectionImagePart("data:image/png;base64,part0", 0);
        metadata.setCollectionImagePart("...continued", 1);
        vm.stopPrank();

        assertEq(metadata.collectionImagePartsCount(), 2);
    }

    // --- External Link ---------------------------------------------------

    function test_setExternalLink() public {
        vm.prank(owner);
        metadata.setExternalLink("https://tallgrass.art");

        assertEq(metadata.externalLink(), "https://tallgrass.art");
    }

    // --- tokenURI --------------------------------------------------------

    function test_tokenURI_format() public {
        vm.startPrank(owner);
        metadata.setSharedDescription("A test description");
        metadata.setHtmlHeadPart(bytes("<html>"), 0);
        metadata.setHtmlScriptPart(bytes("<script>1</script>"), 0);
        metadata.setHtmlTailPart(bytes("</html>"), 0);
        vm.stopPrank();

        string memory uri = metadata.tokenURI(0);
        // Should be a base64 data URI
        assertTrue(bytes(uri).length > 0);
        // Verify it starts with the expected prefix
        bytes memory prefix = bytes("data:application/json;base64,");
        bytes memory uriBytes = bytes(uri);
        for (uint256 i; i < prefix.length; i++) {
            assertEq(uriBytes[i], prefix[i]);
        }
    }

    function test_tokenURI_with_ciphertext() public {
        vm.startPrank(owner);
        metadata.setCiphertextPart(0, hex"deadbeef", 0);
        vm.stopPrank();

        // Should include ciphertext_hash attribute
        string memory uri = metadata.tokenURI(0);
        assertTrue(bytes(uri).length > 0);
    }

    // --- contractURI -----------------------------------------------------

    function test_contractURI() public {
        vm.startPrank(owner);
        metadata.setSharedDescription("Collection description");
        metadata.setExternalLink("https://tallgrass.art");
        vm.stopPrank();

        string memory uri = metadata.contractURI();
        assertTrue(bytes(uri).length > 0);
        // Verify it starts with the expected prefix
        bytes memory prefix = bytes("data:application/json;base64,");
        bytes memory uriBytes = bytes(uri);
        for (uint256 i; i < prefix.length; i++) {
            assertEq(uriBytes[i], prefix[i]);
        }
    }
}
