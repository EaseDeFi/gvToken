/// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;
import "./GvToken.sol";

contract GvTokenV2 is GvToken {
    function version() external pure returns (string memory) {
        return "V2";
    }
}