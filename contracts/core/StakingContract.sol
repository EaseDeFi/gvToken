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
// Maker's Solution: https://github.com/makerdao/ds-chief/pull/1/files

abstract contract StakingContract is IStakingContract {
    using SafeERC20 for IEaseToken;

    /*//////////////////////////////////////////////////////////////
                            CONSTANTS
    //////////////////////////////////////////////////////////////*/
    uint256 private constant BUFFER = 10**18;
    uint32 private constant MAX_GROW = 52 weeks;
    uint32 private constant WITHDRAWAL_DELAY = 4 weeks;
    /// @notice max percentage
    uint128 private constant DENOMINATOR = 10000;
    uint32 private constant SLASH_PERCENT = 2000;

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
    // TODO: figure out a way to generalize _totalStaked and _userStake
    // as i am storing %Staked twice as I need to know total % staked of
    // a user which is impossible to do with _userStakes
    // user => total % staked
    mapping(address => uint256) private _totalStaked;
    // user => rca-vault => %Staked
    mapping(address => mapping(address => uint256)) private _userStakes;

    // user => WithdrawRequest
    mapping(address => WithdrawRequest) public withdrawRequests;
    uint256 public pendingWithdrawal;

    // cost in $EASE per 1000 gvEASE
    // QUESTION: tbh shouldn't bribe cost be dynamic?
    // I know it's gonna make things complicated just trying to
    // think out loud. If you are gonna ask me how I don't know
    // solution yet lol.
    BribeDetails private bribeDetails;

    RewardPool private rewardPool;

    bytes32 private _powerRoot;

    address private _gov;

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    constructor(address easeToken, address gov) {
        token = IEaseToken(easeToken);
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

    function deposit(uint256 amount) external {
        _deposit(uint128(amount), uint64(block.timestamp), msg.sender);
        emit Deposit(msg.sender, amount);
    }

    // for vArmor holders
    function deposit(
        uint256 amount,
        uint256 timeStart,
        bytes32[] memory proof
    ) external {
        // TODO: DISCUSS: Scenario.
        // How we create merkle root so that verification works as expected?
        // It is important to use _amount in leaf because user can stake small
        // amount of $Armor and try to deposit more $EASE tokens when calling this
        // function and get extra staking timeStart benefit.
        // Need to figure this out.
        bytes32 leaf = keccak256(
            abi.encodePacked(msg.sender, amount, timeStart)
        );
        // require this
        require(MerkleProof.verify(proof, _powerRoot, leaf), "invalid proof");
        _deposit(uint128(amount), uint64(timeStart), msg.sender);
    }

    function _deposit(
        uint128 amount,
        uint64 timeStart,
        address user
    ) private {
        Balance memory userBal = _balance[user];
        if (userBal.amount == 0) {
            userBal.depositStart = timeStart;
        } else {
            // normalize time
            // (currentBal * startTime + newBal * block.timestamp) / (currentBal + newBal)
            userBal.depositStart = uint64(
                uint256(userBal.amount) *
                    uint256(userBal.depositStart) +
                    (amount * timeStart) /
                    (uint256(userBal.amount) + amount)
            );
        }
        if (
            userBal.freezeStart != 0 &&
            ((timeStamp64() - userBal.depositStart) < MAX_GROW)
        ) {
            // If we are inside this conditional that means the user is trying
            // to deposit amount that will normalize time and bring it to growing
            // phase that means, we need to set freezeStart to zero

            // TODO: should think about a hacky way to not set this thing to zero
            // to save gas? because if I set to 0 and reset it to freezeStart later
            // I will have to pay gas to write to a totally new storage
            userBal.freezeStart = 0;
            // TODO: emit freeze here? There may be a need to know this for the
            // off chain world. Resolve this later
        }
        // update balance
        userBal.amount += amount;

        // Question: how to know what's up for sale tbh? As user's staked amount
        // is stored in % it's hard to calculate total staked % I think
        // I may need a staked variable where I can store % staked of the user? *SOLVED*

        // update address(0) balance that we use to store amount for bribing
        Balance memory forSaleBal = _balance[address(0)];
        // amount to increase for sale
        uint256 saleAmount;
        uint256 stakePercent = _totalStaked[msg.sender];
        if (stakePercent == 0) {
            saleAmount = amount;
        } else {
            // substracting the staked %
            saleAmount = (amount * (DENOMINATOR - stakePercent)) / DENOMINATOR;
        }
        if (forSaleBal.amount == 0) {
            forSaleBal.depositStart = timeStart;
        } else {
            forSaleBal.depositStart = uint64(
                uint256(forSaleBal.amount) *
                    uint256(forSaleBal.depositStart) +
                    (saleAmount * timeStart) /
                    (uint256(forSaleBal.amount) + saleAmount)
            );
        }

        forSaleBal.amount += uint128(saleAmount);

        // update for sale balance
        _balance[address(0)] = forSaleBal;
        // update user balance
        _balance[user] = userBal;

        token.transferFrom(user, address(this), amount);
    }

    function withdraw(uint128 amount) external {
        // Withdraw if not frozen
        // TODO: should I care about updating userStakes? only necessary
        // if we are doing something with our Staked event off chain.
        // else it doesn't matter. But the concern is let's say user
        // has staked in multiple rcas they withdraw their whole staking
        // balance and we don't update the staked amount %s. As a protocol
        // there's no problem for us, but the problem can be if user deposits
        // again in the future and the staked amounts to rca-vaults are pre
        // assigned
        address user = msg.sender;
        Balance memory userBal = _balance[user];
        Balance memory forSaleBal = _balance[address(0)];
        bool frozen = userBal.freezeStart != 0;
        uint128 slashAmount;
        if (frozen) {
            // User willing to get slashed on withdrawal
            // slash 20%
            slashAmount = uint128((amount * SLASH_PERCENT) / DENOMINATOR);

            // TODO: if we want to make slash dynamic the more power you have
            // the more you get slashed
            // slashAmount += slashAmount * (user power/withdraw amount)

            rewardPool.frozen += slashAmount;
        }

        uint256 userStake = _totalStaked[user];
        // amount to deduct from sale
        uint256 deductForSale = (amount * (DENOMINATOR - userStake)) /
            DENOMINATOR;

        uint256 rewardAmount = _getReward(userBal);

        // normalize time
        forSaleBal.depositStart = uint64(
            (uint256(forSaleBal.amount) *
                uint256(forSaleBal.depositStart) -
                deductForSale *
                uint256(userBal.depositStart)) /
                (uint256(forSaleBal.amount) - deductForSale)
        );
        if ((userBal.amount - amount) != 0) {
            //TODO: Normalize time? I think so but only if the time window is within
            // the growth and decay time
        }
        // update balance
        userBal.amount -= uint128(amount);
        forSaleBal.amount -= uint128(deductForSale);

        amount += uint128(rewardAmount);
        // UPDATE STORAGE
        _balance[user] = userBal;
        _balance[address(0)] = forSaleBal;

        // transfer to the user
        token.safeTransfer(user, amount - slashAmount);

        emit Withdraw(user, amount);
    }

    function withdrawRequest(uint256 amount) external {
        // deduct users balance
        Balance memory userBal = _balance[msg.sender];
        WithdrawRequest memory currReq = withdrawRequests[msg.sender];

        // TODO: should i care about normalizing time here to make it fair to
        // the user?
        uint64 endTime = timeStamp64() + WITHDRAWAL_DELAY;
        // (uint(amount) * endTime) + (currReq.amount * currReq.endTime) /
        currReq.endTime = uint64(
            ((amount * endTime) + (uint256(currReq.amount * currReq.endTime))) /
                (amount + currReq.amount)
        );
        uint128 rewardAmount = _getReward(userBal);
        currReq.amount += (uint128(amount) + rewardAmount);
        // calculate user's reward?
        // update user's withdraw
        withdrawRequests[msg.sender] = currReq;
    }

    function withdrawFinalize() external {
        // Finalize withdraw of a user
    }

    function stake(uint256 balancePercent, address vault) external {
        // Question: Why do we need to stake balance in %?
        // probably best thing to store here would be user's staked %
        // and total staked of a vault? what I think is we don't care which vault
        // the user has staked in. All we care is the amount he has already staked
        //
        // QUESTION: What happens if user deposits again after staking?
        // ANS: will it result in increase in %staked to a specific rca-vault?
        address user = msg.sender;
        // TODO: increase % staked amount of vault
        uint256 userStake = _totalStaked[user];
        userStake += balancePercent;
        require(userStake < DENOMINATOR, "can't stake more than 100%");
        // update user staked %
        _totalStaked[user] = userStake;

        _userStakes[msg.sender][vault] += balancePercent;
        // update amount for bribe
        uint256 amount = (uint256(_balance[user].amount) * balancePercent) /
            DENOMINATOR;
        Balance memory forSaleBal = _balance[address(0)];
        forSaleBal.amount -= uint128(amount);

        // TODO: decrease amountForBribe balance (address(0)) balance
        // thoughts on achieving above. Renormalize the startTime of address(0)

        _balance[address(0)] = forSaleBal;

        emit Stake(user, vault, balancePercent);
    }

    // TODO: QUESTION: Do we need this function?
    function unStake(uint256 balancePercent, address vault) external {
        // Unstake from a rca-vault
        address user = msg.sender;
        _userStakes[user][vault] -= balancePercent;
        _totalStaked[user] -= balancePercent;

        // keep power up for sale
        Balance memory userBal = _balance[user];
        Balance memory forSaleBal = _balance[address(0)];
        uint256 amount = (uint256(_balance[user].amount) * balancePercent) /
            DENOMINATOR;
        // should I care about normalizing time? probably yes
        forSaleBal.depositStart = uint64(
            ((uint256(forSaleBal.amount) * uint256(forSaleBal.depositStart)) +
                ((amount) * uint256(userBal.depositStart))) /
                (uint256(forSaleBal.amount) + amount)
        );
        forSaleBal.amount += uint128(amount);

        _balance[address(0)] = forSaleBal;
    }

    function freeze() external {
        Balance memory userBal = _balance[msg.sender];
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
        // Sould freeze start be set to 0 if the user does that? I think I should add
        // that logic to deposit()

        //TODO: figure out what other checks we need so that users cannot exploit this
        require(
            (uint64(block.timestamp) - userBal.depositStart) >= MAX_GROW,
            "stake threshold not met"
        );
        userBal.freezeStart = timeStamp64();

        _balance[msg.sender] = userBal;
    }

    /*//////////////////////////////////////////////////////////////
                            BRIBE LOGIC
    //////////////////////////////////////////////////////////////*/
    function bribe(uint256 payAmount, address vault) external {
        // QUESTION: I think we should pass in amount of power they want to bribe,
        //  time period in months and vaultaddress that way we can make things simpler

        // TODO: should this function call update the expired bribes?

        //TODO: a function _updateBribe();that will update total bribed variable?
        // depending on their time for example let's say user has bribed gvEASE
        // for 2 months and it has expired that means the amount of gvEASE bribed
        // then should be up for sale again.

        // calculate gvPower being bribed against payAmount
        // is it true that power can be bribed for a fixed period of time?
        uint256 gvPower = (payAmount * 1000 * 10**decimals) / bribeDetails.cost;
        uint256 noOfWeeks = payAmount / bribeDetails.cost; // expiry in weeks
        // gvPower being bribed should not be more than the amount of power that is for sale
        uint256 powerForSale = _power(_balance[address(0)]) -
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

        emit Bribe(vault, gvPower, noOfWeeks * 1 weeks);
    }

    /*///////////////////////////////////////////////////////////////
                        ACCOUNTING LOGIC
    //////////////////////////////////////////////////////////////*/
    /// @dev calcuates gvEASE balance of a user
    function _power(Balance memory userBal) private view returns (uint256) {
        return uint256(userBal.amount) + _getExtraPower(userBal);
    }

    /// @dev Calculates extra power boost of a user frozen growth,
    /// and staking growth
    function _getExtraPower(Balance memory userBal)
        private
        view
        returns (uint128)
    {
        bool frozen = userBal.freezeStart > userBal.depositStart;
        uint64 timeStamp = timeStamp64();
        if (frozen) {
            // frozenTime
            uint256 fTime = timeStamp - userBal.freezeStart;
            // decay time
            uint64 dTime = userBal.freezeStart -
                userBal.depositStart -
                MAX_GROW;
            // if frozenTime >= decayTime max power has achieved
            if (fTime >= dTime || fTime >= MAX_GROW) {
                return userBal.amount;
            } else {
                // this means we are in a growth phase
                // calculate extraPower at freeze time

                // grow time
                uint256 gTime = MAX_GROW - dTime;
                // extra power growth at freeze time
                uint256 gPower = (uint256(userBal.amount) * (gTime)) / MAX_GROW;
                // calculate extraPower gained after freezing
                uint256 fPower = (uint256(userBal.amount) *
                    timeStamp -
                    userBal.freezeStart) / MAX_GROW;
                return uint128(fPower + gPower);
            }
        } else {
            uint256 multiplyingFactor = ((timeStamp64() -
                userBal.depositStart) * BUFFER) / MAX_GROW;

            // if power slope is in a decaying phase
            if (multiplyingFactor > MAX_GROW * BUFFER) {
                if (multiplyingFactor < 2 * MAX_GROW * BUFFER) {
                    return
                        uint128(
                            (uint256(userBal.amount) *
                                (MAX_GROW * BUFFER * 2 - multiplyingFactor)) /
                                BUFFER
                        );
                }
            } else {
                // if power slope is in a growing phase
                return
                    uint128(
                        (uint256(userBal.amount) * multiplyingFactor) / BUFFER
                    );
            }
        }
        return 0;
    }

    /*//////////////////////////////////////////////////////////////
                           ONLY DAO
    //////////////////////////////////////////////////////////////*/
    function setPower(bytes32 newPower) external onlyGov {
        _powerRoot = newPower;
    }

    function adjustBribeCost(uint256 newCost) external onlyGov {
        // TODO: QUESTION:  do we need some require here so that bribe cost is not off?
        // may be min bribe cost? incase if gov is compromised?
        // I don't know need to discuss
        bribeDetails.cost = newCost;
    }

    /*//////////////////////////////////////////////////////////////
                          VIEWS
    //////////////////////////////////////////////////////////////*/
    function balance(address user) external view returns (uint256) {
        Balance memory userBal = _balance[user];
        return userBal.amount + _getReward(userBal);
    }

    function power(address user) external view returns (uint256) {
        Balance memory userBal = _balance[user];
        return _power(userBal);
    }

    function bribeCost() external view returns (uint256) {
        return bribeDetails.cost;
    }

    /*//////////////////////////////////////////////////////////////
                            PRIVATE FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    function _getReward(Balance memory userBal) private view returns (uint128) {
        // TODO: as we have not discussed more about what should be the
        // reward hardcoding 10% for now
        // How to calculate user's reward amount at any point?

        // TODO: calculate frozen reward (slashed from emergency withdrawals)

        // TODO: calculate staking reward
        return userBal.amount / 10;
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

// POETNTIAL ISSUES
/*  1. let's say all amount that has ever been staked has been bribed
    In case like this we should not allow user to withdraw right?
    I should look deep into this later and fix it
*/

/*
   2: should I care about updating userStakes? only necessary
   if we are doing something with our Staked event off chain.
   else it doesn't matter. But the concern is let's say user
   has staked in multiple rcas they withdraw their whole staking
   balance and we don't update the staked amount %s. As a protocol
   there's no problem for us, but the problem can be if user deposits
   again in the future and the staked amounts to rca-vaults are pre
   assigned
*/
// QUESTION:
// 1. how to calculate total $gvEASE inside the contract?
// Do we need that at all? with the current contract structure it will
// be hard to calculate as it but what's the better approach that will
// help us calculate total $gvEASE? Change the way we calculate
// and store balances? Do we have a better solution for that?
