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

    /// @dev returns weighted $gvEASE balance of the user (aka voting power)
    /// @param _user address of a user
    function power(address _user) external view returns (uint256);

    /// @dev set's merkle root of vArmor stakers which will be used
    /// to give initial $gvEASE boost to the vArmor holders
    /// @param _root merkle root of vArmor stakers
    // TODO: need more clarifaction on this should setPower be a function at all?
    //  can't we set it as immutable variable if it is just used for vArmor holders?
    // or do we have anything to do with this in the future?
    function setPower(bytes32 _root) external;

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
        uint32 depositStart;
        uint32 rewardStart;
    }

    struct BribeDetail {
        uint16 startWeek;
        uint16 endWeek;
        bool exists;
        uint112 rate; // Amount paid in ease tokens per week
    }

    struct BribeRate {
        uint112 startAmt;
        uint112 expireAmt;
    }

    struct WithdrawRequest {
        uint128 amount;
        uint32 endTime;
    }
}
