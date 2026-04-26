// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {OwnableRoles} from "solady/auth/OwnableRoles.sol";
import {SSTORE2} from "solady/utils/SSTORE2.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibString} from "solady/utils/LibString.sol";
import {Metadata} from "./libraries/Metadata.sol";
import {Roles} from "./libraries/Roles.sol";

interface ITallGrass {
    function emitMetadataUpdate(uint256 tokenId) external;
    function emitBatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId) external;
    function emitContractURIUpdated() external;
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

contract TallGrassMetadata {
    // -----------------------------------------------------------------------
    // Aspect codes for per-entity preview JPGs.
    // 1x1 doubles as the marketplace `image` field; the others are exposed
    // via getters for clients that prefer portrait crops (the Monolith
    // ships in 9:16, the gallery cards print 2:3).
    // -----------------------------------------------------------------------
    uint8 public constant ASPECT_1X1 = 0;
    uint8 public constant ASPECT_2X3 = 1;
    uint8 public constant ASPECT_9X16 = 2;
    uint8 public constant ASPECT_COUNT = 3;

    address public immutable tokenContract;

    // Per-entity ciphertext (chunked SSTORE2)
    mapping(uint256 => address[]) internal _entityCiphertextParts;

    // Per-entity preview JPGs, one slot per aspect (chunked SSTORE2,
    // typically a single chunk fits under the 24KB SSTORE2 limit).
    mapping(uint256 => mapping(uint8 => address[])) internal _entityImageParts;

    // Inlined HTML viewer assembled from three shared SSTORE2-backed
    // sections (head, script, tail) so each can be re-uploaded without
    // touching the others. Per-token entityId is injected at view time.
    address[] internal _htmlHeadParts;
    address[] internal _htmlScriptParts;
    address[] internal _htmlTailParts;

    // Description (SSTORE2)
    address public sharedDescriptionPointer;
    mapping(uint256 => address) public tokenDescriptionPointers;

    // Collection-level image (SSTORE2 chunked, already-prefixed data URL)
    address[] internal _collectionImageParts;

    // External link
    string public externalLink;

    modifier onlyEditor() {
        require(
            OwnableRoles(tokenContract).owner() == msg.sender
                || OwnableRoles(tokenContract).hasAnyRole(msg.sender, Roles.EDITOR),
            "Unauthorized"
        );
        _;
    }

    constructor(address _tokenContract) {
        tokenContract = _tokenContract;
    }

    // --- Ciphertext (SSTORE2 chunked) ------------------------------------

    function setCiphertextPart(uint256 entityId, bytes calldata data, uint256 index) external onlyEditor {
        _setChunk(_entityCiphertextParts[entityId], data, index);
        _emitMetadataUpdate(entityId);
    }

    function getCiphertext(uint256 entityId) public view returns (bytes memory) {
        return _readChunks(_entityCiphertextParts[entityId]);
    }

    function ciphertextHash(uint256 entityId) public view returns (bytes32) {
        bytes memory data = getCiphertext(entityId);
        if (data.length == 0) return bytes32(0);
        return keccak256(data);
    }

    function ciphertextPartsCount(uint256 entityId) external view returns (uint256) {
        return _entityCiphertextParts[entityId].length;
    }

    // --- Per-entity image (SSTORE2 chunked, raw JPG bytes) --------------

    function setEntityImagePart(uint256 entityId, uint8 aspect, bytes calldata data, uint256 index)
        external
        onlyEditor
    {
        require(aspect < ASPECT_COUNT, "Invalid aspect");
        _setChunk(_entityImageParts[entityId][aspect], data, index);
        _emitMetadataUpdate(entityId);
    }

    function getEntityImage(uint256 entityId, uint8 aspect) public view returns (bytes memory) {
        require(aspect < ASPECT_COUNT, "Invalid aspect");
        return _readChunks(_entityImageParts[entityId][aspect]);
    }

    function entityImagePartsCount(uint256 entityId, uint8 aspect) external view returns (uint256) {
        require(aspect < ASPECT_COUNT, "Invalid aspect");
        return _entityImageParts[entityId][aspect].length;
    }

    /// @notice Returns a fully-formed `data:image/jpeg;base64,...` URL for
    ///         the given aspect, or empty string if no image is uploaded.
    function entityImageDataUrl(uint256 entityId, uint8 aspect) public view returns (string memory) {
        bytes memory raw = getEntityImage(entityId, aspect);
        if (raw.length == 0) return "";
        return string.concat("data:image/jpeg;base64,", Base64.encode(raw));
    }

    // --- Inlined HTML viewer (SSTORE2 chunked) --------------------------
    //
    // Layout: tokenURI assembles the HTML as
    //   head + "<script>window.__TG_ID=N;</script>" + script + tail
    // Head ends just before the per-token id-injection point; script holds
    // the bundled de-Reactified Stage IIFE; tail closes the document.

    function setHtmlHeadPart(bytes calldata data, uint256 index) external onlyEditor {
        _setChunk(_htmlHeadParts, data, index);
        _emitBatchMetadataUpdate();
    }

    function setHtmlScriptPart(bytes calldata data, uint256 index) external onlyEditor {
        _setChunk(_htmlScriptParts, data, index);
        _emitBatchMetadataUpdate();
    }

    function setHtmlTailPart(bytes calldata data, uint256 index) external onlyEditor {
        _setChunk(_htmlTailParts, data, index);
        _emitBatchMetadataUpdate();
    }

    function htmlHeadPartsCount() external view returns (uint256) {
        return _htmlHeadParts.length;
    }

    function htmlScriptPartsCount() external view returns (uint256) {
        return _htmlScriptParts.length;
    }

    function htmlTailPartsCount() external view returns (uint256) {
        return _htmlTailParts.length;
    }

    /// @notice Returns the raw HTML for an entity (no data: URL wrapper),
    ///         primarily for debugging and off-chain consumers.
    function entityHtml(uint256 entityId) public view returns (bytes memory) {
        return abi.encodePacked(
            _readChunks(_htmlHeadParts),
            "<script>window.__TG_ID=",
            bytes(LibString.toString(entityId)),
            ";</script>",
            _readChunks(_htmlScriptParts),
            _readChunks(_htmlTailParts)
        );
    }

    function entityHtmlDataUrl(uint256 entityId) public view returns (string memory) {
        return string.concat("data:text/html;base64,", Base64.encode(entityHtml(entityId)));
    }

    // --- Description (SSTORE2) -------------------------------------------

    function setSharedDescription(string calldata data) external onlyEditor {
        sharedDescriptionPointer = SSTORE2.write(bytes(data));
        _emitBatchMetadataUpdate();
        _emitContractURIUpdated();
    }

    function setTokenDescription(uint256 tokenId, string calldata data) external onlyEditor {
        tokenDescriptionPointers[tokenId] = SSTORE2.write(bytes(data));
        _emitMetadataUpdate(tokenId);
    }

    function description(uint256 tokenId) public view returns (string memory) {
        address pointer = tokenDescriptionPointers[tokenId] != address(0)
            ? tokenDescriptionPointers[tokenId]
            : sharedDescriptionPointer;
        if (pointer == address(0)) return "";
        return string(SSTORE2.read(pointer));
    }

    // --- Collection Image (SSTORE2 chunked, already-prefixed data URL) --

    function setCollectionImagePart(string calldata data, uint256 index) external onlyEditor {
        _setChunk(_collectionImageParts, bytes(data), index);
        _emitContractURIUpdated();
    }

    function collectionImagePartsCount() external view returns (uint256) {
        return _collectionImageParts.length;
    }

    // --- External Link ---------------------------------------------------

    function setExternalLink(string calldata data) external onlyEditor {
        externalLink = data;
        _emitContractURIUpdated();
    }

    // --- Token URI -------------------------------------------------------

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        string memory _name = string.concat("Entity #", LibString.toString(tokenId));
        string memory image = entityImageDataUrl(tokenId, ASPECT_1X1);
        string memory animation = entityHtmlDataUrl(tokenId);

        bytes32 ctHash = ciphertextHash(tokenId);
        string memory attributes = ctHash != bytes32(0)
            ? string.concat(
                "[",
                Metadata.attribute("ciphertext_hash", LibString.toHexString(uint256(ctHash))),
                "]"
            )
            : "[]";

        return Metadata.encodeTokenMetadata(
            tokenId,
            _name,
            description(tokenId),
            attributes,
            image,
            animation
        );
    }

    // --- Contract URI (ERC-7572) -----------------------------------------

    function contractURI() external view returns (string memory) {
        string memory _name;
        string memory _symbol;
        try ITallGrass(tokenContract).name() returns (string memory n) { _name = n; } catch {}
        try ITallGrass(tokenContract).symbol() returns (string memory s) { _symbol = s; } catch {}

        string memory _description = "";
        if (sharedDescriptionPointer != address(0)) {
            _description = string(SSTORE2.read(sharedDescriptionPointer));
        }

        string memory _image = "";
        for (uint256 i; i < _collectionImageParts.length; i++) {
            _image = string(abi.encodePacked(bytes(_image), SSTORE2.read(_collectionImageParts[i])));
        }

        return Metadata.encodeContractMetadata(_name, _symbol, _description, _image, externalLink);
    }

    // --- Internal helpers ------------------------------------------------

    function _setChunk(address[] storage parts, bytes memory data, uint256 index) internal {
        address pointer = SSTORE2.write(data);
        if (index == parts.length) {
            parts.push(pointer);
        } else if (index < parts.length) {
            parts[index] = pointer;
        } else {
            revert("Invalid index");
        }
    }

    function _readChunks(address[] storage parts) internal view returns (bytes memory) {
        uint256 n = parts.length;
        if (n == 0) return "";
        bytes memory result = SSTORE2.read(parts[0]);
        for (uint256 i = 1; i < n; i++) {
            result = abi.encodePacked(result, SSTORE2.read(parts[i]));
        }
        return result;
    }

    function _emitMetadataUpdate(uint256 tokenId) internal {
        try ITallGrass(tokenContract).emitMetadataUpdate(tokenId) {} catch {}
    }

    function _emitBatchMetadataUpdate() internal {
        try ITallGrass(tokenContract).emitBatchMetadataUpdate(0, type(uint256).max) {} catch {}
    }

    function _emitContractURIUpdated() internal {
        try ITallGrass(tokenContract).emitContractURIUpdated() {} catch {}
    }
}
