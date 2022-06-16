/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// This will be modified version of staking rewards
// contract of snx. We will replace notifyRewardAmount of staking rewards
// with bribe() and figure out to implement cancleBribe() and expireBribe()

// solhint-disable not-rely-on-time
contract BribePot {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    IERC20 public rewardsToken;
    address public depositToken;
    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public rewardsDuration = 7 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public lastExpiry;

    uint256 public immutable genesis = block.timestamp;

    // rca-vault => user => BribeDetails
    mapping(address => mapping(address => BribeDetail)) internal bribes;
    // week => amount of ease expiring
    mapping(uint256 => BribeRate) internal bribeRates;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    /* ========== CONSTRUCTOR ========== */

    constructor(address _depositToken, address _rewardsToken) {
        rewardsToken = IERC20(_rewardsToken);
        depositToken = _depositToken;
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
            (lastTimeRewardApplicable() -
                ((lastUpdateTime) * (rewardRate) * (1e18)) /
                (_totalSupply));
    }

    function earned(address account) public view returns (uint256) {
        return
            (_balances[account] *
                (rewardPerToken() - (userRewardPerTokenPaid[account]))) /
            (1e18) +
            (rewards[account]);
    }

    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function deposit(address from, uint256 amount)
        external
        onlyGvToken(msg.sender)
        updateReward(from)
    {
        require(amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply + amount;
        _balances[from] = _balances[from] + amount;
        emit Deposited(from, amount);
    }

    function withdraw(address from, uint256 amount)
        public
        onlyGvToken(msg.sender)
        updateReward(from)
    {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply = _totalSupply - amount;
        _balances[from] = _balances[from] - amount;
        emit Withdrawn(from, amount);
    }

    function getReward(address user)
        public
        onlyGvToken(msg.sender)
        updateReward(user)
    {
        uint256 reward = rewards[user];
        if (reward > 0) {
            rewards[user] = 0;
            rewardsToken.safeTransfer(user, reward);
            emit RewardPaid(user, reward);
        }
    }

    function exit(address user) external onlyGvToken(msg.sender) {
        withdraw(user, _balances[user]);
        getReward(user);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    // TODO: remove this function once you fully implement bribe
    // Keeping this for reference
    function notifyRewardAmount(uint256 reward)
        external
        updateReward(address(0))
    {
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining - rewardRate;
            rewardRate = reward + (leftover / rewardsDuration);
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = rewardsToken.balanceOf(address(this));
        require(
            rewardRate <= balance / rewardsDuration,
            "Provided reward too high"
        );

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(reward);
    }

    /* ========== BRIBE LOGIC ========== */

    function bribe(
        uint256 bribePerWeek,
        address vault,
        uint256 numOfWeeks // Total weeks to bribe
    ) external {
        uint256 startWeek = (block.timestamp - genesis / 1 weeks) + 1;
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
        rewardsToken.transferFrom(briber, address(this), amount);

        bribeRates[startWeek].startAmt += uint112(bribePerWeek);
        bribeRates[endWeek].expireAmt += uint112(bribePerWeek);

        // TODO: emit bribe event
    }

    function cancelBribe(address vault) external {
        // if bribe seems expensive user can stop streaming
        address briber = msg.sender;
        BribeDetail memory userBribe = bribes[vault][briber];
        delete bribes[vault][briber];
        uint256 currWeek = getCurrWeek();

        // refund what ever is owed to the user

        // if bribe has expired already this line will error
        uint256 amountToRefund = (userBribe.endWeek - currWeek) *
            userBribe.rate;

        // remove expire amt from end week
        bribeRates[userBribe.endWeek].expireAmt -= userBribe.rate;
        // add expire amt to next week
        bribeRates[currWeek + 1].expireAmt += userBribe.rate;

        rewardsToken.safeTransfer(briber, amountToRefund);
        // TODO: emit cancle bribe event
    }

    function expireBribe() public {
        uint256 currWeek = getCurrWeek();
        uint256 week = lastExpiry + 1;

        while (currWeek > week) {
            // TODO: update reward per token paid

            // TODO: update reward rate

            delete bribeRates[week];
            week++;
            // TODO: emit bribe expired ?
        }
        // update last expiry
        lastExpiry = week - 1;
    }

    /* ========== PRIVATE ========== */
    function getCurrWeek() private view returns (uint256) {
        return block.timestamp - genesis / 1 weeks;
    }

    /* ========== MODIFIERS ========== */

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    modifier onlyGvToken(address caller) {
        require(caller == depositToken, "only gvToken");
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event Recovered(address token, uint256 amount);

    /* ========== STRUCTS ========== */

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
}
