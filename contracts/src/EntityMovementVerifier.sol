// SPDX-License-Identifier: Apache-2.0
// Copyright 2022 Aztec
pragma solidity >=0.8.21;

uint256 constant N = 16384;
uint256 constant LOG_N = 14;
uint256 constant NUMBER_OF_PUBLIC_INPUTS = 23;
uint256 constant VK_HASH = 0x25c0e9a3c593ac7e427dc999340b524c8b45cc8438203fc9f11ab607ff648cd8;
library EntityMovementVerifierVK {
    function loadVerificationKey() internal pure returns (Honk.VerificationKey memory) {
        Honk.VerificationKey memory vk = Honk.VerificationKey({
            circuitSize: uint256(16384),
            logCircuitSize: uint256(14),
            publicInputsSize: uint256(23),
            ql: Honk.G1Point({ 
               x: uint256(0x102ddc2735c88b2994acf4c2db2c4d7deba5392e0daabca5801dd0ba9a7e41e4),
               y: uint256(0x2b9225a5aa86997c4a22f2f270bbaf22d47cf02aaa3f6cae9a825981db919d9e)
            }),
            qr: Honk.G1Point({ 
               x: uint256(0x01a426bbc78beae01eb2b7f32eb9ced8f44a57d61b093c0de6a57bb4a62453eb),
               y: uint256(0x0041b93cff9997737a42afdf56dbbd256b588130e92b19e9c16185d092e06a5f)
            }),
            qo: Honk.G1Point({ 
               x: uint256(0x09cbef9911235e355cb8c10112c0a8c5a052054531099eed189179f73b93f09d),
               y: uint256(0x0ff80f394bc51e4930e1abbc51be8a6eb7fd8cd2f8a0f6bcd7bac6f9e714de53)
            }),
            q4: Honk.G1Point({ 
               x: uint256(0x073968d9e05c8a8e4896a1e0a30b33d2e0f7f98f8cb97f92442c759257111581),
               y: uint256(0x2b16cef15b59caf525c5f4168ccfc84b84bfa160be789f83d3a44d8d847e31d2)
            }),
            qm: Honk.G1Point({ 
               x: uint256(0x2f326467c9bef6bad5a9071904b23848d8ea2b488a93231abb6ec22610b3150e),
               y: uint256(0x29aa044dd86d7c0ca1fe68398be02513aa4e6fa021d306b895d40c0bb44bda11)
            }),
            qc: Honk.G1Point({ 
               x: uint256(0x02aad41f17824bca0339cefba622b24848362b6939331b7d83ee7cbe61e815a7),
               y: uint256(0x2c190d40756177b6a4e14d85b7dbfe8cc2768a18d40b0003661822eb04517cbd)
            }),
            qLookup: Honk.G1Point({ 
               x: uint256(0x1958b13f38f58756e23989a418de3c113d47a2256ba6f60a9e2ec0523c52a991),
               y: uint256(0x286c1d4c53af6654de284fbb620f90a9e00aa9470a9e3c58a56cc81e212df923)
            }),
            qArith: Honk.G1Point({ 
               x: uint256(0x0beb38ea355a3571e44428824a349e97730cadea7ebd187c8603ef932ac4a0bc),
               y: uint256(0x1bc6b4c85a95b9337b15ef8e2634753e1a68c3214351c87e8ee6bda1b6a10fb6)
            }),
            qDeltaRange: Honk.G1Point({ 
               x: uint256(0x225b63f1fdd449b5fa0a86eb163b476edd538dbf2b8de970c2cb9ccd6b774f25),
               y: uint256(0x00e4c1818dd76240ff41eb71fa997768a28be5ba345b818a824ae3f5ac7ea350)
            }),
            qElliptic: Honk.G1Point({ 
               x: uint256(0x231eee684779c174918fadc201c625c3c16fac506f524ed19ee26c7a705cde21),
               y: uint256(0x08214ee9d7380599c4b03530310874fefbc0a2c91d9256dc99629ee3089fb8c1)
            }),
            qMemory: Honk.G1Point({ 
               x: uint256(0x0b97139fea945000cc16198a7538461b22f44ad1f5e06c4ddef42aa4fa1cdd69),
               y: uint256(0x07cfd4eab56683cac2c3edb67c7cadb7929a7eca85aaebe92a39b268811cfe8d)
            }),
            qNnf: Honk.G1Point({ 
               x: uint256(0x0e7b2bec6e61679f6743a2a637bf91638ae72bbda1e8e80ccff4e6fb98e42280),
               y: uint256(0x117856faace992e16c0719a58214691bad4ff6c0753210f922930429d7581aa0)
            }),
            qPoseidon2External: Honk.G1Point({ 
               x: uint256(0x022751fe05536b99bb9ecc9a32eb45686104731eb8d1d1ac8d2532bae516a8fd),
               y: uint256(0x055fa6d9ea114a5fd1801c47d8a6749b9b99e135bcbe747ff7fc1bc4762fcb4b)
            }),
            qPoseidon2Internal: Honk.G1Point({ 
               x: uint256(0x1e0af23c4a8bfe7be8ab55247defc73e4dd519143541cb16bd7bda04072cfe92),
               y: uint256(0x2b530242db3fc18859a93907340cc7265a1fa2b552c9e0b8a26c749829ec83a2)
            }),
            s1: Honk.G1Point({ 
               x: uint256(0x05775e6862466e4be3f25335e56c07f32e9d79bf8fd030c654926619b8b751a8),
               y: uint256(0x12ea93aa15942722f74b3db92294d3a7f838d633eb2924ef7d86721f0a0f74f0)
            }),
            s2: Honk.G1Point({ 
               x: uint256(0x0a251db108a498f6d4b3a941962a5296a70e7255e056574c9edf52492584e9b8),
               y: uint256(0x0bcf4aefd3a55b1ce9db962719b7f7b881215ed4368fa317758f3ec28847a3e8)
            }),
            s3: Honk.G1Point({ 
               x: uint256(0x041303003e2da69f5b3c4babedc8e80d49014582e2b92d85458619271ba84618),
               y: uint256(0x26505eb9c9c76905946cac33ee2dd126065a9ab3c065d3b8c532fbcbbca23c18)
            }),
            s4: Honk.G1Point({ 
               x: uint256(0x2caf3cf06e5c1acfca71001c98528ef2dc50609b2ae4d1be5ebfbcf328654886),
               y: uint256(0x0991beaeb318e796443a2890b9f3a77f7b40dc4d9e3423a7f70c34d29cefa754)
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
               x: uint256(0x0d624a3a82e1624d238c9a18cb5af03ae987cc398cf23c7a03357ecafe256f68),
               y: uint256(0x2b7fd5f561f4ac8466e02a775a908fef5a9b1c824f55c135edfd8441b82b6b1b)
            }),
            id2: Honk.G1Point({ 
               x: uint256(0x1ed664c507350295a761f3fc99c54e5afa87987ca8dbac422522191ecc523283),
               y: uint256(0x28697119b2eecef2750590b1ffc16f2ee1ea2152ef024fda55b4a6b5d0809327)
            }),
            id3: Honk.G1Point({ 
               x: uint256(0x1217ce8091d504ce61526f895ef0717cd3b227a89e8ac8159666b786bf2b450c),
               y: uint256(0x11d95de0de386452a711b14e4355b0924ca5002727448cc15cf7a4af22eaf3b0)
            }),
            id4: Honk.G1Point({ 
               x: uint256(0x0cbcafc6688616e0deecdaa0c9bcea5a654929a945bd5efdcf592e9e67e8e83d),
               y: uint256(0x0dd0e48005a5094f4555bfde40fe212a31760a0ea92bcf23a93290c5d4600720)
            }),
            lagrangeFirst: Honk.G1Point({ 
               x: uint256(0x0000000000000000000000000000000000000000000000000000000000000001),
               y: uint256(0x0000000000000000000000000000000000000000000000000000000000000002)
            }),
            lagrangeLast: Honk.G1Point({ 
               x: uint256(0x0d9df162249557227ab7519f925da805fb8999dda269554b340fc69868d68e97),
               y: uint256(0x02c716832298491b167355dd229d28f4b4818cac526666b327a63baf15fe68cc)
            })
        });
        return vk;
    }
}

import {Honk, BaseHonkVerifier} from "./HonkBase.sol";

contract EntityMovementVerifier is BaseHonkVerifier(N, LOG_N, VK_HASH, NUMBER_OF_PUBLIC_INPUTS) {
     function loadVerificationKey() internal pure override returns (Honk.VerificationKey memory) {
       return EntityMovementVerifierVK.loadVerificationKey();
    }
}

