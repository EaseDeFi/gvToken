/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

import "../interfaces/IERC20.sol";
import "../interfaces/IGvTokenFinal.sol";
import "../interfaces/IBribePot.sol";
import "../interfaces/IRcaController.sol";
import "../library/MerkleProof.sol";

// solhint-disable not-rely-on-time

contract GvTokenFinal is IGvTokenFinal {
    using SafeERC20 for IERC20Permit;
    /* ========== CONSTANTS ========== */
    uint64 public constant MAX_PERCENT = 100_000;
    uint32 public constant MAX_GROW = 52 weeks;
    uint32 public constant WEEK = 1 weeks;
    uint256 internal constant MULTIPLIER = 1e18;

    /* ========== METADATA ========== */
    string public name = "Growing Vote Ease";
    string public symbol = "gvEASE";
    uint256 public decimals = 18;

    /* ========== PUBLIC VARIABLES ========== */
    IBribePot public immutable pot;
    IERC20Permit public immutable stakingToken;
    IRcaController public immutable rcaController;
    uint32 public immutable genesis;
    address public gov;
    uint256 public totalDeposited;

    uint256 public withdrawalDelay = 14 days;

    mapping(address => WithdrawRequest) public withdrawRequests;
    mapping(address => uint256) public bribedAmount;

    /* ========== PRIVATE VARIABLES ========== */
    bytes32 private _powerRoot;
    mapping(address => Deposit[]) private _deposits;
    mapping(address => uint256) private _totalDeposit;
    mapping(address => uint256) private _totalStaked;
    mapping(address => mapping(address => uint256)) private _stakes;

    constructor(
        address _pot,
        address _stakingToken,
        address _rcaController,
        address _gov,
        uint256 _genesis //this should be < vArmor holder start time
    ) {
        pot = IBribePot(_pot);
        stakingToken = IERC20Permit(_stakingToken);
        rcaController = IRcaController(_rcaController);
        gov = _gov;
        genesis = uint32((_genesis / WEEK) * WEEK);
    }

    /* ========== MODIFIERS ========== */
    modifier onlyGov() {
        require(msg.sender == gov, "only gov");
        _;
    }

    /* ========== VIEW FUNCTIONS ========== */
    function powerStaked(address user, address vault)
        external
        view
        returns (uint256)
    {
        (uint256 depositedAmount, uint256 powerEarned) = _balanceOf(
            user,
            block.timestamp,
            false
        );
        uint256 bribed = bribedAmount[user];
        return
            (_stakes[vault][user] *
                ((depositedAmount + powerEarned) - bribed)) / MAX_PERCENT;
    }

    function powerAvailableForStake(address user)
        external
        view
        returns (uint256)
    {
        (uint256 depositedAmount, uint256 powerEarned) = _balanceOf(
            user,
            block.timestamp,
            false
        );
        uint256 bribed = bribedAmount[user];
        uint256 totalStaked = (_totalStaked[user] *
            ((depositedAmount + powerEarned) - bribed)) / MAX_PERCENT;

        return ((depositedAmount + powerEarned) - (totalStaked + bribed));
    }

    function balanceOf(address user) external view returns (uint256) {
        (uint256 depositAmount, uint256 powerEarned) = _balanceOf(
            user,
            block.timestamp,
            false
        );

        return depositAmount + powerEarned;
    }

    function balanceOfAt(address user, uint256 timestamp)
        external
        view
        returns (uint256)
    {
        (uint256 depositAmount, uint256 powerEarned) = _balanceOf(
            user,
            timestamp,
            true
        );
        return depositAmount + powerEarned;
    }

    function getUserDeposits(address user)
        external
        view
        returns (Deposit[] memory)
    {
        return _deposits[user];
    }

    /* ========== ACCOUNTING ========== */

    function _balanceOf(
        address user,
        uint256 timestamp,
        bool includeWithdrawal
    ) private view returns (uint256 depositBalance, uint256 powerEarned) {
        depositBalance = _totalDeposit[user];

        WithdrawRequest memory currRequest = withdrawRequests[user];
        uint256 length = _deposits[user].length;
        uint256 i = includeWithdrawal ? length : length - currRequest.popCount;

        uint256 depositIncluded;
        for (i; i > 0; i--) {
            Deposit memory userDeposit = _deposits[user][i - 1];
            // as we increase gvPower weekly
            if (timestamp - userDeposit.start > MAX_GROW) {
                break;
            }
            // as we consider user's fund to grow on a weekly basis
            // we need to normalize time to calculate exact power earned
            // both timestamp and depositStart

            depositIncluded += userDeposit.amount;
            powerEarned += _powerEarned(userDeposit, timestamp);
        }
        // add amount of max_grow achieved to powerEarned
        if (includeWithdrawal) {
            // add withdrawal amount
            powerEarned +=
                (depositBalance + currRequest.amount) -
                depositIncluded;
        } else {
            powerEarned += (depositBalance - depositIncluded);
        }
    }

    function _powerEarned(Deposit memory userDeposit, uint256 timestamp)
        private
        pure
        returns (uint256)
    {
        uint256 currentTime = (timestamp / WEEK) * WEEK;
        // user deposit starts gaining power next week
        uint256 depositStart = ((userDeposit.start / WEEK) + 1) * WEEK;

        uint256 timeSinceDeposit;
        if (currentTime > depositStart) {
            timeSinceDeposit = currentTime - depositStart;
        }

        uint256 powerGrowth = (userDeposit.amount *
            ((timeSinceDeposit * MULTIPLIER) / MAX_GROW)) / MULTIPLIER;
        return powerGrowth;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /* ========== DEPOSIT IMPL ========== */

    function deposit(uint256 amount, PermitArgs memory args) external {
        // round depositStart to week
        address user = msg.sender;
        uint256 rewardAmount;
        if (bribedAmount[user] != 0) {
            rewardAmount = pot.getReward(user);
        }
        _deposit(user, amount, rewardAmount, block.timestamp, args, false);
    }

    // for vArmor holders
    function deposit(
        uint256 amount,
        uint256 depositStart,
        bytes32[] memory proof,
        PermitArgs memory args
    ) external {
        address user = msg.sender;
        bytes32 leaf = keccak256(abi.encodePacked(user, amount, depositStart));

        require(MerkleProof.verify(proof, _powerRoot, leaf), "invalid proof");
        require(depositStart >= genesis, "can't deposit before genesis");

        uint256 rewardAmount;
        if (bribedAmount[user] != 0) {
            rewardAmount = pot.getReward(user);
        }
        // collect power for vArmor holders
        _deposit(user, amount, rewardAmount, depositStart, args, false);
    }

    function _deposit(
        address user,
        uint256 amount,
        uint256 rewardAmount,
        uint256 depositStart,
        PermitArgs memory args,
        bool fromBribePot
    ) private {
        Deposit memory newDeposit = Deposit(
            uint128(amount + rewardAmount),
            uint32(depositStart)
        );

        // we transfer from user if we are not just compounding rewards
        if (!fromBribePot) {
            stakingToken.permit(
                user,
                address(this),
                amount,
                args.deadline,
                args.v,
                args.r,
                args.s
            );
            stakingToken.safeTransferFrom(user, address(this), amount);
        }
        // contract wide ease balance
        totalDeposited += newDeposit.amount;
        _totalDeposit[user] += newDeposit.amount;
        _deposits[user].push(newDeposit);

        emit Deposited(user, newDeposit.amount);
    }

    /* ========== WITHDRAW IMPL ========== */

    function withdrawRequest(uint256 amount, bool includeBribePot) external {
        // what should be the request amount be in I think EASE?
        // update deposits

        address user = msg.sender;
        require(amount <= _totalDeposit[user], "not enough deposit!");
        WithdrawRequest memory currRequest = withdrawRequests[user];

        uint256 popCount = _updateDepositsAndGetPopCount(
            user,
            amount,
            currRequest
        );

        uint256 timestamp = (block.timestamp / WEEK) * WEEK;

        (uint256 depositBalance, uint256 earnedPower) = _balanceOf(
            user,
            timestamp,
            false
        );
        // whether user is willing to withdraw from bribe pot
        // we will not add reward amount to withdraw if user doesn't
        // want to withdraw from bribe pot
        if (includeBribePot && bribedAmount[user] != 0) {
            uint256 conversionRate = (((depositBalance + earnedPower) *
                MULTIPLIER) / depositBalance);
            uint256 amountToWithdrawFromPot = (amount * conversionRate) /
                MULTIPLIER;
            if (bribedAmount[user] < amountToWithdrawFromPot) {
                amountToWithdrawFromPot = bribedAmount[user];
            }
            pot.withdraw(user, amountToWithdrawFromPot);
            // add rewardAmount to withdraw amount
            currRequest.rewards += uint128(pot.getReward(user));
            bribedAmount[user] -= amountToWithdrawFromPot;
        }

        _totalDeposit[user] -= amount;

        uint256 endTime = block.timestamp + withdrawalDelay;
        currRequest.endTime = uint32(endTime);
        currRequest.amount += uint128(amount);
        currRequest.popCount += uint16(popCount);
        withdrawRequests[user] = currRequest;

        emit RedeemRequest(user, amount, endTime);
    }

    function _updateDepositsAndGetPopCount(
        address user,
        uint256 withDrawAmount,
        WithdrawRequest memory currRequest
    ) private returns (uint256) {
        //
        Deposit memory remainder;
        uint256 totalAmount;
        // current deposit details
        Deposit memory userDeposit;
        // index to loop from
        uint256 startIndex = _deposits[user].length;

        startIndex = currRequest.amount > 0
            ? (startIndex - currRequest.popCount)
            : startIndex;
        uint256 i = startIndex;
        for (i; i > 0; i--) {
            userDeposit = _deposits[user][i - 1];
            totalAmount += userDeposit.amount;
            // Let's say user tries to withdraw 100 EASE and they have
            // multiple ease deposits [75, 30] EASE when our loop is
            // at index 0 total amount will be 105, that means we need
            // to store the remainder and replace that index later
            if (totalAmount >= withDrawAmount) {
                remainder.amount = uint128(totalAmount - withDrawAmount);
                remainder.start = userDeposit.start;
                break;
            }
            _deposits[user][i - 1] = userDeposit;
        }

        // If there is a remainder we need to update the index at which
        // we broke out of loop and push the withdrawan amount to user
        // _deposits withdraw 100 ease from [75, 30] EASE balance becomes
        // [5, 70, 75]
        if (remainder.amount != 0) {
            Deposit memory lastDepositWithdrawan = _deposits[user][i - 1];
            lastDepositWithdrawan.amount -= remainder.amount;
            _deposits[user][i - 1] = remainder;
            _deposits[user].push(lastDepositWithdrawan);
        }

        return startIndex - (i - 1);
    }

    function withdrawFinalize() external {
        // Finalize withdraw of a user
        address user = msg.sender;

        WithdrawRequest memory userReq = withdrawRequests[user];
        delete withdrawRequests[user];
        require(
            userReq.endTime <= block.timestamp,
            "withdrawal not yet allowed"
        );

        // pop off the number of deposits that has been withdrawn
        for (uint256 i = 0; i < userReq.popCount; i++) {
            _deposits[user].pop();
        }

        uint256 amount = userReq.amount + userReq.rewards;
        stakingToken.safeTransfer(user, amount);

        // TODO: should I care about rewards here?
        emit RedeemFinalize(user, userReq.amount);
    }

    /* ========== STAKE IMPL ========== */

    function stake(uint256 balancePercent, address vault) external {
        require(rcaController.activeShields(vault), "vault not active");
        address user = msg.sender;
        // deposit reward
        PermitArgs memory args;
        // TODO: should we limit this deposit call monthly?
        uint256 rewardAmount;
        if (bribedAmount[user] != 0) {
            rewardAmount = pot.getReward(user);
        }
        if (rewardAmount != 0) {
            _deposit(user, 0, rewardAmount, block.timestamp, args, true);
        }

        uint256 totalStake = _totalStaked[user];
        totalStake += balancePercent;

        require(totalStake < MAX_PERCENT, "can't stake more than 100%");

        _totalStaked[user] = totalStake;
        _stakes[vault][user] += balancePercent;

        emit Stake(user, vault, balancePercent);
    }

    function unStake(uint256 balancePercent, address vault) external {
        address user = msg.sender;
        // deposit reward
        PermitArgs memory args;
        // TODO: should we limit this deposit call monthly?
        uint256 rewardAmount;
        // collect rewards and add to user _deposits to gain more
        // gvToken
        if (bribedAmount[user] != 0) {
            rewardAmount = pot.getReward(user);
        }
        if (rewardAmount != 0) {
            _deposit(user, 0, rewardAmount, block.timestamp, args, true);
        }

        _stakes[vault][user] -= balancePercent;
        _totalStaked[user] -= balancePercent;

        emit UnStake(user, vault, balancePercent);
    }

    /* ========== BRIBING IMPL ========== */
    function depositToPot(uint256 amount) external {
        // deposits user gvEase to bribe pot and
        // get rewards against it
        address user = msg.sender;
        (uint256 amountDeposited, uint256 powerEarned) = _balanceOf(
            user,
            block.timestamp,
            false
        );
        uint256 totalPower = amountDeposited + powerEarned;
        uint256 bribed = bribedAmount[user];

        require(totalPower >= (amount + bribed), "not enough power");

        bribedAmount[user] += amount;

        pot.deposit(user, amount);
    }

    function withdrawFromPot(uint256 amount) external {
        // withdraws user gvToken from bribe pot
        address user = msg.sender;
        PermitArgs memory args;
        uint256 rewardAmount;
        // claim reward from the bribe pot
        if (bribedAmount[user] != 0) {
            rewardAmount = pot.getReward(user);
        }
        // deposit reward to increase user's gvEASE
        if (rewardAmount != 0) {
            _deposit(user, 0, rewardAmount, block.timestamp, args, true);
        }

        _withdrawFromPot(msg.sender, amount);
    }

    function _withdrawFromPot(address user, uint256 amount) private {
        bribedAmount[user] -= amount;
        pot.withdraw(user, amount);
    }

    function claimAndDepositReward() external {
        address user = msg.sender;
        uint256 rewardAmount;
        PermitArgs memory args;
        if (bribedAmount[user] > 0) {
            rewardAmount = pot.getReward(user);
        }
        if (rewardAmount > 0) {
            _deposit(user, 0, rewardAmount, block.timestamp, args, true);
        }
    }

    /* ========== ONLY GOV ========== */
    function setPower(bytes32 root) external onlyGov {
        _powerRoot = root;
    }

    function setDelay(uint256 time) external onlyGov {
        time = (time / 1 weeks) * 1 weeks;
        // TODO: what should be minimum delay that even gov can't go under
        require(time > 2 weeks, "min delay 14 days");
        withdrawalDelay = time;
    }
}
