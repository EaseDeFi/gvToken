/// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.11;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IStakingContract.sol";
import "../interfaces/IEaseToken.sol";

/**
 * @title EASE Staking Contract
 * @notice Contract for ease tokenomics.
 * @author Ease
 **/
abstract contract StakingContract is IStakingContract {
    using SafeERC20 for IEaseToken;

    /*//////////////////////////////////////////////////////////////
                            CONSTANTS
    //////////////////////////////////////////////////////////////*/
    /// @notice used for handeling decimals
    uint256 private DENOMINATOR = 10000;

    /*//////////////////////////////////////////////////////////////
                            IMMUTABLE STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice ease token
    IEaseToken public immutable token;

    /*//////////////////////////////////////////////////////////////
                        CONTRACT METADATA
    //////////////////////////////////////////////////////////////*/
    string public name;

    string public symbol;

    uint256 public decimals;

    /*//////////////////////////////////////////////////////////////
                        CONTRACT STATE
    //////////////////////////////////////////////////////////////*/

    mapping(address => Balance) private _balance;

    uint256 private _bribeCost;

    uint256 private _power;

    address private _gov;

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    constructor(address _easeToken, address gov) {
        token = IEaseToken(_easeToken);
        _gov = gov;
    }

    /*//////////////////////////////////////////////////////////////
                                MODIFIER's
    //////////////////////////////////////////////////////////////*/
    modifier onlyGov() {
        require(msg.sender == _gov, "only gov");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                    DEPOSIT/WITHDRAW/STAKE LOGIC
    //////////////////////////////////////////////////////////////*/

    function deposit(uint120 _amount) external {
        Balance storage userBalance = _balance[msg.sender];
        unchecked {
            userBalance.amount += _amount;
            // is there a attack vector as block.timestamp can be
            // manipulated to some extent?
            // TODO: is there a problem storing timestamp in uint64?
            userBalance.startTime = uint64(block.timestamp);
        }

        token.transferFrom(msg.sender, address(this), _amount);

        emit Deposit(msg.sender, _amount);
    }

    function withdraw(uint120 _amount) external {
        // calculate reward
        uint256 rewardAmount = _getReward(_amount);

        _balance[msg.sender].amount -= _amount;

        token.safeTransfer(msg.sender, _amount + rewardAmount);

        emit Withdraw(msg.sender, _amount);
    }

    function stake(uint256 _balancePercent, address _vault) external {
        address user = msg.sender;
        uint256 amount = (_balance[user].amount * _balancePercent) /
            DENOMINATOR;
        // TODO: increase % staked amount of vault

        emit Stake(user, _vault, amount);
    }

    function freeze() external {
        _balance[msg.sender].freezed = true;
        // TODO: may need logic to normalize freeze start time
        // so that we can handle reboost logic when user calls
        // freeze while their $gvEASE powe is decaying
        _balance[msg.sender].freezeStart = uint64(block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                            BRIBE LOGIC
    //////////////////////////////////////////////////////////////*/
    function bribe(uint256 _payAmount, address _vault) external {
        // TODO: implement this
    }

    /*///////////////////////////////////////////////////////////////
                        ACCOUNTING LOGIC
    //////////////////////////////////////////////////////////////*/
    // TODO: All accounting logic of this contract should be done here

    /*//////////////////////////////////////////////////////////////
                           ONLY DAO
    //////////////////////////////////////////////////////////////*/
    // TODO: clarify if this function be under onlyDAO
    function setPower(uint256 _newPower) external {
        // TODO: implement this
        _power = _newPower;
    }

    function adjustBribeCost(uint256 _newCost) external {
        // TODO: implement this
    }

    /*//////////////////////////////////////////////////////////////
                          VIEWS
    //////////////////////////////////////////////////////////////*/
    function balance(address _user) external view returns (uint256) {
        uint256 userBalance = _balance[_user].amount;
        return userBalance + _getReward(userBalance);
    }

    function power(address _user) external view returns (uint256) {
        // TODO: implement this
    }

    function bribeCost() external view returns (uint256) {
        // TODO: return cost of bribe per month?
        return _bribeCost;
    }

    function vaultStake(address[] memory _vaults)
        external
        view
        returns (uint256[] memory)
    {
        uint256[] memory stakes = new uint256[](_vaults.length);
        for (uint256 i = 0; i < _vaults.length; i++) {
            stakes[i] = _getStakes(_vaults[i]);
        }
        return stakes;
    }

    /*//////////////////////////////////////////////////////////////
                            PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    function _getReward(uint256 _amount) private view returns (uint256) {
        // TODO: calculate reward wrt _amount
        return 1;
    }

    function _getStakes(address _vault) private view returns (uint256) {
        // TODO: calculate stakes of a vault
        return 1;
    }
}
