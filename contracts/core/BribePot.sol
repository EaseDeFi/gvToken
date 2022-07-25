/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "hardhat/console.sol";

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IRcaController.sol";

// solhint-disable not-rely-on-time

contract BribePot {
    using SafeERC20 for IERC20Permit;
    uint256 private constant WEEK = 1 weeks;
    uint256 private constant MULTIPLIER = 1e18;

    /* ========== STATE VARIABLES ========== */

    IERC20Permit public immutable rewardsToken;
    IRcaController public immutable rcaController;
    address public gvToken;
    /// @notice Time upto which bribe rewards are active
    uint256 public periodFinish = 0;
    /// @notice A dynamic total amount of EASE token to bribe whole pot
    uint256 public bribePerWeek = 0;
    /// @notice Last updated timestamp
    uint256 public lastRewardUpdate;
    uint256 public rewardPerTokenStored;
    /// @notice week upto which bribes has been updated (aka expired)
    uint256 public lastBribeUpdate;

    /// @notice Nearest floor week in timestamp before deployment
    uint256 public immutable genesis = (block.timestamp / WEEK) * WEEK;

    /// @notice user => rca-vault => BribeDetail
    mapping(address => mapping(address => BribeDetail)) public bribes;
    /// @notice weekNumber => Bribes that activate and expire every week
    mapping(uint256 => BribeRate) internal bribeRates;
    mapping(address => uint256) public userRewardPerTokenPaid;
    /// @notice Ease rewards stored for bribing gvEASE
    mapping(address => uint256) public rewards;

    /// @notice total gvEASE deposited to bribe pot
    uint256 private _totalSupply;
    /// @notice user balance of gvEASE deposited to bribe pot
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

        ) = _getBribeUpdates();
        return _rewardPerToken(additionalRewardPerToken, currBribePerWeek);
    }

    function _rewardPerToken(
        uint256 additionalRewardPerToken,
        uint256 currBribePerWeek
    ) private view returns (uint256 calcRewardPerToken) {
        uint256 lastUpdate = lastRewardUpdate;
        uint256 timestamp = block.timestamp;
        // if last reward update is before current week we need to
        // set it to end of last week as getBribeUpdates() has
        // taken care of additional rewards for that time
        if (lastUpdate < ((timestamp / WEEK) * WEEK)) {
            lastUpdate = (timestamp / WEEK) * WEEK;
        }

        uint256 bribeRate = (currBribePerWeek * MULTIPLIER) / WEEK;
        uint256 lastRewardApplicable = lastTimeRewardApplicable();

        calcRewardPerToken = rewardPerTokenStored + additionalRewardPerToken;

        if (lastRewardApplicable > lastUpdate) {
            calcRewardPerToken += (((lastRewardApplicable - lastUpdate) *
                bribeRate) / (_totalSupply));
        }
    }

    /// @notice amount of EASE token earned for bribing gvEASE
    /// @param account address of a user to get earned rewards
    /// @return amount of reward owed to the user
    function earned(address account) public view returns (uint256) {
        (
            uint256 additionalRewardPerToken,
            uint256 currBribePerWeek,

        ) = _getBribeUpdates();
        uint256 currRewardPerToken = _rewardPerToken(
            additionalRewardPerToken,
            currBribePerWeek
        );
        return _earned(account, currRewardPerToken);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */
    ///@notice Deposit gvEase of a user
    ///@param from wallet address of a user
    ///@param amount amount of gvEase to deposit to venal pot
    function deposit(address from, uint256 amount)
        external
        onlyGvToken(msg.sender)
    {
        require(amount > 0, "Cannot stake 0");
        // update reward rates and bribes
        _update(from);
        _totalSupply += amount;
        _balances[from] += amount;
        emit Deposited(from, amount);
    }

    ///@notice Withdraw gvEase of user
    ///@param from wallet address of a user
    ///@param amount amount of gvEase to withdraw from venal pot
    function withdraw(address from, uint256 amount)
        external
        onlyGvToken(msg.sender)
    {
        require(amount > 0, "Cannot withdraw 0");
        // update reward rates and bribes
        _update(from);
        _totalSupply -= amount;
        _balances[from] -= amount;
        emit Withdrawn(from, amount);
    }

    ///@notice Transfers rewards amount to the desired user
    ///@param user address of gvEase depositor
    ///@param toUser boolean to identify whom to transfer (gvEASE contract/user)
    function getReward(address user, bool toUser)
        external
        onlyGvToken(msg.sender)
        returns (uint256)
    {
        // update reward rates and bribes
        _update(user);
        uint256 reward = rewards[user];
        if (reward > 0) {
            rewards[user] = 0;

            // if user wants to reDeposit transfer to gvToken else
            // transfer to user's wallet
            user = toUser ? user : gvToken;
            rewardsToken.safeTransfer(user, reward);
            emit RewardPaid(user, reward);
        }
        return reward;
    }

    /* ========== BRIBE LOGIC ========== */
    ///@notice Adds bribes per week to venal pot and recieve percentage
    /// share of the venal pot depending on share of the bribe the briber
    /// is paying per week. Bribe will activate starting next week.
    ///@param bribeRate EASE per week for percentage share of bribe pot
    ///@param vault Rca-vault address to bribe gvEASE for
    ///@param numOfWeeks Number of weeks to bribe with the current rate
    function bribe(
        uint256 bribeRate,
        address vault,
        uint256 numOfWeeks, // Total weeks to bribe
        PermitArgs memory permit
    ) external {
        require(_totalSupply > 0, "nothing to bribe");

        require(rcaController.activeShields(vault), "inactive vault");
        // update

        uint256 startWeek = ((block.timestamp - genesis) / WEEK) + 1;
        uint256 endWeek = startWeek + numOfWeeks;
        address briber = msg.sender;
        // check if bribe already exists
        require(
            bribes[briber][vault].endWeek <= getCurrWeek(),
            "bribe already exists"
        );

        bribes[briber][vault] = BribeDetail(
            uint112(bribeRate),
            uint16(startWeek),
            uint16(endWeek)
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

    /// @notice Allows user to cancel existing bribe if it seems unprofitable.
    /// Transfers remaining EASE amount to the briber by rounding to end of current week
    /// @param vault Rca-vault address to cancel bribe for
    function cancelBribe(address vault) external {
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
        if (endTime == periodFinish) {
            uint256 lastBribeEndWeek = userBribe.endWeek;
            while (lastBribeEndWeek > currWeek) {
                if (bribeRates[lastBribeEndWeek].expireAmt != 0) {
                    periodFinish = genesis + (lastBribeEndWeek * WEEK);
                    break;
                }
                lastBribeEndWeek--;
            }
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

    ///@notice Current week count from genesis starts at 0
    function getCurrWeek() private view returns (uint256) {
        return ((block.timestamp - genesis) / WEEK);
    }

    /// @notice calculates additional reward per token and current bribe
    /// per week for view functions
    /// @return addRewardPerToken additional reward per token
    /// @return currentBribePerWeek bribe per week for current week
    /// @return bribeUpdatedUpto week number from genesis upto which bribes
    /// have been calculated for rewards
    function _getBribeUpdates()
        private
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
        while (currWeek > bribeUpdatedUpto) {
            if (_totalSupply != 0) {
                if (rewardedUpto != 0) {
                    // this means that user deposited or withdrew funds in between week
                    // we need to update ratePerTokenStored
                    addRewardPerToken +=
                        (((currentBribePerWeek * MULTIPLIER) / WEEK) *
                            (WEEK - rewardedUpto)) /
                        _totalSupply;
                } else {
                    // caclulate weeks bribe rate
                    rates = bribeRates[bribeUpdatedUpto];
                    // remove expired amount from bribeRate
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

    function _earned(address account, uint256 currRewardPerToken)
        private
        view
        returns (uint256)
    {
        return
            ((_balances[account] *
                (currRewardPerToken - (userRewardPerTokenPaid[account]))) /
                (MULTIPLIER)) + rewards[account];
    }

    ///@notice Update rewards collected and rewards per token paid
    ///for the user's account
    function _update(address account) private {
        (
            uint256 additionalRewardPerToken,
            uint256 currBribePerWeek,
            uint256 bribeUpdatedUpto
        ) = _getBribeUpdates();

        lastBribeUpdate = bribeUpdatedUpto;
        bribePerWeek = currBribePerWeek;

        rewardPerTokenStored = _rewardPerToken(
            additionalRewardPerToken,
            currBribePerWeek
        );

        // should be updated after calculating _rewardPerToken()
        lastRewardUpdate = lastTimeRewardApplicable();

        if (account != address(0)) {
            rewards[account] = _earned(account, rewardPerTokenStored);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }

    /* ========== MODIFIERS ========== */

    modifier onlyGvToken(address caller) {
        require(caller == gvToken, "only gvToken");
        _;
    }

    /* ========== EVENTS ========== */

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
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
        /// @notice Ease paid per week
        uint112 rate;
        /// @notice Bribe Start week (including)
        uint32 startWeek;
        /// @notice Bribe end week (upto)
        uint32 endWeek;
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
