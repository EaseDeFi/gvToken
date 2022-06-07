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
    uint256 internal constant MAX_GROW = 52 weeks;
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
    mapping(uint256 => BribeRate) internal bribeRates;
    // rca-vault => user => BribeDetails
    mapping(address => mapping(address => BribeDetail)) internal bribes;
    // rewards
    uint256 internal rewardPot;
    // user => rewardPot at the time of redeem
    // TODO: do I need to store venal pot ease bal at last redeem?
    mapping(address => uint256) userRewardStartsAt;

    // EASE per week for entire venal pot(gvEASE for bribe)
    uint256 internal bribeRate;

    // last bribe expired (store week from genesis)
    uint256 internal lastExpiry;

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

    modifier update() {
        uint256 currWeek = getCurrWeek(block.timestamp);
        if (bribeRate > 0 && lastExpiry + 1 < currWeek) {
            updateBribe();
        }
        _;
    }
    modifier reward(address user) {
        // TODO: Reward the user up until the current reward pot

        userRewardStartsAt[msg.sender] = rewardPot;
        _;
    }

    /*//////////////////////////////////////////////////////////////
                        DEPOSIT IMPL
    //////////////////////////////////////////////////////////////*/

    function deposit(uint256 amount) external update reward(msg.sender) {
        _deposit(amount, block.timestamp, msg.sender);
        emit Deposit(msg.sender, amount);
    }

    // for vArmor holders
    function deposit(
        uint256 amount,
        uint256 timeStart,
        bytes32[] memory proof
    ) external update reward(msg.sender) {
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

        userBal.depositStart = _normalizeTimeForward(
            userBal.amount,
            userBal.depositStart,
            amount,
            currTime
        );
        userBal.rewardStart = userBal.depositStart;
        userBal.amount = uint112(amount);

        Balance memory venalPotBal = _balance[address(0)];

        venalPotBal.amount += uint112(amount);
        venalPotBal.depositStart = uint32(
            ((amount * currTime) +
                (venalPotBal.amount * venalPotBal.depositStart)) /
                (amount + venalPotBal.amount)
        );
        venalPotBal.depositStart = _normalizeTimeForward(
            venalPotBal.amount,
            venalPotBal.depositStart,
            amount,
            currTime
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
    function withdraw(uint256 amount) external update reward(msg.sender) {
        // THINK MORE
        // Add rewards wrt amount being withdrawn
        uint256 currWeek = getCurrWeek(block.timestamp);
        address user = msg.sender;
        Balance memory userBal = _balance[user];
        Balance memory venalPotBal = _balance[address(0)];
        bool frozen = currWeek - userBal.depositStart > MAX_GROW;
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
        // TODO: (Verify this assmuption while testing)
        venalPotBal.depositStart = uint32(
            ((venalPotBal.amount * venalPotBal.depositStart) -
                (amount * userBal.depositStart)) / (venalPotBal.amount - amount)
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

    function withdrawRequest(uint256 amount)
        external
        update
        reward(msg.sender)
    {
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
        currReq.endTime = _normalizeTimeForward(
            amount,
            endTime,
            currReq.amount,
            currReq.endTime
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
    function stake(uint256 balancePercent, address vault)
        external
        update
        reward(msg.sender)
    {
        // NOTE: things that should happen in this function call

        // 1. reward user for the amount being staked. Aka update user's balance
        //  with owed amount of $EASE for the % balance

        // 2.update the venal pot

        // 3. update users'bal

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

        // normalize depositStart for bribebal
        venalPotBal.depositStart = uint32(
            ((venalPotBal.amount * venalPotBal.depositStart) -
                (amount * userBal.depositStart)) / (venalPotBal.amount - amount)
        );
        venalPotBal.depositStart = _normalizeTimeBackward(
            venalPotBal.amount,
            venalPotBal.depositStart,
            amount,
            userBal.depositStart
        );
        _balance[address(0)] = venalPotBal;

        uint256 userEaseBal = userBal.amount;
        // reward whatever is owed to the user for the %balance
        // so that we don't run into complications on bribe and slashed
        // rewards
        userBal.amount = uint128(amount);
        uint256 rewardAmt = _getReward(userBal);
        userBal.amount = uint128(rewardAmt + userEaseBal);
        // is there a need to account total claimed rewards?
        rewardPot -= rewardAmt;
        _balance[user] = userBal;
        emit Stake(user, vault, balancePercent);
    }

    function unStake(uint256 balancePercent, address vault)
        external
        update
        reward(msg.sender)
    {
        // Unstake from a rca-vault

        // Should update the ease balance of user by the amount of reward owed
        // for unstaked balance of user

        // Should update venal pot balance

        address user = msg.sender;
        // keep power up for sale
        Balance memory userBal = _balance[user];
        Balance memory venalPotBal = _balance[address(0)];
        uint256 amount = (uint256(_balance[user].amount) * balancePercent) /
            DENOMINATOR;
        // should I care about normalizing time? probably yes
        venalPotBal.depositStart = uint32(
            (amount *
                userBal.depositStart +
                venalPotBal.amount *
                venalPotBal.depositStart) / (amount + venalPotBal.amount)
        );
        venalPotBal.amount += uint128(amount);

        _balance[address(0)] = venalPotBal;
        // reward user for their unstaked balance to remove complexity
        // on distributing rewards

        uint256 rewardFor = userBal.amount -
            ((uint256(userBal.amount) * _totalStaked[user]) / DENOMINATOR);

        // backup
        uint256 userEaseBal = userBal.amount;
        // updating amount for getting reward owed for
        // the unstaked amount of the user so that we are in
        // sync with rewards calculation
        userBal.amount = uint128(rewardFor);
        uint256 rewardAmt = _getReward(userBal);
        userBal.amount = uint128(userEaseBal + rewardAmt);
        userBal.rewardStart = timeStamp32();
        // update reward pot
        rewardPot -= rewardAmt;

        _userStakes[vault][user] -= balancePercent;
        _totalStaked[user] -= balancePercent;

        emit UnStake(user, vault, balancePercent);
    }

    /*//////////////////////////////////////////////////////////////
                        BRIBING IMPL
    //////////////////////////////////////////////////////////////*/

    function bribe(
        uint256 bribePerWeek,
        address vault,
        uint256 numOfWeeks // Total weeks to bribe
    ) external {
        uint256 startWeek = (timeStamp32() - genesis / WEEK) + 1;
        uint256 endWeek = startWeek + numOfWeeks;

        address briber = msg.sender;

        // check if bribe already exists
        require(!bribes[vault][briber].exists, "bribe already exists");

        bribes[vault][briber] = BribeDetail(
            uint16(startWeek),
            uint16(endWeek),
            true,
            uint112(bribePerWeek)
        );

        // transfer amount to bribe pot
        uint256 amount = bribePerWeek * numOfWeeks;
        token.transferFrom(briber, address(this), amount);

        bribeRates[startWeek].startAmt += uint112(bribePerWeek);
        bribeRates[endWeek].expireAmt += uint112(bribePerWeek);

        // TODO: emit bribe event
    }

    function cancelBribe(address vault) external {
        // if bribe seems expensive user can stop streaming
        address briber = msg.sender;
        BribeDetail memory userBribe = bribes[vault][briber];
        delete bribes[vault][briber];
        uint256 currWeek = getCurrWeek(timeStamp32());

        // refund what ever is owed to the user

        // if bribe has expired already this line will error
        uint256 amountToRefund = (userBribe.endWeek - currWeek) *
            userBribe.rate;

        // remove expire amt from end week
        bribeRates[userBribe.endWeek].expireAmt -= userBribe.rate;
        // add expire amt to next week
        bribeRates[currWeek + 1].expireAmt += userBribe.rate;

        token.safeTransfer(briber, amountToRefund);
        // TODO: emit cancle bribe event
    }

    function updateBribe() public {
        // TODO: revisit this while testing
        uint256 currWeek = getCurrWeek(timeStamp32());
        uint256 week = lastExpiry + 1;

        while (currWeek > week) {
            BribeRate memory rates = bribeRates[week];
            // add bribe rate to reward pot
            rewardPot += bribeRate;

            // deduct expired amt form bribe rate
            bribeRate -= rates.expireAmt;
            // add new start amt
            bribeRate += rates.startAmt;
            delete bribeRates[week];
            week++;
            // TODO: emit bribe expired ?
        }
        // update last expiry
        lastExpiry = week - 1;
    }

    /*///////////////////////////////////////////////////////////////
                        ACCOUNTING LOGIC
    //////////////////////////////////////////////////////////////*/

    /// @dev calcuates gvEASE balance of a user
    function _power(Balance memory userBal) private view returns (uint256) {
        // update user balance with rewards owed
        userBal.amount += _getReward(userBal);

        return uint256(userBal.amount) + _powerEarned(userBal);
    }

    /// @dev Calculates extra power boost of a user frozen growth,
    /// and staking growth
    function _powerEarned(Balance memory userBal)
        private
        view
        returns (uint128)
    {
        uint256 currTime = timeStamp32();
        if ((userBal.depositStart + MAX_GROW) <= currTime) {
            // meaining the time has passed max grow
            return userBal.amount;
        } else {
            uint256 multFactor = (currTime - (userBal.depositStart * BUFFER)) /
                MAX_GROW;
            return uint128((userBal.amount * multFactor) / BUFFER);
        }
    }

    function _getReward(Balance memory userBal) private view returns (uint128) {
        Balance memory venalPotBal = _balance[address(0)];
        uint256 currTime = timeStamp32();
        // venal pot's extra power
        uint256 extPowV = _powerEarned(venalPotBal);
        // user's extra power current time
        uint256 extPowU = _powerEarned(userBal);

        // user's extra power at last reward time
        userBal.depositStart = userBal.rewardStart;
        uint256 powAtLastReward = _powerEarned(userBal);

        // time since start for venal pot
        uint256 timeSinceV = currTime - venalPotBal.depositStart;
        // time since reward start for the user
        uint256 timeSinceU = currTime - userBal.rewardStart;

        // area covered by venal pot's power graph
        // venal pot area
        uint256 vArea;
        if (timeSinceV < MAX_GROW) {
            // only need to calculate triangular area
            vArea = (timeSinceV * extPowV) / 2;
        } else {
            // triangular area
            vArea = (MAX_GROW * extPowV) / 2;
            // rectangular area
            vArea += (timeSinceV - MAX_GROW) * extPowV;
        }
        // add initial easeDeposit area
        vArea += timeSinceV * venalPotBal.amount;

        // area covered by user's power graph
        uint256 uArea;
        if (timeSinceU < MAX_GROW) {
            // only need to calculate triangular area
            uArea = (timeSinceU * extPowU) / 2;
        } else {
            // triangular area
            uArea = (MAX_GROW * extPowU) / 2;
            // rectangular area
            uArea += (timeSinceU - MAX_GROW) * extPowU;
        }
        // add initial easeDeposit area
        uArea += timeSinceU * userBal.amount;

        // user share in % of total reward pot
        uint256 userShare = (uArea * BUFFER) / vArea;

        // reward owed to the user
        uint256 rewardAmount = (userShare * rewardPot) / BUFFER;

        return uint128(rewardAmount);
    }

    function _updateReward(Balance memory userBal) internal {
        // TODO: update reward of a user
    }

    /*//////////////////////////////////////////////////////////////
                           ONLY DAO
    //////////////////////////////////////////////////////////////*/
    function setPower(bytes32 newPower) external onlyGov {
        _powerRoot = newPower;
    }

    function setMinSlash(uint256 percent) external onlyGov {
        // TODO: revisit this
        require(percent < DENOMINATOR, "you can't slash more than 100%");
        minSlash = percent;
    }

    function setMaxSlash(uint256 percent) external onlyGov {
        // TODO: revisit this
        require(percent < DENOMINATOR, "you can't slash more than 100%");
        maxSlash = percent;
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

    function _normalizeTimeForward(
        uint256 oldAmount,
        uint256 oldTime,
        uint256 newAmount,
        uint256 newTime
    ) internal pure returns (uint32 normalizedTime) {
        normalizedTime = uint32(
            ((oldAmount * oldTime) + (newAmount * newTime)) /
                (oldAmount + newAmount)
        );
    }

    function _normalizeTimeBackward(
        uint256 oldAmount,
        uint256 oldTime,
        uint256 newAmount,
        uint256 newTime
    ) internal pure returns (uint32 normalizedTime) {
        normalizedTime = uint32(
            ((oldAmount * oldTime) - (newAmount * newTime)) /
                (oldAmount - newAmount)
        );
    }
}
