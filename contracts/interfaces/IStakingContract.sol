/// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.11;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingContract {
    /// @dev Allows user to deposit ease token and recieve non transferrable $gvEASE
    /// @param _amount Amount of $EASE token to deposit for $gvEASE
    function deposit(uint256 _amount) external;

    /// @dev Allows user to deposit ease token and recieve non transferrable $gvEASE
    /// for $ARMOR stakers with boosted power
    /// @param _amount Amount of ease tokens recieved after swapping $vArmor for $EASE
    /// @param _timeStart $ARMOR staking time
    /// @param _proof merkle proof of a msg.sender
    function deposit(
        uint256 _amount,
        uint256 _timeStart,
        bytes32[] memory _proof
    ) external;

    /// @dev Allows user to deposit ease token and recieve non transferrable $gvEASE
    /// @param _amount amount of $EASE token to withdraw
    function withdraw(uint256 _amount) external;

    /// @dev Allows user to stake
    /// @param _balancePercent %of $gvEASE power to assign to a rca vault
    /// @param _vault rca-vault to stake $gvEASE power to
    function stake(uint256 _balancePercent, address _vault) external;

    /// @dev Allows user to freeze their $EASE tokens for 3 months
    /// to retain max power or to regain power if it is decaying
    function freeze() external;

    /// @dev Allows anyone to brive $gvEASE to stake against rca-vault
    /// @param _payAmount amount of $EASE to pay the staking protocol
    /// @param _vault rca-vault to stake bribed $gvEASE power to
    function bribe(uint256 _payAmount, address _vault) external;

    /// @dev Returns original $EASE balance + rewards of a user
    /// @param _user addres of a user
    function balance(address _user) external view returns (uint256);

    /// @dev returns weighted $gvEASE balance of the user (aka voting power)
    /// @param _user address of a user
    function power(address _user) external view returns (uint256);

    /// @dev returns bribe cost in $EASE for a month/week
    /// @param _amount Amount of $gvEASE to bribe
    function bribeCost(uint256 _amount) external view returns (uint256);

    /// @dev returns staked amount to each rca-vault
    /// @param _vaults address of rca-vaults
    function vaultStake(address[] memory _vaults)
        external
        view
        returns (uint256[] memory);

    /// @dev set's merkle root of vArmor stakers which will be used
    /// to give initial $gvEASE boost to the vArmor holders
    /// @param _root merkle root of vArmor stakers
    // TODO: need more clarifaction on this should setPower be a function at all?
    //  can't we set it as immutable variable if it is just used for vArmor holders?
    // or do we have anything to do with this in the future?
    function setPower(bytes32 _root) external;

    /// @dev set's cost in $EASE for bribing $gvEASE
    /// @param _newCost updated cost in $EASE
    function adjustBribeCost(uint256 _newCost) external;

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
     * @dev Emitted when the user stakes % of their $gvEASE to
     * RCA Vault
     */
    event Stake(
        address indexed user,
        address indexed vault,
        uint256 percentage
    );

    /**
     * @dev Emitted when the user bribes $gvEASE to stake it to
     * RCA Vault
     */
    event Bribe(address indexed vault, uint256 power, uint256 expiry);

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
        uint64 depositStart;
        uint64 freezeStart;
    }

    /**
     * @dev Bribe details
     */
    struct BribeDetails {
        // TODO: pack this later
        uint256 cost; // cost per 1000 $gvEASE?
        uint256 totalBribed; // total bribed $gvEASE from the protocol
        uint256 pendingRewards; // pending rewards to distribute against bribing
    }
}
