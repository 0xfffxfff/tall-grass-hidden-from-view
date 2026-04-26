// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {OwnableRoles} from "solady/auth/OwnableRoles.sol";
import {SSTORE2} from "solady/utils/SSTORE2.sol";
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

    // Per-entity ciphertext (chunked SSTORE2)
    mapping(uint256 => address[]) internal _entityCiphertextParts;

    // Description (SSTORE2)
    address public sharedDescriptionPointer;
    mapping(uint256 => address) public tokenDescriptionPointers;

    // Animation URLs
    mapping(uint256 => string) public animationUrls;

    // Collection image (SSTORE2 chunked)
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
        address pointer = SSTORE2.write(data);
        if (index == _entityCiphertextParts[entityId].length) {
            _entityCiphertextParts[entityId].push(pointer);
        } else if (index < _entityCiphertextParts[entityId].length) {
            _entityCiphertextParts[entityId][index] = pointer;
        } else {
            revert("Invalid index");
        }
        _emitMetadataUpdate(entityId);
    }

    function getCiphertext(uint256 entityId) public view returns (bytes memory) {
        address[] storage parts = _entityCiphertextParts[entityId];
        bytes memory result;
        for (uint256 i; i < parts.length; i++) {
            result = abi.encodePacked(result, SSTORE2.read(parts[i]));
        }
        return result;
    }

    function ciphertextHash(uint256 entityId) public view returns (bytes32) {
        bytes memory data = getCiphertext(entityId);
        if (data.length == 0) return bytes32(0);
        return keccak256(data);
    }

    function ciphertextPartsCount(uint256 entityId) external view returns (uint256) {
        return _entityCiphertextParts[entityId].length;
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

    // --- Animation URL ---------------------------------------------------

    function setAnimationUrl(uint256 tokenId, string calldata url) external onlyEditor {
        animationUrls[tokenId] = url;
        _emitMetadataUpdate(tokenId);
    }

    function animationUrl(uint256 tokenId) public view returns (string memory) {
        return animationUrls[tokenId];
    }

    // --- Collection Image (SSTORE2 chunked) ------------------------------

    function setCollectionImagePart(string calldata data, uint256 index) external onlyEditor {
        address pointer = SSTORE2.write(bytes(data));
        if (index == _collectionImageParts.length) {
            _collectionImageParts.push(pointer);
        } else if (index < _collectionImageParts.length) {
            _collectionImageParts[index] = pointer;
        } else {
            revert("Invalid index");
        }
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

        bytes32 ctHash = ciphertextHash(tokenId);
        string memory attributes;
        if (ctHash != bytes32(0)) {
            attributes = string.concat(
                "[",
                Metadata.attribute("ciphertext_hash", LibString.toHexString(uint256(ctHash))),
                "]"
            );
        } else {
            attributes = "[]";
        }

        return Metadata.encodeMetadata(
            tokenId,
            _name,
            description(tokenId),
            attributes,
            animationUrl(tokenId)
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

    // --- Internal --------------------------------------------------------

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
