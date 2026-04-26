// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

library Roles {
    uint256 internal constant EDITOR = 1 << 0;
    uint256 internal constant ORACLE = 1 << 1;
}
