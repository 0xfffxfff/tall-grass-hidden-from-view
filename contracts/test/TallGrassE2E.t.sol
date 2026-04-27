// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TallGrass} from "../src/TallGrass.sol";
import {TestFixtures} from "./TestFixtures.sol";
import {Roles} from "../src/libraries/Roles.sol";

/// @notice End-to-end tests using real ZK proof fixtures and generated verifiers.
/// @dev JS-generated keccak proofs verified by the generated Solidity verifier
///      through the TallGrass contract.
contract TallGrassE2ETest is Test {
    TallGrass public tg;

    uint256 internal oracleKey = 0xA11CE;
    address internal oracleAddr;
    address internal owner = address(0xABCD);
    address internal alice = address(0x1);

    function setUp() public {
        oracleAddr = vm.addr(oracleKey);

        // Deploy real generated verifier
        address movementVerifier = deployCode("MovementVerifier.sol:MovementVerifier");

        tg = new TallGrass(
            bytes32(uint256(0xdead)),               // seedCommitment (not tested here)
            bytes32(uint256(0xcafe)),               // entityTraitMerkleRoot (not tested here)
            32,                                     // gridWidth
            32,                                     // gridHeight
            32,                                     // totalSupply
            0.2 ether,                              // mintPrice
            movementVerifier,
            address(0),                             // entityMovementVerifier (not tested here)
            address(0),                             // encounterVerifier (not tested here)
            bytes32(0),                             // decryptionKeyCommitment (not tested here)
            bytes32(0),                             // traitModuliCommitment (not tested here)
            owner
        );

        vm.prank(owner);
        tg.grantRoles(oracleAddr, Roles.ORACLE);
    }

    function _oracleSign(bytes32 digest) internal view returns (bytes memory) {
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, ethHash);
        return abi.encodePacked(r, s, v);
    }

    /// @notice Movement proof: real verifier accepts a real ZK proof.
    function test_e2e_movement() public {
        // Register alice with the fixture's old commitment
        bytes32 oldCommitment = TestFixtures.MOVEMENT_OLD_COMMITMENT;
        bytes32 newCommitment = TestFixtures.MOVEMENT_NEW_COMMITMENT;

        bytes32 regDigest = keccak256(abi.encodePacked(alice, oldCommitment));
        bytes memory regSig = _oracleSign(regDigest);
        vm.prank(alice);
        tg.register(oldCommitment, regSig);

        // Submit the real proof
        vm.prank(alice);
        tg.move(TestFixtures.MOVEMENT_PROOF, newCommitment);

        assertEq(tg.positionCommitments(alice), newCommitment);
        assertEq(tg.moveCounter(), 1);
    }

}
