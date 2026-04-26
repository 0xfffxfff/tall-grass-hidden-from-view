// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

interface ITallGrassMetadata {
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function contractURI() external view returns (string memory);
}
