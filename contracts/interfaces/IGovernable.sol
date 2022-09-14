/// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.11;

interface IGovernable {
    function transferOwnership(address payable newGovernor) external;

    function receiveOwnership() external;
}
