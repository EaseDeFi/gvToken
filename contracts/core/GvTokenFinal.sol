/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
        uint256 timestamp = (block.timestamp / WEEK) * WEEK;

        (uint256 depositAmount, uint256 powerEarned) = _balanceOf(
            user,
            timestamp,
            false
        );
        return depositAmount + powerEarned;
    }

    function balanceOfAt(address user, uint256 timestamp)
        external
        view
        returns (uint256)
    {
        // TODO: how to handle if timestamp is more than withdrawal delay?
        // as we remove the deposits from array on withdraw and it's very
        // expensive to take user snapshot on every user interaction
        // it's almost impossible to handle this situation
        timestamp = (timestamp / WEEK) * WEEK;
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
        bool includeWithdrawn
    ) private view returns (uint256 powerEarned, uint256 depositBalance) {
        Deposit[] memory userDeposits = _deposits[user];

        for (uint256 i = 0; i < userDeposits.length; i++) {
            Deposit memory userDeposit = _deposits[user][i];
            if (!includeWithdrawn && userDeposit.withdrawn) {
                break;
            }
            depositBalance += userDeposit.amount;
            powerEarned += _powerEarned(userDeposit, timestamp);
        }
    }

    function _powerEarned(Deposit memory userDeposit, uint256 timestamp)
        private
        pure
        returns (uint256)
    {
        //
        uint256 time = (timestamp / WEEK) * WEEK;

        // growth starts next week from deposit
        if (userDeposit.start > time) {
            return 0;
        }

        uint256 timeSinceDeposit = time - userDeposit.start;
        // max grow has been achieved
        if (timeSinceDeposit >= MAX_GROW) {
            return userDeposit.amount;
        }

        uint256 powerGrowth = (userDeposit.start *
            ((timeSinceDeposit * MULTIPLIER) / MAX_GROW)) / MULTIPLIER;
        return powerGrowth;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /* ========== DEPOSIT IMPL ========== */

    function deposit(uint256 amount, PermitArgs memory args) external {
        // round depositStart to week
        uint256 depositStart = ((block.timestamp / WEEK) + 1) * WEEK;
        _deposit(msg.sender, amount, depositStart, args, false);
    }

    // for vArmor holders
    function deposit(
        uint256 amount,
        uint256 depositStart,
        bytes32[] memory proof,
        PermitArgs memory args
    ) external {
        bytes32 leaf = keccak256(
            abi.encodePacked(msg.sender, amount, depositStart)
        );

        require(MerkleProof.verify(proof, _powerRoot, leaf), "invalid proof");
        require(depositStart >= genesis, "can't deposit before genesis");

        // round depositStart to week
        depositStart = ((depositStart / WEEK) + 1) * WEEK;

        // collect power for vArmor holders
        _deposit(msg.sender, amount, depositStart, args, false);
    }

    function _deposit(
        address user,
        uint256 amount,
        uint256 depositStart,
        PermitArgs memory args,
        bool fromBribePot
    ) private {
        uint256 rewardAmount;
        if (bribedAmount[user] != 0) {
            rewardAmount = pot.getReward(user);
        }
        Deposit memory newDeposit = Deposit(
            uint128(amount + rewardAmount),
            uint32(depositStart),
            false
        );

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

        totalDeposited += newDeposit.amount;
        _deposits[user].push(newDeposit);

        emit Deposited(user, newDeposit.amount);
    }

    /* ========== WITHDRAW IMPL ========== */

    function withdrawRequest(uint256 amount, bool fromBribePot) external {
        // what should be the request amount be in I think EASE?
        // update deposits

        address user = msg.sender;
        Deposit memory remainder;
        uint256 totalAmount;
        Deposit memory userDeposit;
        uint256 i = _deposits[user].length;
        for (i; i > 0; i--) {
            userDeposit = _deposits[user][i - 1];
            if (!userDeposit.withdrawn) {
                totalAmount += userDeposit.amount;
                if (totalAmount > amount) {
                    remainder.amount = uint128(totalAmount - amount);
                    remainder.start = userDeposit.start;
                    break;
                }
                userDeposit.withdrawn = true;
                _deposits[user][i - 1] = userDeposit;
            }
        }

        require(totalAmount >= amount, "not enough balance!");

        if (remainder.amount != 0) {
            Deposit memory lastDepositWithdrawan = _deposits[user][i];
            lastDepositWithdrawan.amount -= remainder.amount;
            lastDepositWithdrawan.withdrawn = true;

            _deposits[user][i] = remainder;
            _deposits[user].push(lastDepositWithdrawan);
        }

        uint256 timestamp = (block.timestamp / WEEK) * WEEK;

        (uint256 depositBalance, uint256 earnedPower) = _balanceOf(
            user,
            timestamp,
            false
        );
        // 1 Ease = ? gvEASE
        uint256 conversionRate = (((depositBalance + earnedPower) *
            MULTIPLIER) / depositBalance);
        uint256 rewardAmount;
        if (fromBribePot) {
            uint256 amountToWithdrawFromPot = (amount * conversionRate) /
                MULTIPLIER;
            require(
                bribedAmount[user] >= amountToWithdrawFromPot,
                "bribed amount < withdraw amount"
            );

            pot.withdraw(user, amountToWithdrawFromPot);
            rewardAmount = pot.getReward(user);
        }

        WithdrawRequest memory currRequest = withdrawRequests[user];
        // TODO: should this start from next week?
        uint256 endTime = block.timestamp + withdrawalDelay;
        currRequest.endTime = uint32(endTime);
        currRequest.amount += uint112(amount);
        currRequest.rewards += uint112(rewardAmount);

        withdrawRequests[user] = currRequest;

        emit RedeemRequest(user, amount, endTime);
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

        uint256 i = _deposits[user].length;
        for (i; i > 0; i--) {
            Deposit memory userDeposit = _deposits[user][i - 1];
            if (!userDeposit.withdrawn) {
                break;
            }
            _deposits[user].pop();
        }

        stakingToken.safeTransfer(user, userReq.amount + userReq.rewards);

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
        if (bribedAmount[user] > 0) {
            _deposit(user, 0, block.timestamp, args, true);
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
        if (bribedAmount[user] > 0) {
            _deposit(user, 0, block.timestamp, args, true);
        }

        _stakes[vault][user] -= balancePercent;
        _totalStaked[user] -= balancePercent;

        emit UnStake(user, vault, balancePercent);
    }

    /* ========== BRIBING IMPL ========== */
    function depositToPot(uint256 amount) external {
        // check for amount staked and gvPower
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

    // Probably this function will be internal?
    function withdrawFromPot(uint256 amount, address user) external {
        // unlock gvAmount
        // TODO: what are other things I am not caring about here?
        // I'll come back tomorrow
        bribedAmount[msg.sender] -= amount;
        pot.withdraw(user, amount);
    }
}
