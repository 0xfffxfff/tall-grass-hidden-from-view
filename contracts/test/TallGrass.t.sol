// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TallGrass} from "../src/TallGrass.sol";
import {TallGrassMetadata} from "../src/TallGrassMetadata.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {Roles} from "../src/libraries/Roles.sol";

/// @dev Mock verifier that always returns true (for unit testing contract logic).
contract MockVerifier is IVerifier {
    bool public shouldVerify = true;

    function setVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return shouldVerify;
    }
}

contract TallGrassTest is Test {
    TallGrass public tg;
    TallGrassMetadata public metadata;
    MockVerifier public mockMovementVerifier;
    MockVerifier public mockEntityMovementVerifier;
    MockVerifier public mockEncounterVerifier;

    uint256 internal oracleKey = 0xA11CE;
    address internal oracleAddr;
    address internal owner = address(0xABCD);
    address internal alice = address(0x1);
    address internal bob = address(0x2);

    bytes32 constant SEED_COMMITMENT = bytes32(uint256(0xdead));
    bytes32 constant TERRAIN_ROOT = bytes32(uint256(0xbeef));
    bytes32 constant ENTITY_TRAIT_ROOT = bytes32(uint256(0xcafe));
    bytes32 constant ENTITY_ROOT = bytes32(uint256(0xfeed));
    uint256 constant GRID_WIDTH = 32;
    uint256 constant GRID_HEIGHT = 32;
    uint256 constant TOTAL_SUPPLY = 32;
    uint256 constant MINT_PRICE = 0.2 ether;

    function setUp() public {
        oracleAddr = vm.addr(oracleKey);

        mockMovementVerifier = new MockVerifier();
        mockEntityMovementVerifier = new MockVerifier();
        mockEncounterVerifier = new MockVerifier();

        tg = new TallGrass(
            SEED_COMMITMENT,
            TERRAIN_ROOT,
            ENTITY_TRAIT_ROOT,
            ENTITY_ROOT,
            GRID_WIDTH,
            GRID_HEIGHT,
            TOTAL_SUPPLY,
            MINT_PRICE,
            address(mockMovementVerifier),
            address(mockEntityMovementVerifier),
            address(mockEncounterVerifier),
            bytes32(0),
            owner
        );

        // Grant ORACLE role to oracleAddr
        vm.prank(owner);
        tg.grantRoles(oracleAddr, Roles.ORACLE);

        metadata = new TallGrassMetadata(address(tg));

        vm.prank(owner);
        tg.setMetadataContract(address(metadata));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _oracleSign(bytes32 digest) internal view returns (bytes memory) {
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _registerAlice(bytes32 commitment) internal {
        bytes32 digest = keccak256(abi.encodePacked(alice, commitment));
        bytes memory sig = _oracleSign(digest);
        vm.prank(alice);
        tg.register(commitment, sig);
    }

    function _registerAndDeposit(address who, bytes32 commitment, uint256 depositAmount) internal {
        bytes32 regDigest = keccak256(abi.encodePacked(who, commitment));
        bytes memory regSig = _oracleSign(regDigest);
        vm.prank(who);
        tg.register(commitment, regSig);

        vm.deal(who, depositAmount);
        vm.prank(who);
        tg.deposit{value: depositAmount}();
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    function test_register() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAlice(commitment);

        assertTrue(tg.isParticipant(alice));
        assertEq(tg.positionCommitments(alice), commitment);
    }

    function test_register_revert_already_registered() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAlice(commitment);

        bytes32 digest = keccak256(abi.encodePacked(alice, commitment));
        bytes memory sig = _oracleSign(digest);
        vm.prank(alice);
        vm.expectRevert(TallGrass.AlreadyRegistered.selector);
        tg.register(commitment, sig);
    }

    function test_register_revert_bad_signature() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        // Sign with wrong key
        uint256 wrongKey = 0xBAD;
        bytes32 digest = keccak256(abi.encodePacked(alice, commitment));
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(alice);
        vm.expectRevert(TallGrass.InvalidSignature.selector);
        tg.register(commitment, sig);
    }

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------

    function test_move() public {
        bytes32 oldCommitment = bytes32(uint256(0x1234));
        bytes32 newCommitment = bytes32(uint256(0x5678));
        _registerAlice(oldCommitment);

        vm.prank(alice);
        tg.move(hex"", newCommitment);

        assertEq(tg.positionCommitments(alice), newCommitment);
        assertEq(tg.moveCounter(), 1);
        assertEq(tg.participantMoveCount(alice), 1);
    }

    function test_move_revert_not_registered() public {
        vm.prank(bob);
        vm.expectRevert(TallGrass.NotRegistered.selector);
        tg.move(hex"", bytes32(uint256(0x5678)));
    }

    function test_move_revert_invalid_proof() public {
        bytes32 oldCommitment = bytes32(uint256(0x1234));
        _registerAlice(oldCommitment);

        mockMovementVerifier.setVerify(false);

        vm.prank(alice);
        vm.expectRevert(TallGrass.InvalidProof.selector);
        tg.move(hex"", bytes32(uint256(0x5678)));
    }

    function test_move_increments_counters() public {
        bytes32 c1 = bytes32(uint256(0x1));
        bytes32 c2 = bytes32(uint256(0x2));
        bytes32 c3 = bytes32(uint256(0x3));
        _registerAlice(c1);

        vm.prank(alice);
        tg.move(hex"", c2);
        assertEq(tg.moveCounter(), 1);
        assertEq(tg.participantMoveCount(alice), 1);

        vm.prank(alice);
        tg.move(hex"", c3);
        assertEq(tg.moveCounter(), 2);
        assertEq(tg.participantMoveCount(alice), 2);
    }

    // -----------------------------------------------------------------------
    // Deposits
    // -----------------------------------------------------------------------

    function test_deposit() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAlice(commitment);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        tg.deposit{value: 0.5 ether}();

        assertEq(tg.depositBalance(alice), 0.5 ether);
        assertEq(tg.totalDeposits(), 0.5 ether);
    }

    function test_deposit_additive() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAlice(commitment);

        vm.deal(alice, 2 ether);
        vm.prank(alice);
        tg.deposit{value: 0.5 ether}();
        vm.prank(alice);
        tg.deposit{value: 0.3 ether}();

        assertEq(tg.depositBalance(alice), 0.8 ether);
        assertEq(tg.totalDeposits(), 0.8 ether);
    }

    function test_deposit_revert_not_registered() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(TallGrass.NotRegistered.selector);
        tg.deposit{value: 0.5 ether}();
    }

    function test_deposit_revert_zero() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAlice(commitment);

        vm.prank(alice);
        vm.expectRevert(TallGrass.InsufficientDeposit.selector);
        tg.deposit{value: 0}();
    }

    // -----------------------------------------------------------------------
    // Withdraw Deposit
    // -----------------------------------------------------------------------

    function test_withdrawDeposit() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAndDeposit(alice, commitment, 1 ether);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        tg.withdrawDeposit(0.5 ether);

        assertEq(tg.depositBalance(alice), 0.5 ether);
        assertEq(tg.totalDeposits(), 0.5 ether);
        assertEq(alice.balance, balBefore + 0.5 ether);
    }

    function test_withdrawDeposit_partial() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAndDeposit(alice, commitment, 1 ether);

        vm.prank(alice);
        tg.withdrawDeposit(0.3 ether);
        assertEq(tg.depositBalance(alice), 0.7 ether);

        vm.prank(alice);
        tg.withdrawDeposit(0.7 ether);
        assertEq(tg.depositBalance(alice), 0);
        assertEq(tg.totalDeposits(), 0);
    }

    function test_withdrawDeposit_revert_insufficient() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAndDeposit(alice, commitment, 0.5 ether);

        vm.prank(alice);
        vm.expectRevert(TallGrass.InsufficientDeposit.selector);
        tg.withdrawDeposit(1 ether);
    }

    // -----------------------------------------------------------------------
    // Relay Move
    // -----------------------------------------------------------------------

    function test_relayMove() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAndDeposit(alice, commitment, 1 ether);

        bytes32 newCommitment = bytes32(uint256(0x5678));
        uint256 oracleBalBefore = oracleAddr.balance;

        vm.txGasPrice(10 gwei);
        vm.prank(oracleAddr);
        tg.relayMove(alice, hex"", newCommitment);

        assertEq(tg.positionCommitments(alice), newCommitment);
        assertEq(tg.moveCounter(), 1);
        assertEq(tg.participantMoveCount(alice), 1);
        assertGt(tg.depositBalance(alice), 0); // still has deposit left
        assertTrue(oracleAddr.balance > oracleBalBefore); // oracle reimbursed
    }

    function test_relayMove_revert_not_oracle() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAndDeposit(alice, commitment, 1 ether);

        vm.prank(alice);
        vm.expectRevert(); // Unauthorized
        tg.relayMove(alice, hex"", bytes32(uint256(0x5678)));
    }

    function test_relayMove_revert_no_deposit() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAlice(commitment);

        vm.prank(oracleAddr);
        vm.expectRevert(TallGrass.InsufficientDeposit.selector);
        tg.relayMove(alice, hex"", bytes32(uint256(0x5678)));
    }

    function test_relayMove_revert_invalid_proof() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAndDeposit(alice, commitment, 1 ether);

        mockMovementVerifier.setVerify(false);

        vm.prank(oracleAddr);
        vm.expectRevert(TallGrass.InvalidProof.selector);
        tg.relayMove(alice, hex"", bytes32(uint256(0x5678)));
    }

    function test_relayMove_depletes() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        // Tiny deposit so gas cost exceeds it in one step
        _registerAndDeposit(alice, commitment, 1);

        vm.txGasPrice(10 gwei);
        vm.prank(oracleAddr);
        tg.relayMove(alice, hex"", bytes32(uint256(0x5678)));

        assertEq(tg.depositBalance(alice), 0);
        assertEq(tg.totalDeposits(), 0);
    }

    function test_move_allowed_with_deposit() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAndDeposit(alice, commitment, 0.5 ether);

        // Manual move should succeed with deposit active
        bytes32 newCommitment = bytes32(uint256(0x5678));
        vm.prank(alice);
        tg.move(hex"", newCommitment);

        assertEq(tg.positionCommitments(alice), newCommitment);
        assertGt(tg.depositBalance(alice), 0); // deposit unchanged
    }

    // -----------------------------------------------------------------------
    // Minting (encounter proof)
    // -----------------------------------------------------------------------

    function test_mint() public {
        uint256 entityId = 5;
        bytes32 traitCID = bytes32(uint256(0xaaaa));
        bytes32 initPosCommitment = bytes32(uint256(0x1111));
        bytes32 blindingSeedCommitment = bytes32(uint256(0x2222));

        // Build trait Merkle proof
        (bytes32 traitRoot, bytes32[] memory proof) = _buildTraitTree(entityId, traitCID);

        // Redeploy with correct trait root
        TallGrass tg2 = _deployWith(traitRoot);

        vm.prank(alice);
        vm.deal(alice, 1 ether);
        tg2.mint{value: MINT_PRICE}(
            entityId, hex"", traitCID,
            initPosCommitment, blindingSeedCommitment, proof
        );

        assertTrue(tg2.entityMinted(entityId));
        assertEq(tg2.ownerOf(entityId), alice);
        assertEq(tg2.entityTraitCID(entityId), traitCID);
        assertEq(tg2.entityPositionCommitments(entityId), initPosCommitment);
        assertEq(tg2.entityBlindingSeedCommitments(entityId), blindingSeedCommitment);
        assertEq(tg2.entityMoveCount(entityId), 0);
        assertEq(tg2.totalMinted(), 1);
    }

    function test_mint_revert_already_minted() public {
        uint256 entityId = 5;
        bytes32 traitCID = bytes32(uint256(0xaaaa));
        bytes32 initPos = bytes32(uint256(0x1111));
        bytes32 bsc = bytes32(uint256(0x2222));
        (bytes32 traitRoot, bytes32[] memory proof) = _buildTraitTree(entityId, traitCID);
        TallGrass tg2 = _deployWith(traitRoot);

        vm.deal(alice, 2 ether);
        vm.prank(alice);
        tg2.mint{value: MINT_PRICE}(entityId, hex"", traitCID, initPos, bsc, proof);

        // Second mint should fail
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(TallGrass.EntityAlreadyMinted.selector);
        tg2.mint{value: MINT_PRICE}(entityId, hex"", traitCID, initPos, bsc, proof);
    }

    function test_mint_revert_insufficient_payment() public {
        uint256 entityId = 5;
        bytes32 traitCID = bytes32(uint256(0xaaaa));
        bytes32 initPos = bytes32(uint256(0x1111));
        bytes32 bsc = bytes32(uint256(0x2222));
        (bytes32 traitRoot, bytes32[] memory proof) = _buildTraitTree(entityId, traitCID);
        TallGrass tg2 = _deployWith(traitRoot);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(TallGrass.InsufficientPayment.selector);
        tg2.mint{value: 0.1 ether}(entityId, hex"", traitCID, initPos, bsc, proof);
    }

    function test_mint_revert_bad_trait_proof() public {
        uint256 entityId = 5;
        bytes32 traitCID = bytes32(uint256(0xaaaa));
        bytes32 initPos = bytes32(uint256(0x1111));
        bytes32 bsc = bytes32(uint256(0x2222));
        // Use wrong trait root (the default ENTITY_TRAIT_ROOT won't match)

        bytes32[] memory fakeProof = new bytes32[](1);
        fakeProof[0] = bytes32(uint256(0xffff));

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(TallGrass.InvalidTraitProof.selector);
        tg.mint{value: MINT_PRICE}(entityId, hex"", traitCID, initPos, bsc, fakeProof);
    }

    function test_mint_revert_invalid_encounter_proof() public {
        uint256 entityId = 5;
        bytes32 traitCID = bytes32(uint256(0xaaaa));
        bytes32 initPos = bytes32(uint256(0x1111));
        bytes32 bsc = bytes32(uint256(0x2222));
        (bytes32 traitRoot, bytes32[] memory proof) = _buildTraitTree(entityId, traitCID);
        TallGrass tg2 = _deployWith(traitRoot);

        // Set encounter verifier to reject
        mockEncounterVerifier.setVerify(false);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(TallGrass.InvalidProof.selector);
        tg2.mint{value: MINT_PRICE}(entityId, hex"", traitCID, initPos, bsc, proof);
    }

    // -----------------------------------------------------------------------
    // Withdrawal (oracle)
    // -----------------------------------------------------------------------

    function test_withdraw() public {
        // Give the contract some ETH
        vm.deal(address(tg), 1 ether);

        uint256 balBefore = oracleAddr.balance;

        vm.prank(oracleAddr);
        tg.withdraw();

        assertEq(oracleAddr.balance, balBefore + 1 ether);
        assertEq(address(tg).balance, 0);
    }

    function test_withdraw_revert_not_oracle() public {
        vm.deal(address(tg), 1 ether);

        vm.prank(alice);
        vm.expectRevert(); // Unauthorized
        tg.withdraw();
    }

    function test_withdraw_excludes_deposits() public {
        bytes32 commitment = bytes32(uint256(0x1234));
        _registerAndDeposit(alice, commitment, 0.5 ether);

        // Add mint revenue
        vm.deal(address(tg), address(tg).balance + 1 ether);

        uint256 oracleBalBefore = oracleAddr.balance;

        vm.prank(oracleAddr);
        tg.withdraw();

        // Should withdraw only the non-deposit balance (1 ether revenue)
        assertEq(oracleAddr.balance, oracleBalBefore + 1 ether);
        // Deposit still in contract
        assertEq(address(tg).balance, 0.5 ether);
    }

    // -----------------------------------------------------------------------
    // Metadata delegation
    // -----------------------------------------------------------------------

    function test_setMetadataContract() public {
        address newMetadata = address(0x999);
        vm.prank(owner);
        tg.setMetadataContract(newMetadata);
        assertEq(tg.metadataContract(), newMetadata);
    }

    function test_setMetadataContract_revert_not_owner() public {
        vm.prank(alice);
        vm.expectRevert();
        tg.setMetadataContract(address(0x999));
    }

    function test_tokenURI_delegates_to_metadata() public {
        _mintEntity(0, alice);

        // Should not revert -- metadata contract returns base64 JSON
        string memory uri = tg.tokenURI(0);
        assertTrue(bytes(uri).length > 0);
    }

    function test_supportsInterface_erc4906() public view {
        assertTrue(tg.supportsInterface(bytes4(0x49064906)));
    }

    function test_supportsInterface_erc7572() public view {
        assertTrue(tg.supportsInterface(bytes4(0xe8a3d485)));
    }

    function test_supportsInterface_erc721() public view {
        assertTrue(tg.supportsInterface(bytes4(0x80ac58cd)));
    }

    // -----------------------------------------------------------------------
    // ERC-4906 event emission
    // -----------------------------------------------------------------------

    function test_emitMetadataUpdate_from_owner() public {
        vm.prank(owner);
        tg.emitMetadataUpdate(0);
    }

    function test_emitMetadataUpdate_from_metadata_contract() public {
        vm.prank(address(metadata));
        tg.emitMetadataUpdate(0);
    }

    function test_emitMetadataUpdate_revert_unauthorized() public {
        vm.prank(alice);
        vm.expectRevert();
        tg.emitMetadataUpdate(0);
    }

    // -----------------------------------------------------------------------
    // Entity Movement
    // -----------------------------------------------------------------------

    function test_moveEntity() public {
        _mintEntity(0, alice);

        bytes32 newPos = bytes32(uint256(0xaaaa));
        bytes32 dirCommitment = bytes32(uint256(0xbbbb));

        vm.prank(alice);
        tg.moveEntity(0, hex"", newPos, dirCommitment);

        assertEq(tg.entityPositionCommitments(0), newPos);
        assertEq(tg.entityMoveCount(0), 1);
        assertEq(tg.moveCounter(), 1);
    }

    function test_moveEntity_increments_counters() public {
        _mintEntity(0, alice);

        bytes32 pos1 = bytes32(uint256(0x1111));
        bytes32 pos2 = bytes32(uint256(0x2222));
        bytes32 dc1 = bytes32(uint256(0xaaaa));
        bytes32 dc2 = bytes32(uint256(0xbbbb));

        vm.prank(alice);
        tg.moveEntity(0, hex"", pos1, dc1);
        assertEq(tg.entityMoveCount(0), 1);
        assertEq(tg.moveCounter(), 1);

        vm.prank(alice);
        tg.moveEntity(0, hex"", pos2, dc2);
        assertEq(tg.entityMoveCount(0), 2);
        assertEq(tg.moveCounter(), 2);
    }

    function test_moveEntity_revert_not_minted() public {
        vm.prank(alice);
        vm.expectRevert(TallGrass.EntityNotMinted.selector);
        tg.moveEntity(0, hex"", bytes32(uint256(0x1)), bytes32(uint256(0x2)));
    }

    function test_moveEntity_revert_not_owner() public {
        _mintEntity(0, alice);

        vm.prank(bob);
        vm.expectRevert(TallGrass.NotEntityOwner.selector);
        tg.moveEntity(0, hex"", bytes32(uint256(0x1)), bytes32(uint256(0x2)));
    }

    function test_moveEntity_revert_invalid_proof() public {
        _mintEntity(0, alice);

        mockEntityMovementVerifier.setVerify(false);

        vm.prank(alice);
        vm.expectRevert(TallGrass.InvalidProof.selector);
        tg.moveEntity(0, hex"", bytes32(uint256(0x1)), bytes32(uint256(0x2)));
    }

    function test_moveEntity_emits_event() public {
        _mintEntity(0, alice);

        bytes32 newPos = bytes32(uint256(0xaaaa));
        bytes32 dirCommitment = bytes32(uint256(0xbbbb));

        vm.expectEmit(true, false, false, true);
        emit TallGrass.EntityMoved(0, dirCommitment, 1);

        vm.prank(alice);
        tg.moveEntity(0, hex"", newPos, dirCommitment);
    }

    // -----------------------------------------------------------------------
    // Mint helpers
    // -----------------------------------------------------------------------

    /// @dev Mint an entity to `to` using mock encounter verifier.
    function _mintEntity(uint256 entityId, address to) internal {
        bytes32 traitCID = bytes32(uint256(entityId + 0xaa00));
        bytes32 initPos = bytes32(uint256(entityId + 0xcc00));
        bytes32 bsc = bytes32(uint256(entityId + 0xdd00));
        (bytes32 traitRoot, bytes32[] memory proof) = _buildTraitTree(entityId, traitCID);

        TallGrass newTg = _deployWith(traitRoot);

        vm.deal(to, 1 ether);
        vm.prank(to);
        newTg.mint{value: MINT_PRICE}(entityId, hex"", traitCID, initPos, bsc, proof);

        // Swap tg to the new instance so tests use the minted state
        tg = newTg;
    }

    /// @dev Build a minimal keccak256 Merkle tree with 32 leaves, returning the root
    ///      and proof for the given entityId.
    function _buildTraitTree(uint256 entityId, bytes32 traitCID)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proof)
    {
        // Build 32 leaves using OZ's double-hash pattern
        bytes32[] memory leaves = new bytes32[](TOTAL_SUPPLY);
        for (uint256 i = 0; i < TOTAL_SUPPLY; i++) {
            bytes32 cid = i == entityId ? traitCID : bytes32(uint256(i + 0xbb00));
            leaves[i] = keccak256(bytes.concat(keccak256(abi.encode(i, cid))));
        }

        // Compute proof (5 levels for 32 leaves)
        uint256 depth = 5;
        proof = new bytes32[](depth);
        uint256 idx = entityId;
        bytes32[] memory layer = leaves;

        for (uint256 d = 0; d < depth; d++) {
            // Sibling
            uint256 siblingIdx = idx % 2 == 0 ? idx + 1 : idx - 1;
            proof[d] = layer[siblingIdx];

            // Next layer
            bytes32[] memory next = new bytes32[](layer.length / 2);
            for (uint256 j = 0; j < layer.length; j += 2) {
                // Sort pairs for commutative hashing (compatible with both OZ and solady)
                if (layer[j] <= layer[j + 1]) {
                    next[j / 2] = keccak256(abi.encodePacked(layer[j], layer[j + 1]));
                } else {
                    next[j / 2] = keccak256(abi.encodePacked(layer[j + 1], layer[j]));
                }
            }

            idx = idx / 2;
            layer = next;
        }

        root = layer[0];
    }

    function _deployWith(bytes32 traitRoot) internal returns (TallGrass) {
        TallGrass newTg = new TallGrass(
            SEED_COMMITMENT,
            TERRAIN_ROOT,
            traitRoot,
            ENTITY_ROOT,
            GRID_WIDTH,
            GRID_HEIGHT,
            TOTAL_SUPPLY,
            MINT_PRICE,
            address(mockMovementVerifier),
            address(mockEntityMovementVerifier),
            address(mockEncounterVerifier),
            bytes32(0),
            owner
        );

        // Grant ORACLE role
        vm.prank(owner);
        newTg.grantRoles(oracleAddr, Roles.ORACLE);

        // Deploy and link metadata for the new instance
        TallGrassMetadata newMetadata = new TallGrassMetadata(address(newTg));
        vm.prank(owner);
        newTg.setMetadataContract(address(newMetadata));

        return newTg;
    }
}
