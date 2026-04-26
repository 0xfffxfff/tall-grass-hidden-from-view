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
    address public immutable tokenContract;

    mapping(uint256 => address[]) internal _entityCiphertextParts;
    mapping(uint256 => address[]) internal _entityImageParts;

    address[] internal _htmlHeadParts;
    address[] internal _htmlScriptParts;
    address[] internal _htmlTailParts;

    address public sharedDescriptionPointer;
    mapping(uint256 => address) public tokenDescriptionPointers;

    address[] internal _collectionImageParts;

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

    function setEntityImagePart(uint256 entityId, bytes calldata data, uint256 index)
        external
        onlyEditor
    {
        _setChunk(_entityImageParts[entityId], data, index);
        _emitMetadataUpdate(entityId);
    }

    function getEntityImage(uint256 entityId) public view returns (bytes memory) {
        return _readChunks(_entityImageParts[entityId]);
    }

    function entityImagePartsCount(uint256 entityId) external view returns (uint256) {
        return _entityImageParts[entityId].length;
    }

    function entityImageDataUrl(uint256 entityId) public view returns (string memory) {
        bytes memory raw = getEntityImage(entityId);
        if (raw.length == 0) return "";
        return string.concat("data:image/jpeg;base64,", Base64.encode(raw));
    }

    // --- Inlined HTML viewer (SSTORE2 chunked) --------------------------

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
        string memory image = entityImageDataUrl(tokenId);
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
