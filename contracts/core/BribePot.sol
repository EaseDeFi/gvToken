/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "hardhat/console.sol";

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IRcaController.sol";

// This will be modified version of staking rewards
// contract of snx. We will replace notifyRewardAmount of staking rewards
// with bribe() and figure out to implement cancelBribe() and expireBribe()

// solhint-disable not-rely-on-time

contract BribePot {
    using SafeERC20 for IERC20Permit;
    uint256 private constant WEEK = 1 weeks;
    uint256 private constant MULTIPLIER = 1e18;

    /* ========== STATE VARIABLES ========== */

    IERC20Permit public immutable rewardsToken;
    IRcaController public immutable rcaController;
    address public gvToken;
    uint256 public periodFinish = 0;
    uint256 public bribeRate = 0;
    uint256 public rewardsDuration = 7 days;
    uint256 public lastRewardUpdate;
    uint256 public rewardPerTokenStored;
    // week for which bribe has been expired upto
    uint256 public lastExpiryWeek;

    uint256 public immutable genesis = block.timestamp;

    // user => rca-vault => BribeDetails
    mapping(address => mapping(address => BribeDetail)) internal bribes;
    // week => amount of ease expiring
    mapping(uint256 => BribeRate) internal bribeRates;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address _gvToken,
        address _rewardsToken,
        address _rcaController
    ) {
        rewardsToken = IERC20Permit(_rewardsToken);
        gvToken = _gvToken;
        lastRewardUpdate = block.timestamp;
        lastExpiryWeek = getCurrWeek();
        periodFinish = block.timestamp;
        rcaController = IRcaController(_rcaController);
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored +
            (((lastTimeRewardApplicable() - lastRewardUpdate) * bribeRate) /
                (_totalSupply));
    }

    function earned(address account) public view returns (uint256) {
        return
            ((_balances[account] *
                (rewardPerToken() - (userRewardPerTokenPaid[account]))) /
                (MULTIPLIER)) + rewards[account];
    }

    function getRewardForDuration() external view returns (uint256) {
        return bribeRate * rewardsDuration;
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function deposit(address from, uint256 amount)
        external
        onlyGvToken(msg.sender)
    {
        require(amount > 0, "Cannot stake 0");
        updateBribes();
        updateReward(from);
        _totalSupply = _totalSupply + amount;
        _balances[from] = _balances[from] + amount;
        emit Deposited(from, amount);
    }

    function withdraw(address from, uint256 amount)
        public
        onlyGvToken(msg.sender)
    {
        require(amount > 0, "Cannot withdraw 0");
        // TODO: user should not be able to withdraw if
        // bribe is active and he/she is the only user in the contract
        // revert if _totalSupply-amount == 0 when bribe is active

        updateBribes();
        updateReward(from);
        _totalSupply = _totalSupply - amount;
        _balances[from] -= amount;
        emit Withdrawn(from, amount);
    }

    function getReward(address user)
        public
        onlyGvToken(msg.sender)
        returns (uint256)
    {
        updateBribes();
        updateReward(user);
        uint256 reward = rewards[user];
        if (reward > 0) {
            rewards[user] = 0;
            rewardsToken.safeTransfer(gvToken, reward);
            emit RewardPaid(user, reward);
        }
        return reward;
    }

    function exit(address user) external onlyGvToken(msg.sender) {
        withdraw(user, _balances[user]);
        getReward(user);
    }

    /* ========== BRIBE LOGIC ========== */

    function bribe(
        uint256 bribePerWeek,
        address vault,
        uint256 numOfWeeks, // Total weeks to bribe
        PermitArgs memory permit
    ) external {
        require(_totalSupply > 0, "nothing to bribe");

        require(rcaController.activeShields(vault), "inactive vault");

        uint256 startWeek = ((block.timestamp - genesis) / WEEK) + 1;
        uint256 endWeek = startWeek + numOfWeeks - 1;

        address briber = msg.sender;

        // check if bribe already exists
        require(!bribes[briber][vault].exists, "bribe already exists");

        bribes[briber][vault] = BribeDetail(
            uint16(startWeek),
            uint16(endWeek),
            true,
            uint112(bribePerWeek)
        );

        // transfer amount to bribe pot
        uint256 amount = bribePerWeek * numOfWeeks;

        // TODO: owner, spender and value can be used as msg.sender, address(this), amount
        rewardsToken.permit(
            msg.sender,
            address(this),
            amount,
            permit.deadline,
            permit.v,
            permit.r,
            permit.s
        );

        rewardsToken.safeTransferFrom(briber, address(this), amount);

        bribeRates[startWeek].startAmt += uint112(bribePerWeek);
        bribeRates[endWeek].expireAmt += uint112(bribePerWeek);

        emit BribeAdded(briber, vault, bribePerWeek, startWeek, endWeek);
    }

    function cancelBribe(address vault) external {
        // if bribe seems expensive user can stop streaming
        address briber = msg.sender;
        BribeDetail memory userBribe = bribes[briber][vault];
        delete bribes[briber][vault];
        uint256 currWeek = getCurrWeek();

        // if bribe starts at week 1 and ends at week 5 that
        // means number of week bribe will be active is 4 weeks

        // if bribe has expired or does not exist this line will error
        uint256 amountToRefund = (userBribe.endWeek - currWeek) *
            userBribe.rate;

        // remove expire amt from end week
        bribeRates[userBribe.endWeek].expireAmt -= userBribe.rate;
        // add expire amt to next week
        bribeRates[currWeek + 1].expireAmt += userBribe.rate;

        rewardsToken.safeTransfer(briber, amountToRefund);
        // TODO: emit cancle bribe event
        emit BribeCanceled(
            briber,
            vault,
            userBribe.rate,
            currWeek + 1,
            userBribe.endWeek
        );
    }

    function updateBribes() public {
        // TODO: come back here and fix this total supply issue
        // This is some kind of expire for us
        uint256 currWeek = getCurrWeek();
        uint256 week = lastExpiryWeek;
        if (_totalSupply == 0) {
            return;
        }

        // TODO: check last update
        // if rewardedUpto != 0 that means user action (deposit or withdraw)
        // was taken in between week epoch, this means we need to update
        // rewardPerTokenPaid from rewardedUpto to WEEK as bribe expire every
        // week, let's say the user actions in between week has updated
        // reward per token stored and last update time which does not
        // lie at exactly genesis + (n * WEEK) that means user's action
        // (deposit or withdraw) has made a system update and after that
        // the reward part has not been updated
        uint256 rewardedUpto = (lastRewardUpdate - genesis) % WEEK;
        uint256 addRewardPerToken;
        // adding 1 to briberate to handle rounding error
        uint256 currentBribePerWeek = (((bribeRate + 1) * WEEK)) / MULTIPLIER;
        while (currWeek > week) {
            if (rewardedUpto != 0) {
                // this means that user deposited or withdrew funds in between week
                // we need to update ratePerTokenStored
                // TODO: WHAT IF TOTAL SUPPLY IS ZERO?
                if (_totalSupply != 0) {
                    addRewardPerToken +=
                        (bribeRate * (WEEK - rewardedUpto)) /
                        _totalSupply;
                }
            } else {
                // caclulate weeks bribe rate
                BribeRate memory rates = bribeRates[week];
                // remove expired amount from bribeRate
                currentBribePerWeek -= rates.expireAmt;

                // additional active bribe
                currentBribePerWeek += rates.startAmt;
                if (_totalSupply != 0) {
                    addRewardPerToken += ((currentBribePerWeek * MULTIPLIER) /
                        _totalSupply);
                }
            }

            rewardedUpto = 0;
            delete bribeRates[week];
            week++;
            // TODO: emit bribe expired ?
        }
        // update last expiry
        lastExpiryWeek = week - 1;
        // update reward rate of current or next week
        currentBribePerWeek += bribeRates[week].startAmt;
        // update state variables
        bribeRate = (currentBribePerWeek * MULTIPLIER) / WEEK;

        rewardPerTokenStored += addRewardPerToken;
        lastRewardUpdate = genesis + ((week - 1) * WEEK);

        periodFinish = lastRewardUpdate + WEEK;
    }

    /* ========== PRIVATE ========== */
    function getCurrWeek() private view returns (uint256) {
        return ((block.timestamp - genesis) / WEEK) + 1;
    }

    /* ========== MODIFIERS ========== */

    function updateReward(address account) private {
        rewardPerTokenStored = rewardPerToken();
        lastRewardUpdate = lastTimeRewardApplicable();
        rewards[account] = earned(account);
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }

    modifier onlyGvToken(address caller) {
        require(caller == gvToken, "only gvToken");
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event Recovered(address token, uint256 amount);
    event BribeAdded(
        address indexed user,
        address indexed vault,
        uint256 bribePerWeek,
        uint256 startWeek,
        uint256 endWeek
    );
    event BribeCanceled(
        address indexed user,
        address indexed vault,
        uint256 bribePerWeek,
        uint256 expiryWeek, // this will always currentWeek + 1
        uint256 endWeek
    );

    /* ========== STRUCTS ========== */

    struct BribeDetail {
        uint16 startWeek;
        uint16 endWeek;
        bool exists;
        uint112 rate; // Amount paid in ease tokens per week
    }

    struct BribeRate {
        uint128 startAmt;
        uint128 expireAmt;
    }
    struct PermitArgs {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
}
