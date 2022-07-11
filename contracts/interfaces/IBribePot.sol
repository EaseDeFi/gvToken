/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

interface IBribePot {
    function deposit(address from, uint256 amount) external;

    function withdraw(address to, uint256 amount) external;

    function exit(address user) external;

    function getReward(address user) external returns (uint256);

    function earned(address user) external view returns (uint256);

    function balanceOf(address user) external;
}
