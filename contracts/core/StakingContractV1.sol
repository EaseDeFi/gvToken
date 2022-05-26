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
    uint32 internal constant MAX_GROW = 52 weeks;
    uint32 internal constant DELAY = 4 weeks;
    uint32 internal constant WEEK = 1 weeks;

    /// @notice max percentage
    uint32 internal constant DENOMINATOR = 10000;
    uint32 internal constant SLASH_PERCENT = 2000;

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
    RewardPot internal rewardPot;

    // EASE per week for entire venal pot(gvEASE for bribe)
    uint256 internal bribeRate;

    // governance
    address internal _gov;

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

    function _deposit(
        uint128 amount,
        uint64 currentTime,
        address user
    ) private {
        Balance memory userBal = _balance[user];
    }

    function withdraw(uint256 amount) external {
        // TODO: complete this
        // only add rewards for the amount that they are withdrawing
    }

    function stake(uint256 balancePercent, address vault) external {
        // TODO: complete this
        // update user balance with owed rewards
    }

    function unStake(uint256 balancePercent, address vault) external {
        // TODO: complete this
        // update user balance with owed rewards
    }

    /*//////////////////////////////////////////////////////////////
                            BRIBE IMPL
    //////////////////////////////////////////////////////////////*/

    function bribe(
        uint256 bribePerWeek,
        address vault,
        uint256 expiry // timestamp
    ) external {
        // TODO: check if bribe already exists

        uint256 numOfWeeks = (expiry - block.timestamp) / WEEK;
        uint256 startWeek = (timeStamp32() - genesis / WEEK) + 1;
        uint256 endWeek = startWeek + numOfWeeks;

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
    }

    function cancelBribe(address vault) external {
        // if bribe seems expensive user can stop streaming
        BribeDetail memory userBribe = bribes[vault][msg.sender];
        uint256 currWeek = getCurrWeek();

        // refund what ever is owed to the user
        uint256 amountToRefund = (userBribe.endWeek - currWeek) *
            userBribe.ratePerWeek;

        // update our bribe pot?
        rewardPot.bribed +=
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
    }

    function _expireBribe(uint256 weekNumber) internal {
        uint256 curWeek = getCurrWeek();

        require(weekNumber >= curWeek, "not expired");

        BribeExpiry memory bribeExpiry = bribeToExpire[weekNumber];

        // update bribe rate
        bribeRate -= bribeExpiry.bribeRate;

        // add expired bribes amount to reward pot
        rewardPot.bribed += bribeExpiry.totalBribe;

        // we no longer need it
        delete bribeToExpire[weekNumber];
    }

    /*//////////////////////////////////////////////////////////////
                        UTILITIES
    //////////////////////////////////////////////////////////////*/
    function timeStamp32() internal view returns (uint32) {
        return uint32(block.timestamp);
    }

    // returns current week since genesis
    function getCurrWeek() internal view returns (uint16) {
        return uint16((timeStamp32() - genesis) / WEEK);
    }
}

// What are the complications that cancelling bribe will bring
// 1. We need to update bribes per week in EASE for entire venal pot
// 2. let's say a user bribes for ez-aDAI vault @10 EASE per week for 10 weeks
// and later realizes that the %share of venal pot he is getting is not profitable
// and want's to cancel the bribe. Meaning weekly price in ease for 100% of venal pot
// will decrease by 10 EASE.
