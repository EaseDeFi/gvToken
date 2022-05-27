/// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.11;

interface IStakingContractV1 {
    /// @dev Allows user to deposit ease token and recieve non transferrable $gvEASE
    /// @param amount Amount of $EASE token to deposit for $gvEASE
    function deposit(uint256 amount) external;

    /// @dev Allows user to deposit ease token and recieve non transferrable $gvEASE
    /// @param amount amount of $EASE token to withdraw
    function withdraw(uint256 amount) external;

    /// @dev Allows user to stake
    /// @param balancePercent %of $gvEASE power to assign to a rca vault
    /// @param vault rca-vault to stake $gvEASE power to
    function stake(uint256 balancePercent, address vault) external;

    /// @dev Allows user to unstake
    /// @param balancePercent %of $gvEASE power to assign to a rca vault
    /// @param vault rca-vault to stake $gvEASE power to
    function unStake(uint256 balancePercent, address vault) external;

    /// @dev Allows anyone to brive $gvEASE to stake against rca-vault
    /// @param payAmount amount of $EASE to pay the staking protocol
    /// @param vault rca-vault to stake bribed $gvEASE power to
    /// @param period number of weeks user wants to bribe for
    function bribe(
        uint256 payAmount,
        address vault,
        uint256 period
    ) external;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Emitted when the user deposits $EASE token to our
     * Staking Contract
     */
    event Deposit(address indexed user, uint256 amount);

    /**
     * @dev Emitted when the user withdraws $EASE token from our
     * Staking Contract
     */
    event Withdraw(address indexed user, uint256 amount);

    /**
     * @dev Emitted when the user withdraws $EASE token from our
     * Staking Contract
     */
    event Stake(
        address indexed user,
        address indexed vault,
        uint256 percentage
    );

    /**
     * @dev Emitted when the user stakes % of their $gvEASE to
     * RCA Vault
     */
    event UnStake(
        address indexed user,
        address indexed vault,
        uint256 percentage
    );

    /**
     * @dev Emitted when the user request for withdraw
     * from their frozen account
     */
    event RedeemRequest(address indexed user, uint256 amount, uint256 endTime);

    /**
     * @dev Emitted when the user request for withdraw
     * from their frozen account
     */
    event RedeemFinalize(address indexed user, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                STRUCTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Data we need to calculate weighted gvToken balance/power
     * of a user
     */
    // trying pack user details within 32bytes to calculate $gvEASE weighted balance
    // need inspection if this will not cause any problem
    struct Balance {
        uint128 amount;
        uint16 startWeek;
        uint32 startTime;
    }

    struct BribeDetail {
        uint16 startWeek;
        uint16 endWeek;
        uint112 ratePerWeek; // Amount paid in ease tokens per week
    }

    struct RewardPot {
        uint128 slashed;
        uint128 bribed;
    }

    struct BribeExpiry {
        uint112 bribeRate;
        uint112 totalBribe;
    }

    struct WithdrawRequest {
        uint128 amount;
        uint64 endTime;
    }
}
