/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

interface IGvToken {
    /* ========== STRUCTS ========== */
    struct MetaData {
        string name;
        string symbol;
        uint256 decimals;
    }

    struct Deposit {
        uint128 amount;
        uint128 start;
    }

    struct PermitArgs {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct WithdrawRequest {
        uint128 amount;
        uint128 endTime;
    }

    struct SupplyPointer {
        uint128 amount;
        uint128 storedAt;
    }

    struct GrowthRate {
        uint128 start;
        uint128 expire;
    }
    struct DelegateDetails {
        address reciever;
        uint256 amount;
    }

    /// @notice A checkpoint for marking number of votes from a given block
    struct Checkpoint {
        uint32 fromBlock;
        uint256 votes;
    }
    /* ========== EVENTS ========== */
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

    event DelegateVotesChanged(
        address indexed delegate,
        uint256 previousBalance,
        uint256 newBalance
    );
    event DelegateChanged(
        address indexed delegator,
        address indexed fromDelegate,
        address indexed toDelegate
    );
}
