// SPDX-License-Identifier: Apache-2.0
// Copyright 2022 Aztec
pragma solidity >=0.8.21;

uint256 constant N = 16384;
uint256 constant LOG_N = 14;
uint256 constant NUMBER_OF_PUBLIC_INPUTS = 1021;
uint256 constant VK_HASH = 0x0ae8aa65880d4603e26906b4c0cf2c42bca0c6d8919baeb5d13158fa8fc6d3a1;
library DecryptionVerifierVK {
    function loadVerificationKey() internal pure returns (Honk.VerificationKey memory) {
        Honk.VerificationKey memory vk = Honk.VerificationKey({
            circuitSize: uint256(16384),
            logCircuitSize: uint256(14),
            publicInputsSize: uint256(1021),
            ql: Honk.G1Point({ 
               x: uint256(0x1daea210c63624a4012fa514498705c4127a24edbf7ef958c3bfae9621cab8b4),
               y: uint256(0x184d70b8470357f5603f222972fab946281c96108aaa40849fb07f24eb6f374d)
            }),
            qr: Honk.G1Point({ 
               x: uint256(0x17641e33f8e3b2e1dcfd4b8684d8a99398ed655d6bc05527524223f6e37ccc25),
               y: uint256(0x2019ba2b5931654260acfb3dc18d6467381a82cb19cbe29ddebd2fcdd78dfbff)
            }),
            qo: Honk.G1Point({ 
               x: uint256(0x2613ef6dd446df71ddcbf6415cf4ff7b88d57f12ccc7b9d25bdf6ef0b786b97c),
               y: uint256(0x2ee6ac8cf1e24e0ffe16330ed13cb28376cf6d064aae10c32e7c49d85ead4cd8)
            }),
            q4: Honk.G1Point({ 
               x: uint256(0x10f1bf883e5e2239120517cd888e682cc24e263f19e24680da97c7e8d9f7e782),
               y: uint256(0x1cbea7d9dd92f6ac133508a4e073a3438825d8e259262b2cd6d329d884d026cc)
            }),
            qm: Honk.G1Point({ 
               x: uint256(0x278a89a81cbd80f02f5b86054137c569aa7516ab7883474163f3397058187490),
               y: uint256(0x0ebc80e2ee747a1a96f6fd16a419178d7c5036fdb32d0a797c0067d11889986e)
            }),
            qc: Honk.G1Point({ 
               x: uint256(0x2a746db7704cd92678eff1512d31a58a40fb2967d93b3d0cc7559b9c3aecc56f),
               y: uint256(0x135f338f667bc90ffda370606ef7d572ca7db1460d1515679898c0e95c8bb116)
            }),
            qLookup: Honk.G1Point({ 
               x: uint256(0x14dd1ce931af2f1a008cdb4e13fcb4bb5f3adb8b1a360885d949225f796e05a2),
               y: uint256(0x11a7654358d84ce23eb3f3714bc52d36efffbc6387a0d74ed1271a8ce1566b7d)
            }),
            qArith: Honk.G1Point({ 
               x: uint256(0x1d08e08c4ec15872650c8b13e3a679c986b9afba8e925156b9673d2829baa4e1),
               y: uint256(0x1bd0d496dc53e0ecb6cebde1eef5c3e7cc52961f9f42b89d0935925ea1e0eabd)
            }),
            qDeltaRange: Honk.G1Point({ 
               x: uint256(0x22171329b1e79b8d25a0266d29c146431283fddb059b600e884a2648bf72f813),
               y: uint256(0x0b00a4f03b192967f7760ae168c144600472243fcc9edc2c88b741b8b522af15)
            }),
            qElliptic: Honk.G1Point({ 
               x: uint256(0x2de08dfe004324f7aa58bf0417b745793d9cd662c3f62558376e782add520dde),
               y: uint256(0x019c4c3c7dde243ab649158e68a3338c024a76712cf131e81e88b571b78c2a8b)
            }),
            qMemory: Honk.G1Point({ 
               x: uint256(0x299bc2d8ede39dff5a17fa0e5d8a7899f3cc86a161dcd605453f16a7f04d47ed),
               y: uint256(0x2207d4b3b395dabf9e242da6e2dc35a25b1312637a19a5d77f7ab638e27a8d7f)
            }),
            qNnf: Honk.G1Point({ 
               x: uint256(0x0390ee62759bdf8e9f1f75c5f6381ee4699474a2ff548cc1ead904f01a84831b),
               y: uint256(0x03ab7c3643c01eafdc36d2c7dde6e2b0434d6678dc127e60158069360ec9848a)
            }),
            qPoseidon2External: Honk.G1Point({ 
               x: uint256(0x0f80912643ea05e92ee4d166a326739d6155fe0056d67b665f9d040a0ebabf75),
               y: uint256(0x1a4aefa957097f773ace6f9d0e7cb02a36c435e10c716faccfb4dedc302cf934)
            }),
            qPoseidon2Internal: Honk.G1Point({ 
               x: uint256(0x10a85e150a4afd201317baf91d4ce76ff22785c90ad22e68a71cf450cbdd7a25),
               y: uint256(0x092f65ad0273825705b50c0cabefb0cfdd2a0d7af7a7324a9b97f6b17462663d)
            }),
            s1: Honk.G1Point({ 
               x: uint256(0x2c6e0296ec342f5b98f512910dc974b13dc9dd124274f3bc29e56a9577e19408),
               y: uint256(0x09eba6066ee2f02504a96a2631612c03b50bbe313a4fb054f84ccaeab05ba47a)
            }),
            s2: Honk.G1Point({ 
               x: uint256(0x0817d211001a6210dcfa46b3fadbf71e90b666d429cfb0a511cef91b48d46db7),
               y: uint256(0x09f1c0b5add1720d682dd1f107cc4853ce58444db12bef55584ffc31af901c85)
            }),
            s3: Honk.G1Point({ 
               x: uint256(0x2b24bb3a4bc9bf6f1178fb6d663f27d0187b5245dc8425ad25a21cfb49cfea2c),
               y: uint256(0x30625ad6e3a599ea9da49d1c1acf2136ad6ef21b768c5c0dac75636ecced9d72)
            }),
            s4: Honk.G1Point({ 
               x: uint256(0x21f14482d7d5c679c796b1506e7f9dc639a3a08a3c37b853feedc5c4e3473ab4),
               y: uint256(0x076bf176fc2cb4e318498b57dec784ef7f6c0862ff62e256e84794fa9468998c)
            }),
            t1: Honk.G1Point({ 
               x: uint256(0x041b4073446b5892dd7eabf545028e2a1ca163046e9d0415b0ba9d9c4632f07b),
               y: uint256(0x005d24fbb51390fb1488b82145f51418573a8cb7efc197b5371780de35eb55de)
            }),
            t2: Honk.G1Point({ 
               x: uint256(0x0a58ab84bec6105d9533d7b52c7d46be862a90b3a83a75d1073b4235299d88d2),
               y: uint256(0x072b71091d1ef407e20d0d0cd1689c67f3b2aebec2b7b606d0d11e571da53cf7)
            }),
            t3: Honk.G1Point({ 
               x: uint256(0x26cd38a986f17cbd48fe1f6dfb5a0046c3574dc85c47790ef4c28da426bf3439),
               y: uint256(0x0dad5bdae552b07915f2ba16ca717736e845cb1a0b351511cfb7d51a7d48cd84)
            }),
            t4: Honk.G1Point({ 
               x: uint256(0x2141cda9c7a8779c338b16176c47d8b75e5f1b657d31d571204511d018db5e63),
               y: uint256(0x029ef7d95d44f73300dfdc5d1f7857dfb867822f826d7f1bae92c942bc587396)
            }),
            id1: Honk.G1Point({ 
               x: uint256(0x18f7447434a871cc685a48060d1c41039481b98030f44b659d4f157f9a1a3327),
               y: uint256(0x1575825a414c82ab03b66d6543d7d2cd78c3673f2131e588c6e0d871ba57f75f)
            }),
            id2: Honk.G1Point({ 
               x: uint256(0x1e9eb0d1e4e552849712353558a5490238e60158648da5d303da584ed2c55784),
               y: uint256(0x0dfa106716f03b978a1e6442701fbe2a70cb470e6883ff6949682b3ab0d98443)
            }),
            id3: Honk.G1Point({ 
               x: uint256(0x0d8934ec54394b853d6722ce9d08d89ea12b1056cc3927399785ffa6710fecf2),
               y: uint256(0x0b462e09235015a9cf4ce44d3c6709f48061b91e37db5ad71fd311228c4744b2)
            }),
            id4: Honk.G1Point({ 
               x: uint256(0x2611213abc86b5b1e3bd872ed23b65bf83cc0ec1011aa6c7467b0605a0c0782c),
               y: uint256(0x1cbe1100dc07cf6d24c855a339727685ad069b7112e5538236cdc653cb7133c9)
            }),
            lagrangeFirst: Honk.G1Point({ 
               x: uint256(0x0000000000000000000000000000000000000000000000000000000000000001),
               y: uint256(0x0000000000000000000000000000000000000000000000000000000000000002)
            }),
            lagrangeLast: Honk.G1Point({ 
               x: uint256(0x20273f499e0a965b88880f6648dfed7601f3bb523fcd00d067f4e83cf896f41f),
               y: uint256(0x282361f9acdd01566020869626b9bf9d297523946f64ccf9910eec8de15948bf)
            })
        });
        return vk;
    }
}

import {Honk, BaseHonkVerifier} from "./HonkBase.sol";

contract DecryptionVerifier is BaseHonkVerifier(N, LOG_N, VK_HASH, NUMBER_OF_PUBLIC_INPUTS) {
     function loadVerificationKey() internal pure override returns (Honk.VerificationKey memory) {
       return DecryptionVerifierVK.loadVerificationKey();
    }
}

