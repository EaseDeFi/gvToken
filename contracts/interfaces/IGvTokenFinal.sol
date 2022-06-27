/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

interface IGvTokenFinal {
    /* ========== CONSTANTS ========== */
    struct Deposit {
        uint128 amount;
        uint32 start;
        bool withdrawn;
    }

    struct PermitArgs {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct WithdrawRequest {
        uint112 amount;
        uint112 rewards;
        uint32 endTime;
    }
    /* ========== CONSTANTS ========== */
    event Deposited(address indexed user, uint256 amount);
    event RedeemRequest(address indexed user, uint256 amount, uint256 endTime);
    event RedeemFinalize(address indexed user, uint256 amount);
    event Stake(
        address indexed user,
        address indexed vault,
        uint256 percentage
    );

    event UnStake(
        address indexed user,
        address indexed vault,
        uint256 percentage
    );
}
