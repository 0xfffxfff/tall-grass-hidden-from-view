// SPDX-License-Identifier: Apache-2.0
// Copyright 2022 Aztec
pragma solidity >=0.8.21;

uint256 constant N = 8192;
uint256 constant LOG_N = 13;
uint256 constant NUMBER_OF_PUBLIC_INPUTS = 20;
uint256 constant VK_HASH = 0x006118fc88ed6d9eb87d6fd66f42b544d417299f5664642b025da49dd58112d3;
library MovementVerifierVK {
    function loadVerificationKey() internal pure returns (Honk.VerificationKey memory) {
        Honk.VerificationKey memory vk = Honk.VerificationKey({
            circuitSize: uint256(8192),
            logCircuitSize: uint256(13),
            publicInputsSize: uint256(20),
            ql: Honk.G1Point({ 
               x: uint256(0x008a70243b7fe5d6e52203e7961a5a38565336282c4bf197abf2aed32019de34),
               y: uint256(0x25115d9e1a18bc9de9939a7d83c3363a54ab7ef90c6a894ba6d5594d5a6836e1)
            }),
            qr: Honk.G1Point({ 
               x: uint256(0x182bc78a74e197c40b1bb28e818acd07ccd0ef2be9625765712d7af71cae7fb3),
               y: uint256(0x1217c8276a46f3b793739f5edf2b8faa16b7037d2922f4a1191c3759082de5c8)
            }),
            qo: Honk.G1Point({ 
               x: uint256(0x0ea2f2148e106440fc5a99ce970a526c1bb94f39524bb5346313a0368345b61a),
               y: uint256(0x2a511dbba3eb876575802c7aeb33e40e73cfa9bf492386abe3ac6f00da84fc53)
            }),
            q4: Honk.G1Point({ 
               x: uint256(0x03aaab12f6ada65f008ade9976cc90e4d07e853eb3e86e031bc0dd40f85a5166),
               y: uint256(0x25ace6bf6c329ab37af53fedc880c2d8811673aa404350e6a274143f0ac90adc)
            }),
            qm: Honk.G1Point({ 
               x: uint256(0x140b0a7a75e34abd2b3c8bcd7d15256433794f852636f0f16ae6e36f35a3d174),
               y: uint256(0x29639482cf366e9212189e24d384d06ec3df063e16ab62c41a5e16eedc1f64b4)
            }),
            qc: Honk.G1Point({ 
               x: uint256(0x2630b386f2dababade44cf45bf3b7be888b9cd28d59538fb757a83ac0279fd11),
               y: uint256(0x253f83e417d4428090fbebc2a99c0da7843c41c11de7e5f6da99aa5d7e29cd5b)
            }),
            qLookup: Honk.G1Point({ 
               x: uint256(0x038147f7985ab2a8d179a7a764ee622afc5cac5dabeb8f74a2f89ad33f068fe4),
               y: uint256(0x24095afc77887b20f8293c4a2602c55c7f68b34721dbdaa9d8f2cfc9f432da95)
            }),
            qArith: Honk.G1Point({ 
               x: uint256(0x0cf9228b695236329b0e15b7f8519a66baf9abcfee7fe4f0a358209fbd85c95e),
               y: uint256(0x2b91c5a5c0127904bb14684bc612a681b9ade204dea5d262a5598cd4e1ffe552)
            }),
            qDeltaRange: Honk.G1Point({ 
               x: uint256(0x21c2248e87376eebfc5ef086c8e60bd0d89531ba45f7a70bca7969264b6fdb90),
               y: uint256(0x04eaca84eb41fb2650f37825cb230e1e5d9c976227b4695a57646439041a4d6f)
            }),
            qElliptic: Honk.G1Point({ 
               x: uint256(0x1ccf3debe079fae8853fc94be0f7d217926f0de07691706655e161247785f480),
               y: uint256(0x28a41dcb3b33b422a91ad0fb945950aba1107a738803fb53d0bdb09236ca69dd)
            }),
            qMemory: Honk.G1Point({ 
               x: uint256(0x213c0ee5d2185b85bf682dcc43cf8a4dedca39f050fc501bb6f2bab0f18963ed),
               y: uint256(0x25f98d94f8a333bfb0ea091e844a56a85ee0d023c6e4c06f62339c8997207670)
            }),
            qNnf: Honk.G1Point({ 
               x: uint256(0x23657779662dea829f63dc7ac6232ee37ee6ce5dedd74d2968304a47abf5d19d),
               y: uint256(0x2b4cc97d42756b6e0a7cedfdea2223f309b5894cd84e0a287e5dce2adb2883c5)
            }),
            qPoseidon2External: Honk.G1Point({ 
               x: uint256(0x001322391f5fdaa9238bd18a903a103ddc3d4c4c328d0281b386fc34234c8620),
               y: uint256(0x1e6cf26d7eb4b7dce44d7bf9045230d27e37f83f7aea98e23149784a1d9298c7)
            }),
            qPoseidon2Internal: Honk.G1Point({ 
               x: uint256(0x1e8d962db9e37df262dda82bd2f114059161f6448b3e6e20e0ef6fa23ba0fc75),
               y: uint256(0x0033e9209d729369dd7065885e27ff612e0d308ffdf9852aa9ce7ef9418e1a74)
            }),
            s1: Honk.G1Point({ 
               x: uint256(0x1781f187504326dcd345ab22880eac2744576eae58a0075c956840347da7497d),
               y: uint256(0x10a15582a388ee5d32424f0cf3a44c7c1fd343aa8f1be7437ad38b0f169ff4b3)
            }),
            s2: Honk.G1Point({ 
               x: uint256(0x05af35a4c940dca9f31e61b29af3b9aa0c8bdad3cb359589a516cb4345eec2ed),
               y: uint256(0x1b313f964dde5f61895c647265bd2aa05897a2cf11044cc1ed9ee2678de273dd)
            }),
            s3: Honk.G1Point({ 
               x: uint256(0x1122b049f8e642f2fd4f0a035355202d91952b71ed2c5f45fb4d912025c053e4),
               y: uint256(0x00d9608d29311518a5ee85144ec9a8421d81b4754d462d3c656bcf73221761a2)
            }),
            s4: Honk.G1Point({ 
               x: uint256(0x27fff13ff89dcb43d3eb5da11cfc0bde2902c9aaf2d0fe165e8892804f802225),
               y: uint256(0x0447df4ff56f2e3d5f74dd9f2cbfd6555ef3fe5c853599a61a26c024d9d61365)
            }),
            t1: Honk.G1Point({ 
               x: uint256(0x0cb15289361c0a0e1b78f25efb7e6f3cee056cd8653f11fe91bec67f9a1ba501),
               y: uint256(0x29664df9e7f07b4aec2f396f6cde12443f54f12a87c2cf5182f3620fc1944c6d)
            }),
            t2: Honk.G1Point({ 
               x: uint256(0x070b433d46367e191b9bf40eef28b673875103abf917a76019cf7bba4da77621),
               y: uint256(0x26eccd7100479fc88688e129589197a0af4c7b9ef86fe2480692f5f6dc52534a)
            }),
            t3: Honk.G1Point({ 
               x: uint256(0x1405e19e273c5580bad70f8aa520fe829fc0f335a16c7395a41df3e3f2082479),
               y: uint256(0x0c993922fcb992ff09e1fe7e4987cd12df79fa6af70aafb066b791292b5c56bf)
            }),
            t4: Honk.G1Point({ 
               x: uint256(0x0082e0b52e8df94612b14bc2afb9f76f575a60d3c9d50fc277988d94997a5ddb),
               y: uint256(0x26a696f75adf15d5934d9edad81c9bfe073ff12f2bad78b10ae4a1629516a075)
            }),
            id1: Honk.G1Point({ 
               x: uint256(0x279359773dd5a0a8f98228661e68aca256f464d07ba22c0a7713b80c3bc0327c),
               y: uint256(0x23771b91dfb638ef9ec158657ae4039d45bebb3a4676f7b4c7a2d701d0d292b0)
            }),
            id2: Honk.G1Point({ 
               x: uint256(0x08621886a2d319a800a6f93c65f79b2f9cecfb95f273c353e0f6f9579ddef515),
               y: uint256(0x1a1de47ba06378f0280329a992c00cd1364da06ec1a456bda6dde3e60d2fb786)
            }),
            id3: Honk.G1Point({ 
               x: uint256(0x0ba693356f74c3564ae450f5abfee4a419d3ba86edd9d8103b3a8c0410f1cf13),
               y: uint256(0x2fb08b0e86aea4ee6182a2ea7ef235f176a5f8348cefd3e9779b290d029162bf)
            }),
            id4: Honk.G1Point({ 
               x: uint256(0x22624487f8b9dee7ff8ebbc4f55984c2e62d52060a5007fcd96225fe71dc830a),
               y: uint256(0x149ce21dff79ef89b72ed03867c884dadd34b079736a847e63c3e1764b0ee1c5)
            }),
            lagrangeFirst: Honk.G1Point({ 
               x: uint256(0x0000000000000000000000000000000000000000000000000000000000000001),
               y: uint256(0x0000000000000000000000000000000000000000000000000000000000000002)
            }),
            lagrangeLast: Honk.G1Point({ 
               x: uint256(0x0e37326ed28b29785d9790b819c7cf7bbce6fb38b5ceed9d4acfaec303a274ba),
               y: uint256(0x2abc266e7136634c62d302cbf2aea25702d2410abd0e698606a41b649f350606)
            })
        });
        return vk;
    }
}

import {Honk, BaseHonkVerifier} from "./HonkBase.sol";

contract MovementVerifier is BaseHonkVerifier(N, LOG_N, VK_HASH, NUMBER_OF_PUBLIC_INPUTS) {
     function loadVerificationKey() internal pure override returns (Honk.VerificationKey memory) {
       return MovementVerifierVK.loadVerificationKey();
    }
}

