// SPDX-License-Identifier: Apache-2.0
// Copyright 2022 Aztec
pragma solidity >=0.8.21;

uint256 constant N = 16384;
uint256 constant LOG_N = 14;
uint256 constant NUMBER_OF_PUBLIC_INPUTS = 23;
uint256 constant VK_HASH = 0x0e22d8a08e4c89efcd450183d90571f452d84219b8c5e0930f827e35ec15a650;
library EncounterVerifierVK {
    function loadVerificationKey() internal pure returns (Honk.VerificationKey memory) {
        Honk.VerificationKey memory vk = Honk.VerificationKey({
            circuitSize: uint256(16384),
            logCircuitSize: uint256(14),
            publicInputsSize: uint256(23),
            ql: Honk.G1Point({ 
               x: uint256(0x062489d9ded73dc2abdfd73974809c74a7c762075cfe9c2629ba71ff1d2ab3bb),
               y: uint256(0x05efc11d81e8968dc76d769004f330247fbe774713e29d43ff9a01bca13271da)
            }),
            qr: Honk.G1Point({ 
               x: uint256(0x030c3048aa4ce9f294efaa1459fb784957e36a05707dc2d035052018c93cc913),
               y: uint256(0x246d15e7c3f8716c06eaed0a9a1fcefafc22547e0c44f278e96771cbc422a7c2)
            }),
            qo: Honk.G1Point({ 
               x: uint256(0x0cbbee4bed08b7ceeadb0c2f836ed31bcafbced73b2e73c95f9776ff22f9fa04),
               y: uint256(0x0c1bb385594ae63b7cffc77edeca982029ad85441e517558962ff16561d95967)
            }),
            q4: Honk.G1Point({ 
               x: uint256(0x2f3ec873dcab7d054d8c487944730e828dae05ec524e9b11989d4eaeb160695e),
               y: uint256(0x2093bdc5093080a42b5f53b42697f9aaec4fa43e81ab60e3cb35436d8d262925)
            }),
            qm: Honk.G1Point({ 
               x: uint256(0x2f5e4e10ccec35aae0dfff6f096b5a2e41363188b8be02e847cf07aa7f72037f),
               y: uint256(0x11cf4206f63494c019ccefbe874290c67b36eafaaeb8e65f53393e1bc612c7ec)
            }),
            qc: Honk.G1Point({ 
               x: uint256(0x2e83e08bd63d199c98fe9e08a2aee8ada733e679271d0be5f928e92752dad186),
               y: uint256(0x0ddfccc962207b46c739233e0d34fbe0eabd74781f906076e3f8f1c4028017e2)
            }),
            qLookup: Honk.G1Point({ 
               x: uint256(0x1958b13f38f58756e23989a418de3c113d47a2256ba6f60a9e2ec0523c52a991),
               y: uint256(0x286c1d4c53af6654de284fbb620f90a9e00aa9470a9e3c58a56cc81e212df923)
            }),
            qArith: Honk.G1Point({ 
               x: uint256(0x26f7d3964bb0e2e76ee5ec4a8a1c767c59e6c0b9c4aa228e0e65926f413c7859),
               y: uint256(0x09b87fe2df18fd7e90bf88b36d99f906c15bcdfba4287405614ecfda1c0b26c7)
            }),
            qDeltaRange: Honk.G1Point({ 
               x: uint256(0x18cb322218413deecfb74fc81c795ddbdd19b6126bdf24712b7074939fdfeac0),
               y: uint256(0x2ce52e2f0c9f4b42a7e28f81145ffa7529da51bc257943578fe538bfbb8a0713)
            }),
            qElliptic: Honk.G1Point({ 
               x: uint256(0x29d8359dc2ca5b1afd5184f019247a547d2a1aac917e42593abfed8e79fdf8be),
               y: uint256(0x1b87ecbd0f7e2f9bab075a2cffd7c96a8ed778f448fabaa7d1b9a2e5234692ab)
            }),
            qMemory: Honk.G1Point({ 
               x: uint256(0x282174253ce01a1c976cb2a814ae5f39b82c7ee7440b28a1d21745268f8f1ec9),
               y: uint256(0x0e1934bdd35233d6de17ee12791f511c5db4da056b3fa973b3d5a2b13208564f)
            }),
            qNnf: Honk.G1Point({ 
               x: uint256(0x2c0ef268c7cbae06ceea6a631cbc1ea81f6fd82834d07e25abbbdeb276ea11ef),
               y: uint256(0x26af113fe28a7765f04eb94a03d3c935c3a4ad2bfef8bc01cf835c9ed5857343)
            }),
            qPoseidon2External: Honk.G1Point({ 
               x: uint256(0x24e284fed2d63664a1151382cfb4e54bf0ec47571841d7288c9287f630b53100),
               y: uint256(0x06679bc3331f2dab5e97b063fcd68886c9abbb774e6b6af9d76dad9df25a4446)
            }),
            qPoseidon2Internal: Honk.G1Point({ 
               x: uint256(0x00c2b217147374219418b2bcdd346dd3bbefbf3bfc39c746a9128ce73f9f2414),
               y: uint256(0x0af72b7a47f9902fbe63517b5e9f75dc65018060a4f0d8b5729b109591bf3876)
            }),
            s1: Honk.G1Point({ 
               x: uint256(0x0bd10f2b6df850c9620330ba256efc34bcf0bd04c421f86bdfdc65e79ec013cf),
               y: uint256(0x1270ed6816018d0860baae0d1848b5657f2ec8ff810803deb15c12984a768d00)
            }),
            s2: Honk.G1Point({ 
               x: uint256(0x12b21bab71b5d94e83ceace8058dbb7e17cfc44df1079cb19b75e818c5f6ae4c),
               y: uint256(0x02702ac4a82dd1ca06297a188fd4016f77bb11dd868cde2de5fa74a92f9087f4)
            }),
            s3: Honk.G1Point({ 
               x: uint256(0x2bedbc07400b2bab5580bad07228e20b46078691246f0dde41489808f652ef2a),
               y: uint256(0x09c2fad01ddd810231c8bdc1542d013e286ed6ade7b33efb4518bfcea06b593f)
            }),
            s4: Honk.G1Point({ 
               x: uint256(0x0e58aaa446a205f7cd571bd793f6e634d29d642d30d944b17e7f6df252459a9e),
               y: uint256(0x00ba5f3ab7d1955a4e50be1aea33a8117b9749d1320b4f61d4438269d8ffe1e6)
            }),
            t1: Honk.G1Point({ 
               x: uint256(0x2e0cddbc5712d79b59cb3b41ebbcdd494997477ab161763e46601d95844837ef),
               y: uint256(0x303126892f664d8d505964d14315ec426db4c64531d350750df62dbbc41a1bd9)
            }),
            t2: Honk.G1Point({ 
               x: uint256(0x00874a5ad262eecc6b565e0b08507476a6b2c6040c0c62bd59acfe3e3e125672),
               y: uint256(0x127b2a745a1b74968c3edc18982b9bef082fb517183c9c6841c2b8ef2ca1df04)
            }),
            t3: Honk.G1Point({ 
               x: uint256(0x06331732b5da077ca7e91153fcd5830228ada50310c195c1485a793878ff3ab4),
               y: uint256(0x00e6d57c9202bd5d5c66193b4f690c90dad024438903645601b83dd2d07190d6)
            }),
            t4: Honk.G1Point({ 
               x: uint256(0x2aecd48089890ea0798eb952c66824d38e9426ad3085b68b00a93c17897c2877),
               y: uint256(0x1216bdb2f0d961bb8a7a23331d215078d8a9ce405ce559f441f2e71477ff3ddb)
            }),
            id1: Honk.G1Point({ 
               x: uint256(0x17b1904861e90a867f53db920b58caee8ac6ceb803c6b8991cf24c54d67097f2),
               y: uint256(0x2d52a9d3bd561ef90746fe26e357df47e7434c694ddd0b80b62cb4a921f5381a)
            }),
            id2: Honk.G1Point({ 
               x: uint256(0x2b854ab666f3e2578221dbfb73eee98722d8e6568ce7c3b23e40b957b4a7e4ce),
               y: uint256(0x0c93123f33d2915ee11ce983626a84fe0453ed3a95d4782e78c37202a33f39b9)
            }),
            id3: Honk.G1Point({ 
               x: uint256(0x04d82607dd35431b0b84f026cd4f324ad49871caee962f9b7ba485fbd77e15ce),
               y: uint256(0x0672c81f3e8b574eb98fbadc78c486ce18048cf876f4950d3728def1b21139c3)
            }),
            id4: Honk.G1Point({ 
               x: uint256(0x0d99bb803b37d8908394d0bfbfa49e385ed6ba49148739f89b48ddfee2dcfafc),
               y: uint256(0x20358f5e348e9c7062320e8687314bf19d8785457d8fee2dbf3bb6548f01da57)
            }),
            lagrangeFirst: Honk.G1Point({ 
               x: uint256(0x0000000000000000000000000000000000000000000000000000000000000001),
               y: uint256(0x0000000000000000000000000000000000000000000000000000000000000002)
            }),
            lagrangeLast: Honk.G1Point({ 
               x: uint256(0x1580eecc722f8efe84d4198920ce0ee132fc9c11d038b54d622ae02e11ed9a47),
               y: uint256(0x1049b537f1e23aa97ceaf4596d7c2fdbb49301460b07a4057c483144ad781edf)
            })
        });
        return vk;
    }
}

import {Honk, BaseHonkVerifier} from "./HonkBase.sol";

contract EncounterVerifier is BaseHonkVerifier(N, LOG_N, VK_HASH, NUMBER_OF_PUBLIC_INPUTS) {
     function loadVerificationKey() internal pure override returns (Honk.VerificationKey memory) {
       return EncounterVerifierVK.loadVerificationKey();
    }
}

