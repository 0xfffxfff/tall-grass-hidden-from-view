// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TallGrass} from "../src/TallGrass.sol";
import {TallGrassMetadata} from "../src/TallGrassMetadata.sol";
import {MovementVerifier} from "../src/MovementVerifier.sol";
import {EntityMovementVerifier} from "../src/EntityMovementVerifier.sol";
import {EncounterVerifier} from "../src/EncounterVerifier.sol";
import {Roles} from "../src/libraries/Roles.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Pre-deployed verifier addresses (set to 0x0 to deploy fresh)
        address movementVerifier = vm.envAddress("MOVEMENT_VERIFIER");
        address entityMovementVerifier = vm.envAddress("ENTITY_MOVEMENT_VERIFIER");
        address encounterVerifier = vm.envAddress("ENCOUNTER_VERIFIER");

        vm.startBroadcast(deployerKey);

        // Deploy verifiers if needed (Forge auto-deploys linked libraries)
        if (movementVerifier == address(0)) {
            MovementVerifier mv = new MovementVerifier();
            movementVerifier = address(mv);
            console.log("MovementVerifier deployed:", movementVerifier);
        }

        if (entityMovementVerifier == address(0)) {
            EntityMovementVerifier emv = new EntityMovementVerifier();
            entityMovementVerifier = address(emv);
            console.log("EntityMovementVerifier deployed:", entityMovementVerifier);
        }

        if (encounterVerifier == address(0)) {
            EncounterVerifier ev = new EncounterVerifier();
            encounterVerifier = address(ev);
            console.log("EncounterVerifier deployed:", encounterVerifier);
        }

        TallGrass tg = new TallGrass(
            vm.envBytes32("SEED_COMMITMENT"),
            vm.envBytes32("TERRAIN_MERKLE_ROOT"),
            vm.envBytes32("ENTITY_TRAIT_MERKLE_ROOT"),
            vm.envBytes32("ENTITY_MERKLE_ROOT"),
            vm.envUint("GRID_WIDTH"),
            vm.envUint("GRID_HEIGHT"),
            vm.envUint("TOTAL_SUPPLY"),
            vm.envUint("MINT_PRICE"),
            movementVerifier,
            entityMovementVerifier,
            encounterVerifier,
            vm.envBytes32("DECRYPTION_KEY_COMMITMENT"),
            deployer
        );
        console.log("TallGrass deployed:", address(tg));

        // Grant ORACLE role
        address oracleAddr = vm.envAddress("ORACLE_ADDRESS");
        tg.grantRoles(oracleAddr, Roles.ORACLE);
        console.log("ORACLE role granted to:", oracleAddr);

        TallGrassMetadata metadata = new TallGrassMetadata(address(tg));
        console.log("TallGrassMetadata deployed:", address(metadata));

        tg.setMetadataContract(address(metadata));
        console.log("Metadata contract linked");

        vm.stopBroadcast();
    }
}
