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
    uint256 public bribePerWeek = 0;
    uint256 public rewardsDuration = 7 days;
    uint256 public lastRewardUpdate;
    uint256 public rewardPerTokenStored;
    // week upto which bribes has been updated (aka expired)
    uint256 public lastBribeUpdate;

    /// @notice nearest week in timestamp before deplyment
    uint256 public immutable genesis = (block.timestamp / WEEK) * WEEK;

    // user => rca-vault => BribeDetails
    mapping(address => mapping(address => BribeDetail)) public bribes;
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
        lastRewardUpdate = genesis;
        periodFinish = genesis;
        rcaController = IRcaController(_rcaController);
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    // how to update this? :thinking: so that lastTime reward applicabel
    // will always be correct even if we call from outside the contract?
    // because period finish
    // can I check and update period finish if new bribe is submitted?
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }

        // consider the bribes that has not been
        // added to rewardPerToken because of user inaction
        (
            uint256 additionalRewardPerToken,
            uint256 currBribePerWeek,

        ) = getBribeUpdates();
        uint256 lastUpdate = lastRewardUpdate;
        uint256 timestamp = block.timestamp;
        // if last reward update is before current week we need to
        // set it to end of last week as getBribeUpdates() has
        // taken care of additional rewards for that time
        if (lastUpdate < ((timestamp / WEEK) * WEEK)) {
            lastUpdate = (timestamp / WEEK) * WEEK;
        }

        uint256 bribeRate = (currBribePerWeek * MULTIPLIER) / WEEK;

        uint256 calcRewardPerToken = rewardPerTokenStored +
            additionalRewardPerToken;
        if (lastTimeRewardApplicable() > lastUpdate) {
            calcRewardPerToken += (((lastTimeRewardApplicable() - lastUpdate) *
                bribeRate) / (_totalSupply));
        }
        return calcRewardPerToken;
    }

    function earned(address account) public view returns (uint256) {
        return
            ((_balances[account] *
                (rewardPerToken() - (userRewardPerTokenPaid[account]))) /
                (MULTIPLIER)) + rewards[account];
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function deposit(address from, uint256 amount)
        external
        onlyGvToken(msg.sender)
    {
        require(amount > 0, "Cannot stake 0");
        update(from);
        _totalSupply = _totalSupply + amount;
        _balances[from] = _balances[from] + amount;
        emit Deposited(from, amount);
    }

    function withdraw(address from, uint256 amount)
        public
        onlyGvToken(msg.sender)
    {
        require(amount > 0, "Cannot withdraw 0");
        // update rates and bribes
        update(from);
        _totalSupply -= amount;
        _balances[from] -= amount;
        emit Withdrawn(from, amount);
    }

    function getReward(address user)
        public
        onlyGvToken(msg.sender)
        returns (uint256)
    {
        // update rates and bribes
        update(user);
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
        uint256 bribeRate,
        address vault,
        uint256 numOfWeeks, // Total weeks to bribe
        PermitArgs memory permit
    ) external {
        // TODO: do I wanna keep this check at all?
        require(_totalSupply > 0, "nothing to bribe");

        require(rcaController.activeShields(vault), "inactive vault");
        // update

        uint256 startWeek = ((block.timestamp - genesis) / WEEK) + 1;
        uint256 endWeek = startWeek + numOfWeeks;
        address briber = msg.sender;

        // check if bribe already exists
        require(!bribes[briber][vault].exists, "bribe already exists");

        bribes[briber][vault] = BribeDetail(
            uint16(startWeek),
            uint16(endWeek),
            true,
            uint112(bribeRate)
        );

        // transfer amount to bribe pot
        uint256 amount = bribeRate * numOfWeeks;

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

        bribeRates[startWeek].startAmt += uint112(bribeRate);
        bribeRates[endWeek].expireAmt += uint112(bribeRate);

        // update reward period finish
        uint256 bribeFinish = genesis + (endWeek * WEEK);
        if (bribeFinish > periodFinish) {
            periodFinish = bribeFinish;
        }

        emit BribeAdded(briber, vault, bribeRate, startWeek, endWeek);
    }

    function cancelBribe(address vault) external {
        // TODO: test what happens if the user doesn't add a new vault?

        // if bribe seems expensive user can stop streaming
        address briber = msg.sender;
        BribeDetail memory userBribe = bribes[briber][vault];
        delete bribes[briber][vault];
        uint256 currWeek = getCurrWeek();

        // if bribe starts at week 1 and ends at week 5 that
        // means number of week bribe will be active is 4 weeks

        // if bribe has expired or does not exist this line will error
        uint256 amountToRefund = (userBribe.endWeek - (currWeek + 1)) *
            userBribe.rate;

        // remove expire amt from end week
        bribeRates[userBribe.endWeek].expireAmt -= userBribe.rate;
        // add expire amt to next week
        bribeRates[currWeek + 1].expireAmt += userBribe.rate;
        // need this check if
        if (amountToRefund != 0) {
            rewardsToken.safeTransfer(briber, amountToRefund);
        }

        // update reward end week if this is the last bribe of
        // the system
        uint256 endTime = (userBribe.endWeek * WEEK) + genesis;
        if (
            endTime == periodFinish &&
            bribeRates[userBribe.endWeek].expireAmt == 0
        ) {
            // this means the bribe reward should end when the current
            // bribe expires i.e start of next week
            periodFinish = genesis + ((currWeek + 1) * WEEK);
        }

        emit BribeCanceled(
            briber,
            vault,
            userBribe.rate,
            currWeek + 1,
            userBribe.endWeek
        );
    }

    /* ========== PRIVATE ========== */
    function getCurrWeek() private view returns (uint256) {
        return ((block.timestamp - genesis) / WEEK);
    }

    /// @notice calculates additional reward per token and current bribe
    /// per week for view functions
    /// @return addRewardPerToken additional reward per token
    /// @return currentBribePerWeek bribe upto week it has been updated
    function getBribeUpdates()
        public
        view
        returns (
            uint256 addRewardPerToken,
            uint256 currentBribePerWeek,
            uint256 bribeUpdatedUpto
        )
    {
        // keep backup of where we started
        uint256 _lastBribeUpdate = lastBribeUpdate;

        bribeUpdatedUpto = _lastBribeUpdate;
        uint256 currWeek = getCurrWeek();
        uint256 rewardedUpto = (lastRewardUpdate - genesis) % WEEK;

        currentBribePerWeek = bribePerWeek;
        BribeRate memory rates;
        console.log("Bribe updated upto: ", bribeUpdatedUpto);
        while (currWeek > bribeUpdatedUpto) {
            console.log(
                "---------- BribeUpdated upto: ",
                bribeUpdatedUpto,
                "----------"
            );
            if (_totalSupply != 0) {
                if (rewardedUpto != 0) {
                    // this means that user deposited or withdrew funds in between week
                    // we need to update ratePerTokenStored
                    // TODO: WHAT IF TOTAL SUPPLY IS ZERO?
                    addRewardPerToken +=
                        (((currentBribePerWeek * MULTIPLIER) / WEEK) *
                            (WEEK - rewardedUpto)) /
                        _totalSupply;
                } else {
                    // caclulate weeks bribe rate
                    rates = bribeRates[bribeUpdatedUpto];
                    // remove expired amount from bribeRate
                    console.log("expire amount: ", rates.expireAmt / 1e18);
                    console.log("startAmount amount: ", rates.startAmt / 1e18);
                    currentBribePerWeek -= rates.expireAmt;
                    // additional active bribe
                    currentBribePerWeek += rates.startAmt;
                    addRewardPerToken += ((currentBribePerWeek * MULTIPLIER) /
                        _totalSupply);
                }
            }

            rewardedUpto = 0;
            bribeUpdatedUpto++;
        }
        // we update bribe per week only if we update bribes
        // else we may never enter the while loop and keep updating
        // currentBribePerWeek
        if (_lastBribeUpdate < bribeUpdatedUpto) {
            rates = bribeRates[bribeUpdatedUpto];
            currentBribePerWeek -= rates.expireAmt;
            currentBribePerWeek += rates.startAmt;
        }
    }

    /* ========== MODIFIERS ========== */

    function update(address account) private {
        rewardPerTokenStored = rewardPerToken();
        lastRewardUpdate = lastTimeRewardApplicable();
        (, bribePerWeek, lastBribeUpdate) = getBribeUpdates();

        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
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
        /// @notice Bribe Start week (including)
        uint32 startWeek;
        /// @notice Bribe end week (upto)
        uint32 endWeek;
        /// @notice boolean to check bribe's existance
        bool exists;
        /// @notice Ease paid per week
        uint112 rate;
    }

    struct BribeRate {
        /// @notice amount of bribe to start
        uint128 startAmt;
        /// @notice amount of bribe to expire
        uint128 expireAmt;
    }
    struct PermitArgs {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
}
