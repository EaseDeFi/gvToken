/// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.11;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../library/MerkleProof.sol";

import "../interfaces/IStakingContractV1.sol";
import "../interfaces/IEaseToken.sol";

// solhint-disable not-rely-on-time

/**
 * @title EASE Staking Contract
 * @notice Contract for ease tokenomics.
 * @author Ease
 **/
abstract contract StakingContractV1 is IStakingContractV1 {
    using SafeERC20 for IEaseToken;
    /*//////////////////////////////////////////////////////////////
                            CONSTANTS
    //////////////////////////////////////////////////////////////*/
    uint256 internal constant BUFFER = 10**18;
    uint256 internal constant MAX_GROW = 52; // in weeks
    uint256 internal constant DELAY = 4 weeks;
    uint256 internal constant WEEK = 1 weeks;

    /// @notice max percentage
    uint256 internal constant DENOMINATOR = 10000;

    /*//////////////////////////////////////////////////////////////
                            IMMUTABLE STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice ease token
    IEaseToken public immutable token;
    uint32 internal immutable genesis = uint32(block.timestamp);

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
    mapping(address => Balance) internal _balance;
    // week => amount of ease expiring
    mapping(uint256 => BribeExpiry) internal bribeToExpire;
    // rca-vault => user => BribeDetails
    mapping(address => mapping(address => BribeDetail)) internal bribes;
    // rewards
    uint256 internal rewardPot;

    // EASE per week for entire venal pot(gvEASE for bribe)
    uint256 internal bribeRate;

    // bribe to expire next (store week from genesis)
    uint256 internal nextExpiry;

    // user => total % staked
    mapping(address => uint256) private _totalStaked;
    // rca-vault => userAddress => %Staked
    mapping(address => mapping(address => uint256)) private _userStakes;

    // user => WithdrawRequest
    mapping(address => WithdrawRequest) public withdrawRequests;
    uint256 public pendingWithdrawal;

    // ONLY GOV

    // governance
    address internal _gov;
    // Armor stakers root
    bytes32 private _powerRoot;
    // TODO: revisit and update this slashing %s so that you can
    // have a proper justification on why you are using that
    // amount. I think governance should be able to decide on
    // how much should be slashed probably have functions so that this
    // can be updated by dao
    uint256 internal minSlash = 2000;
    uint256 internal maxSlash = 4000;

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
                        DEPOSIT IMPL
    //////////////////////////////////////////////////////////////*/

    function deposit(uint256 amount) external {
        _deposit(amount, block.timestamp, msg.sender);
        emit Deposit(msg.sender, amount);
    }

    // for vArmor holders
    function deposit(
        uint256 amount,
        uint256 timeStart,
        bytes32[] memory proof
    ) external {
        bytes32 leaf = keccak256(
            abi.encodePacked(msg.sender, amount, timeStart)
        );

        require(MerkleProof.verify(proof, _powerRoot, leaf), "invalid proof");
        _deposit(amount, timeStart, msg.sender);
        emit Deposit(msg.sender, amount);
    }

    function _deposit(
        uint256 amount,
        uint256 currTime,
        address user
    ) private {
        Balance memory userBal = _balance[user];

        uint256 currWeek = getCurrWeek(currTime);
        userBal.startWeek = uint16(
            (amount * currWeek + userBal.amount * userBal.startWeek) /
                (amount + userBal.amount)
        );

        userBal.amount = uint112(amount);

        Balance memory venalPotBal = _balance[address(0)];

        venalPotBal.amount += uint112(amount);
        venalPotBal.startWeek = uint16(
            (amount * currWeek + venalPotBal.amount * venalPotBal.startWeek) /
                (amount + venalPotBal.amount)
        );

        token.transferFrom(user, address(this), amount);
        // Update user balance
        _balance[user] = userBal;
        // update bribable pot
        _balance[address(0)] = venalPotBal;
    }

    /*//////////////////////////////////////////////////////////////
                        WITHDRAW IMPL
    //////////////////////////////////////////////////////////////*/
    function withdraw(uint256 amount) external {
        // Add rewards wrt amount being withdrawn
        address user = msg.sender;
        Balance memory userBal = _balance[user];
        Balance memory venalPotBal = _balance[address(0)];
        uint256 currWeek = getCurrWeek(block.timestamp);
        bool frozen = currWeek - userBal.startWeek > MAX_GROW;
        uint256 slashAmount;
        if (frozen) {
            // TODO: Implement dynamic slashing
            // The shorter and longer the stay the user will get slashed more
            // Is there a way to generalize slashing? What should be maximum slash
            // % 30? 40? 50? If you are going to consider any number how are you
            // going to justify it. Same with minumum Slash %
            slashAmount = ((amount * minSlash) / DENOMINATOR);
            rewardPot += uint112(slashAmount);
        }
        uint256 userStake = _totalStaked[user];
        // amount to deduct from venal pot
        uint256 deductForVPot = (amount * (DENOMINATOR - userStake)) /
            DENOMINATOR;

        // TODO: pass userBal.amount = amount being withdrawed so that only
        // reward of amount being withdrawan is paid.
        uint256 rewardAmount = _getReward(userBal);

        // Normalize venal pot start time
        venalPotBal.startWeek = uint16(
            ((venalPotBal.amount * venalPotBal.startWeek) -
                (amount * userBal.startWeek)) / (venalPotBal.amount - amount)
        );

        venalPotBal.amount -= uint112(deductForVPot);
        userBal.amount -= uint112(amount);

        amount += rewardAmount;
        // UPDATE STORAGE
        _balance[user] = userBal;
        _balance[address(0)] = venalPotBal;

        // transfer to the user
        token.safeTransfer(user, amount - slashAmount);

        // TODO: should amount on event be the amount transferred?
        // or amount user is trying to withdraw
        emit Withdraw(user, amount);
    }

    function withdrawRequest(uint256 amount) external {
        // TODO: disscuss should we allow user to reap rewards until
        // they finalize this request? I think no because as they are
        // telling us they want to leave we should give them what we owe
        // when they are telling that they want to leave
        address user = msg.sender;
        Balance memory userBal = _balance[user];
        require(userBal.amount >= amount, "not enough balance");

        WithdrawRequest memory currReq = withdrawRequests[user];

        // TODO: should i care about normalizing time here to make it fair to
        // the user?
        uint256 endTime = block.timestamp + DELAY;
        // (uint(amount) * endTime) + (currReq.amount * currReq.endTime) /
        currReq.endTime = uint64(
            ((amount * endTime) + (uint256(currReq.amount * currReq.endTime))) /
                (amount + currReq.amount)
        );
        uint128 rewardAmount = _getReward(userBal);
        currReq.amount += (uint128(amount) + rewardAmount);
        // calculate user's reward?
        // update user's withdraw
        withdrawRequests[user] = currReq;
        pendingWithdrawal += (amount + rewardAmount);

        // TODO: update user balance? off course yes
        userBal.amount -= uint128(amount);

        _balance[user] = userBal;
        emit RedeemRequest(user, amount, endTime);
    }

    function withdrawFinalize() external {
        // Finalize withdraw of a user
        address user = msg.sender;

        WithdrawRequest memory userReq = withdrawRequests[user];
        delete withdrawRequests[user];
        require(
            userReq.endTime < block.timestamp,
            "withdrawal not yet allowed"
        );
        // TODO: come back here and see if there is a need to
        // update other variables
        pendingWithdrawal -= userReq.amount;

        token.safeTransfer(user, userReq.amount);

        emit RedeemFinalize(user, userReq.amount);
    }

    /*//////////////////////////////////////////////////////////////
                        STAKING IMPL
    //////////////////////////////////////////////////////////////*/
    function stake(uint256 balancePercent, address vault) external {
        // NOTE: things that should happen in this function call

        // 1. reward user for the amount being staked. Aka update user's balance
        //  with owed amount of $EASE for the % balance

        // 2.update the venal pot

        address user = msg.sender;
        // TODO: increase % staked amount of vault
        uint256 userStake = _totalStaked[user];
        userStake += balancePercent;
        require(userStake < DENOMINATOR, "can't stake more than 100%");
        // update user staked %
        _totalStaked[user] = userStake;

        _userStakes[vault][msg.sender] += balancePercent;
        // update amount for bribe
        uint256 amount = (uint256(_balance[user].amount) * balancePercent) /
            DENOMINATOR;
        Balance memory venalPotBal = _balance[address(0)];
        Balance memory userBal = _balance[msg.sender];

        venalPotBal.amount -= uint128(amount);

        // normalize startweek for bribebal
        venalPotBal.startWeek = uint16(
            ((venalPotBal.amount * venalPotBal.startWeek) -
                (amount * userBal.startWeek)) / (venalPotBal.amount - amount)
        );

        _balance[address(0)] = venalPotBal;

        emit Stake(user, vault, balancePercent);
    }

    function unStake(uint256 balancePercent, address vault) external {
        // Unstake from a rca-vault

        // Should update the ease balance of user by the amount of reward owed
        // for unstaked balance of user

        // Should update venal pot balance

        address user = msg.sender;
        _userStakes[vault][user] -= balancePercent;
        _totalStaked[user] -= balancePercent;

        // keep power up for sale
        Balance memory userBal = _balance[user];
        Balance memory venalPotBal = _balance[address(0)];
        uint256 amount = (uint256(_balance[user].amount) * balancePercent) /
            DENOMINATOR;
        // should I care about normalizing time? probably yes
        venalPotBal.startWeek = uint16(
            (amount *
                userBal.startWeek +
                venalPotBal.amount *
                venalPotBal.startWeek) / (amount + venalPotBal.amount)
        );
        venalPotBal.amount += uint128(amount);

        _balance[address(0)] = venalPotBal;
        emit UnStake(user, vault, balancePercent);
    }

    /*//////////////////////////////////////////////////////////////
                        BRIBING IMPL
    //////////////////////////////////////////////////////////////*/

    function bribe(
        uint256 bribePerWeek,
        address vault,
        uint256 expiry // timestamp
    ) external {
        uint256 numOfWeeks = (expiry - block.timestamp) / WEEK;
        uint256 startWeek = (timeStamp32() - genesis / WEEK) + 1;
        uint256 endWeek = startWeek + numOfWeeks;

        if (endWeek < nextExpiry || nextExpiry == 0) {
            // update upcoming expiry
            nextExpiry = endWeek;
        }

        // TODO: check if bribe already exists

        bribes[vault][msg.sender] = BribeDetail(
            uint16(startWeek),
            uint16(endWeek),
            uint112(bribePerWeek)
        );

        // transfer amount to bribe pot
        uint256 amount = bribePerWeek * numOfWeeks;
        token.transferFrom(msg.sender, address(this), amount);

        // weekly bribe
        bribeRate += bribePerWeek;

        BribeExpiry memory bribeExpiry = bribeToExpire[endWeek];

        bribeExpiry.totalBribe += uint112(bribePerWeek * numOfWeeks);
        bribeExpiry.bribeRate += uint112(bribePerWeek);

        bribeToExpire[endWeek] = bribeExpiry;

        // TODO: emit bribe event
    }

    function cancelBribe(address vault) external {
        // if bribe seems expensive user can stop streaming
        BribeDetail memory userBribe = bribes[vault][msg.sender];
        uint256 currWeek = getCurrWeek(timeStamp32());

        // refund what ever is owed to the user
        uint256 amountToRefund = (userBribe.endWeek - currWeek) *
            userBribe.ratePerWeek;

        // update our bribe pot?
        rewardPot +=
            (userBribe.ratePerWeek *
                (userBribe.endWeek - userBribe.startWeek)) -
            uint112(amountToRefund);

        // update bribe to expire
        BribeExpiry memory bribeExpiry = bribeToExpire[userBribe.endWeek];
        bribeExpiry.bribeRate -= userBribe.ratePerWeek;
        bribeExpiry.totalBribe -= (userBribe.ratePerWeek *
            (userBribe.endWeek - userBribe.startWeek));

        // update bribe rate
        bribeRate -= userBribe.ratePerWeek;

        token.safeTransfer(msg.sender, amountToRefund);
        // TODO: emit cancle bribe event
    }

    function expireBribe() external {
        _expireBribe(nextExpiry);
        // TODO: update next expiry
        // how can I achieve this?
        // nextExpiry = updated week
    }

    function _expireBribe(uint256 weekNumber) internal {
        uint256 curWeek = getCurrWeek(timeStamp32());

        require(weekNumber >= curWeek, "not expired");

        BribeExpiry memory bribeExpiry = bribeToExpire[weekNumber];

        // update bribe rate
        bribeRate -= bribeExpiry.bribeRate;

        // add expired bribes amount to reward pot
        rewardPot += bribeExpiry.totalBribe;

        // we no longer need it
        delete bribeToExpire[weekNumber];

        // TODO: emit bribe expired event
    }

    /*///////////////////////////////////////////////////////////////
                        ACCOUNTING LOGIC
    //////////////////////////////////////////////////////////////*/
    /// @dev calcuates gvEASE balance of a user
    function _power(Balance memory userBal) private view returns (uint256) {
        // update user balance with rewards owed
        userBal.amount += _getReward(userBal);

        return uint256(userBal.amount) + _getExtraPower(userBal);
    }

    /// @dev Calculates extra power boost of a user frozen growth,
    /// and staking growth
    function _getExtraPower(Balance memory userBal)
        private
        view
        returns (uint128)
    {
        uint256 currWeek = getCurrWeek(block.timestamp);
        if ((userBal.startWeek + MAX_GROW) <= currWeek) {
            // meaining the time has passed max grow
            return userBal.amount;
        } else {
            uint256 multFactor = (currWeek - (userBal.startWeek * BUFFER)) /
                MAX_GROW;
            return uint128((userBal.amount * multFactor) / BUFFER);
        }
    }

    function _getReward(Balance memory userBal) private view returns (uint128) {
        //NOTE: user will only get rewards if an only if user has _extraPower

        Balance memory venalPotBal = _balance[address(0)];
        uint256 currWeek = getCurrWeek(block.timestamp);
        // venal pot's extra power
        uint256 extPowV = _getExtraPower(venalPotBal);
        // user's extra power
        uint256 extPowU = _getExtraPower(userBal);
        // week since start for venal pot
        uint256 weekSinceV = currWeek - venalPotBal.startWeek;
        // week since start for user bal
        uint256 weekSinceU = currWeek - userBal.startWeek;

        // area covered by venal pot's power graph
        // venal pot area
        uint256 vArea;
        if (weekSinceV < MAX_GROW) {
            // only need to calculate triangular area
            vArea = (weekSinceV * extPowV) / 2;
        } else {
            // triangular area
            vArea = (MAX_GROW * extPowV) / 2;
            // rectangular area
            vArea += (weekSinceV - MAX_GROW) * extPowV;
        }

        // area covered by user's power graph
        uint256 uArea;
        if (weekSinceU < MAX_GROW) {
            // only need to calculate triangular area
            uArea = (weekSinceU * extPowU) / 2;
        } else {
            // triangular area
            uArea = (MAX_GROW * extPowU) / 2;
            // rectangular area
            uArea += (weekSinceU - MAX_GROW) * extPowU;
        }
        // user share in % of total reward pot
        uint256 userShare = (uArea * BUFFER) / vArea;

        // reward owed to the user
        uint256 rewardAmount = (userShare * rewardPot) / BUFFER;

        return uint128(rewardAmount);
    }

    /*//////////////////////////////////////////////////////////////
                           ONLY DAO
    //////////////////////////////////////////////////////////////*/
    function setPower(bytes32 newPower) external onlyGov {
        _powerRoot = newPower;
    }

    /*//////////////////////////////////////////////////////////////
                        UTILITIES
    //////////////////////////////////////////////////////////////*/
    function timeStamp32() internal view returns (uint32) {
        return uint32(block.timestamp);
    }

    // returns current week since genesis
    function getCurrWeek(uint256 currTime) internal view returns (uint16) {
        return uint16((currTime - genesis) / WEEK);
    }
}

// Major problem I am running into how to expire bribes effectively what I
// want to do is keep next expiry variable and delete that bribe and update
// rewardPot and then update the nextExpiry
