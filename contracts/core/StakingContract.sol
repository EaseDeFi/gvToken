/// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.11;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../library/MerkleProof.sol";

import "../interfaces/IStakingContract.sol";
import "../interfaces/IEaseToken.sol";

/**
 * @title EASE Staking Contract
 * @notice Contract for ease tokenomics.
 * @author Ease
 **/

//  TODO: I think we should epoch of 1 week to increase gvPower
// so that bribing will be simpler? Discuss this with Robert when you
// have solid arguments to support the statement.

/* NOTE: Situations that are not addressed in this contracts as of now

1. requestWithdraw() and finalizeWithdraw() for frozen accounts

2. distribution of rewards for the bribed power probably we should do this
every epoch (1 week?). We need to figure that out. Calculating rewards
can get complicated as there are many bits and pieces that need to coordinate 
with each other (what happens if)

3. 
*/

// NOTE: keep in mind that our staking contract and governance should
// not be subject to attack like B.protocol did with flash loan.
// find a way to mitigate them if any
// Article Topic: 'Flash Loans' Have Made Their Way to Manipulating Protocol Elections
// Compound's Solution: https://github.com/makerdao/ds-chief/pull/1/files

abstract contract StakingContract is IStakingContract {
    using SafeERC20 for IEaseToken;

    /*//////////////////////////////////////////////////////////////
                            CONSTANTS
    //////////////////////////////////////////////////////////////*/
    uint256 private constant BUFFER = 10**18;
    uint64 private constant MAX_GROW = 52 weeks;
    // TODO: you can only freeze for 3 months?
    uint64 private constant MAX_FREEZE = 12 weeks;
    /// @notice max percentage
    uint128 private constant DENOMINATOR = 10000;

    /*//////////////////////////////////////////////////////////////
                            IMMUTABLE STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice ease token
    IEaseToken public immutable token;

    /*//////////////////////////////////////////////////////////////
                        CONTRACT METADATA
    //////////////////////////////////////////////////////////////*/
    string public name = "Growing Vote EASE";
    string public symbol = "gvEASE";
    uint256 public immutable decimals = 18;

    /*//////////////////////////////////////////////////////////////
                        CONTRACT STATE
    //////////////////////////////////////////////////////////////*/

    // userAddress => balanceDetails
    mapping(address => Balance) private _balance;
    // user => total % staked
    mapping(address => uint256) private _userStakes;

    // cost in $EASE per 1000 gvEASE
    // QUESTION: tbh shouldn't bribe cost be dynamic?
    // I know it's gonna make things complicated just trying to
    // think out loud. If you are gonna ask me how I don't know
    // solution yet lol.
    BribeDetails private bribeDetails;

    bytes32 private _powerRoot;

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

    function deposit(uint256 _amount) external {
        _deposit(uint128(_amount), uint64(block.timestamp), msg.sender);
        emit Deposit(msg.sender, _amount);
    }

    // for vArmor holders
    function deposit(
        uint256 _amount,
        uint256 _timeStart,
        bytes32[] memory _proof
    ) external {
        // TODO: DISCUSS: Scenario.
        // How we create merkle root so that verification works as expected?
        // It is important to use _amount in leaf because user can stake small
        // amount of $Armor and try to deposit more $EASE tokens when calling this
        // function and get extra staking timeStart benefit.
        // Need to figure this out.
        bytes32 leaf = keccak256(
            abi.encodePacked(msg.sender, _amount, _timeStart)
        );
        // require this
        require(MerkleProof.verify(_proof, _powerRoot, leaf), "invalid proof");
        _deposit(uint128(_amount), uint64(_timeStart), msg.sender);
    }

    function _deposit(
        uint128 _amount,
        uint64 _timeStart,
        address _user
    ) private {
        Balance memory userBalance = _balance[_user];
        if (userBalance.amount == 0) {
            userBalance.depositStart = _timeStart;
        } else {
            // normalize time
            // (currentBal * startTime + newBal * block.timestamp) / (currentBal + newBal)
            userBalance.depositStart = uint64(
                uint256(userBalance.amount) *
                    uint256(userBalance.depositStart) +
                    (_amount * _timeStart) /
                    (uint256(userBalance.amount) + _amount)
            );
        }
        // TODO: what happens if user has freezed their balance and try to add
        // more ease tokens to the contract? figure this out
        if (userBalance.freezeStart + MAX_FREEZE > block.timestamp) {
            // normalize freeze time
            // lastFreezeTime * totalFreezedAmount + block.timestamp * newAmount /
            // (totalFreezedAmount + newAmount)
            userBalance.freezeStart = uint64(
                (uint256(userBalance.amount) *
                    uint256(userBalance.depositStart) +
                    (_amount * _timeStart)) /
                    (uint256(userBalance.amount + _amount))
            );
        }
        // update balance
        userBalance.amount += _amount;

        // Question: how to know what's up for sale tbh? As user's staked amount
        // is stored in % it's hard to calculate total staked % I think
        // I may need a staked variable where I can store % staked of the user?

        // update address(0) balance that we use to store amount
        // for bribing
        Balance memory forSaleBal = _balance[address(0)];
        if (forSaleBal.amount > 0) {
            forSaleBal.depositStart = uint64(
                uint256(forSaleBal.amount) *
                    uint256(forSaleBal.depositStart) +
                    (_amount * _timeStart) /
                    (uint256(forSaleBal.amount) + _amount)
            );
        } else {
            forSaleBal.depositStart = _timeStart;
        }
        forSaleBal.amount += _amount;

        // update for sale balance
        _balance[address(0)] = forSaleBal;
        // update user balance
        _balance[_user] = userBalance;

        token.transferFrom(_user, address(this), _amount);
    }

    // TODO: Should there be finalize withdraw for freezed accounts
    function withdraw(uint128 _amount) external {
        // calculate reward
        // check if amount is freezed
        address user = msg.sender;
        Balance memory userBal = _balance[user];
        require(
            userBal.freezeStart + MAX_FREEZE < block.timestamp,
            "account frozen"
        );

        uint256 rewardAmount = _getReward(userBal);

        // TODO: update this with the concern's described below
        // Update how much is up for bribing
        // I am considering everything that is ever staked is up for bribe
        // which is basically wrong but this is just an outline and need to
        // have a it fast.
        _balance[address(0)].amount -= _amount;

        _balance[user].amount -= _amount;

        token.safeTransfer(user, _amount + rewardAmount);

        emit Withdraw(user, _amount);
    }

    function stake(uint256 _balancePercent, address _vault) external {
        // Question: Why do we need to stake balance in %?
        // probably best thing to store here would be user's staked %
        // and total staked of a vault? what I think is we don't care which vault
        // the user has staked in. All we care is the amount he has already staked
        //
        // QUESTION: What happens if user deposits again after staking?
        // ANS: will it result in increase in %staked to a specific rca-vault?
        address user = msg.sender;
        // TODO: increase % staked amount of vault
        uint256 userStake = _userStakes[user];
        userStake += _balancePercent;
        require(userStake < DENOMINATOR, "can't stake more than 100%");
        // update user staked %
        _userStakes[user] = userStake;

        // update amount for bribe
        uint256 amount = (uint256(_balance[user].amount) * _balancePercent) /
            DENOMINATOR;
        _balance[address(0)].amount -= uint128(amount);

        // TODO: decrease amountForBribe balance (address(0)) balance
        // thoughts on achieving above. Renormalize the startTime of address(0)

        emit Stake(user, _vault, _balancePercent);
    }

    // TODO: QUESTION: Do we need this function?
    function unStake(uint256 _balancePercent, address _vault) external {
        // Unstake from a rca-vault
        // keep power up for sale
    }

    function freeze() external {
        // TODO: may need logic to normalize freeze start time
        // so that we can handle reboost logic when user calls
        // freeze while their $gvEASE power is decaying
        Balance memory userBal = _balance[msg.sender];
        if (userBal.freezeStart != 0) {
            require(
                userBal.freezeStart + MAX_FREEZE < block.timestamp,
                "frozen"
            );
        }
        // should stake for at least an year before you can freeze
        // DISCUSS: I know we have a potential situation here
        // 1. User deposits 10 $EASE and waits for more than a year
        // 2. call's freeze after a year and half
        // 3. Deposits 10,000 $EASE which will bring time start to a place
        //  where timeStamp - depositStart will be less than 1 year
        // 4.Meaning user was able to freeze before the 1 year deadline
        // The question is how will the user get benefit from that?
        // Can we say that the user can use this potential issue and exploit us?
        // Or there's no issue that can cause?
        require(
            (uint64(block.timestamp) - userBal.depositStart) >= MAX_GROW,
            "stake threshold not met"
        );
        // TODO: NORMALIZE FREEZE START
        // TODO: write helper function for normalization for
        // both deposit and freeze
        if (
            userBal.freezeStart == 0 ||
            (userBal.freezeStart + (2 * MAX_FREEZE)) > block.timestamp
        ) {
            userBal.freezeStart = timeStamp64();
        } else {
            // normalize time
            // TODO: come back and fix me later
            // the reason I am not able to come up with a quick solution here
            // is because what if the user calls freeze() and waits for MAX_FREEZE
            // and call freeze again? I think there should not be time limit as
            // MAX_FREEZE? as user's power can increase upto 200% and never beyond
            // that? there's a room for discussion here
            userBal.freezeStart = timeStamp64();
        }

        _balance[msg.sender] = userBal;
    }

    /*//////////////////////////////////////////////////////////////
                            BRIBE LOGIC
    //////////////////////////////////////////////////////////////*/
    function bribe(uint256 _payAmount, address _vault) external {
        // QUESTION: I think we should pass in amount of power they want to bribe,
        //  time period in months and vaultaddress that way we can make things simpler

        // TODO: should this function call update the expired bribes?
        // depending on their time for example let's say user has bribed gvEASE
        // for 2 months and it has expired that means the amount of gvEASE bribed
        // then should be up for sale again.

        // calculate gvPower being bribed against payAmount
        // is it true that power can be bribed for a fixed period of time?
        uint256 gvPower = (_payAmount * 1000 * 10**decimals) /
            bribeDetails.cost;
        uint256 noOfWeeks = _payAmount / bribeDetails.cost; // expiry in weeks
        // gvPower being bribed should not be more than the amount of power that is for sale
        uint256 powerForSale = _balanceOf(_balance[address(0)]) -
            bribeDetails.totalBribed;
        require(powerForSale >= gvPower, "sale amount < bribe amount");
        // add that power to the vault of choice
        // QUESTION: how to update gvFor bribe on this bribe expiry?
        token.safeTransferFrom(
            msg.sender,
            address(this),
            noOfWeeks * bribeDetails.cost
        );

        // TODO: this should be updated once the bribe period expires
        // update total bribed $gvEASE
        bribeDetails.totalBribed += gvPower;
        // TODO: add something to monthly payouts?

        emit Bribe(_vault, gvPower, noOfWeeks * 1 weeks);
    }

    /*///////////////////////////////////////////////////////////////
                        ACCOUNTING LOGIC
    //////////////////////////////////////////////////////////////*/
    /// @dev calcuates gvEASE balance of a user
    function _balanceOf(Balance memory userBalance)
        private
        view
        returns (uint256)
    {
        uint64 currentTime = timeStamp64();
        // multiplying factor for normal growth upto max growth time
        uint256 multiplyingFactor = ((currentTime - userBalance.depositStart) *
            BUFFER) / MAX_GROW;
        // TODO: refactor increase amount for normal growth and freeze
        // which can be identical just the change being MAX_GROW and MAX_FREEZE
        uint256 increaseAmount;
        if (multiplyingFactor > MAX_GROW * BUFFER) {
            if (multiplyingFactor < 2 * MAX_GROW * BUFFER) {
                increaseAmount =
                    (userBalance.amount *
                        (MAX_GROW * BUFFER * 2 - multiplyingFactor)) /
                    BUFFER;
            }
        } else {
            increaseAmount = (userBalance.amount * multiplyingFactor) / BUFFER;
        }
        // Handle Freeze
        // update multiplying factor for FROZEN accounts
        multiplyingFactor =
            ((currentTime - userBalance.freezeStart) * BUFFER) /
            MAX_FREEZE;
        if (multiplyingFactor > MAX_FREEZE * BUFFER) {
            // does this mean that the power has started decreasing?
            if (multiplyingFactor < 2 * MAX_FREEZE * BUFFER) {
                increaseAmount +=
                    (userBalance.amount *
                        (MAX_FREEZE * BUFFER * 2 - multiplyingFactor)) /
                    BUFFER;
            }
        } else {
            increaseAmount += (userBalance.amount * multiplyingFactor) / BUFFER;
        }
        return uint256(userBalance.amount) + increaseAmount;
    }

    /*//////////////////////////////////////////////////////////////
                           ONLY DAO
    //////////////////////////////////////////////////////////////*/
    function setPower(bytes32 _newPower) external onlyGov {
        _powerRoot = _newPower;
    }

    function adjustBribeCost(uint256 _newCost) external onlyGov {
        // TODO: QUESTION:  do we need some require here so that bribe cost is not off?
        // may be min bribe cost? incase if gov is compromised?
        // I don't know need to discuss
        bribeDetails.cost = _newCost;
    }

    /*//////////////////////////////////////////////////////////////
                          VIEWS
    //////////////////////////////////////////////////////////////*/
    function balance(address _user) external view returns (uint256) {
        Balance memory userBal = _balance[_user];
        return userBal.amount + _getReward(userBal);
    }

    function power(address _user) external view returns (uint256) {
        Balance memory userBal = _balance[_user];
        return _balanceOf(userBal);
    }

    function bribeCost() external view returns (uint256) {
        return bribeDetails.cost;
    }

    /*//////////////////////////////////////////////////////////////
                            PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    function _getReward(Balance memory _userBal)
        private
        view
        returns (uint256)
    {
        // TODO: as we have not discussed more about what should be the
        // reward hardcoding 10% for now
        // How to calculate user's reward amount at any point?
        return _userBal.amount / 10;
    }

    /*//////////////////////////////////////////////////////////////
                        UTILITIES
    //////////////////////////////////////////////////////////////*/
    function timeStamp64() private view returns (uint64) {
        return uint64(block.timestamp);
    }
}

// NOTE:
// 1. There are two events(Stake and Bribe) we need to consider when
// calculating amount staked in each rca-vault offline. One is when
// the user stakes, and the other is when someone bribes gvEASE.

// POETNTIAL ISSUE
// let's say all amount that has ever been staked has been bribed
// In case like this we should not allow user to withdraw right?
// I should look deep into this later and fix it

// QUESTION:
// 1. how to calculate total $gvEASE inside the contract?
// Do we need that at all? with the current contract structure it will
// be hard to calculate as it but what's the better approach that will
// help us calculate total $gvEASE? Change the way we calculate
// and store balances? Do we have a better solution for that?
