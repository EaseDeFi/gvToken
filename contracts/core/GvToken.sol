/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "hardhat/console.sol";

import "../interfaces/IERC20.sol";
import "../library/MerkleProof.sol";

// solhint-disable not-rely-on-time

interface IBribePot {
    function deposit(address from, uint256 amount) external;

    function withdraw(address to, uint256 amount) external returns (uint256);

    function exit(address user) external;

    function getReward(address user) external returns (uint256);

    function balanceOf(address user) external;
}

contract GvToken {
    uint256 public constant MAX_PERCENT = 100_000;
    uint256 public constant MAX_GROW = 52 weeks;
    uint256 internal constant MULTIPLIER = 1e18;

    IBribePot public immutable pot;
    IERC20Permit public immutable stakingToken;

    address public gov;
    bytes32 private _powerRoot;
    // TODO: this should never be less than 14 days
    uint256 public withdrawalDelay = 14 days;

    mapping(address => Balance) private _balance;
    mapping(address => WithdrawRequest) public withdrawRequests;

    // user => total % staked
    mapping(address => uint256) private _totalStaked;
    // rca-vault => userAddress => %Staked
    mapping(address => mapping(address => uint256)) private _userStakes;
    // amount of power added to BribePot
    mapping(address => uint256) private _bribedAmount;
    mapping(address => uint256) private _powerCollected;

    constructor(
        address _pot,
        address _stakingToken,
        address _gov
    ) {
        pot = IBribePot(_pot);
        stakingToken = IERC20Permit(_stakingToken);
        gov = _gov;
    }

    /*//////////////////////////////////////////////////////////////
                                MODIFIER's
    //////////////////////////////////////////////////////////////*/
    modifier onlyGov() {
        require(msg.sender == gov, "only gov");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                        DEPOSIT IMPL
    //////////////////////////////////////////////////////////////*/
    function deposit(uint256 amount, PermitArgs memory args) external {
        _deposit(msg.sender, amount, args, false);
        emit Deposit(msg.sender, amount);
    }

    // for vArmor holders
    function deposit(
        uint256 amount,
        uint256 powerEarned,
        bytes32[] memory proof,
        PermitArgs memory args
    ) external {
        bytes32 leaf = keccak256(
            abi.encodePacked(msg.sender, amount, powerEarned)
        );

        require(MerkleProof.verify(proof, _powerRoot, leaf), "invalid proof");
        require(powerEarned <= amount, "more than max power");

        // collect power for vArmor holders
        _powerCollected[msg.sender] = powerEarned;

        _deposit(msg.sender, amount, args, false);
        emit Deposit(msg.sender, amount);
    }

    function _deposit(
        address user,
        uint256 amount,
        PermitArgs memory args,
        bool fromBribePot
    ) private {
        Balance memory userBal = _balance[user];
        // collect power
        uint256 powerCollected = _powerCollected[user];
        // add power collected until now if it's not first deposit
        if (userBal.amount != 0) {
            powerCollected += _powerEarned(userBal, user);
            // gvToken cannot be more than 2 times the deposit
            if (powerCollected > userBal.amount) {
                powerCollected = userBal.amount;
            }
            // update power collected for the user
            _powerCollected[user] = powerCollected;
        }

        userBal.depositStart = uint32(block.timestamp);
        userBal.amount += uint112(amount);
        // calculate growth rate
        uint256 growthRate = ((userBal.amount - powerCollected) * MULTIPLIER) /
            MAX_GROW;
        userBal.growthRate = uint112(growthRate / MULTIPLIER);
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
            // TODO: use safe transfer
            stakingToken.transferFrom(user, address(this), amount);
        }

        // Update user balance
        _balance[user] = userBal;
    }

    function _powerEarned(Balance memory userBal, address user)
        private
        view
        returns (uint256)
    {
        uint256 powerCollected = _powerCollected[user];

        uint256 powerEarned = userBal.growthRate *
            (block.timestamp - userBal.depositStart);
        if ((powerCollected + powerEarned) > userBal.amount) {
            return userBal.amount - powerCollected;
        }
        return powerEarned;
    }

    function power(address user) external view returns (uint256) {
        // returns gvToken balance of a user
        return _power(user);
    }

    // TODO: pass in user_bal for gas efficiency later
    function _power(address user) private view returns (uint256) {
        // returns gvToken balance of a user
        Balance memory userBal = _balance[user];
        uint256 powerCollected = _powerCollected[user];
        uint256 powerEarned = _powerEarned(userBal, user);
        return (userBal.amount + powerCollected + powerEarned);
    }

    function withdrawRequest(uint256 amount, bool bribePot) external {
        address user = msg.sender;
        Balance memory userBal = _balance[user];
        // TODO: check amount deposited to the bribe pot
        // do we want to withdraw from bribe pot on withdraw
        // request?
        require(userBal.amount >= amount, "not enough balance");

        uint256 userPower = _power(user);
        uint256 growthPercentage = (userPower * (MAX_PERCENT / 100)) /
            userBal.amount;
        // Withdraw amount in gvPower
        uint256 amountInGvPower = (growthPercentage * amount) / MAX_PERCENT;
        uint256 rewards;

        if (bribePot) {
            // TODO: should withdraw collect rewards too I think yes
            // you need to figure this out
            // this line will fail if the user does not have equivalent amount
            // of gvPower in bribepot wrt ease amount being withdrawn
            pot.withdraw(user, amountInGvPower);
            // TODO: add reward amount to the user withdraw amount
            rewards = pot.getReward(user);
        } else {
            require(
                amountInGvPower <= (userPower - _bribedAmount[user]),
                "withdraw from bribePot"
            );
        }

        WithdrawRequest memory currReq = withdrawRequests[user];

        uint256 endTime = block.timestamp + withdrawalDelay;
        currReq.endTime = uint32(endTime);
        currReq.amount += uint112(amount);
        currReq.rewards += uint112(rewards);
        withdrawRequests[user] = currReq;

        userBal.amount -= uint112(amount);

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

        stakingToken.transfer(user, userReq.amount + userReq.rewards);

        // TODO: should I care about rewards here
        emit RedeemFinalize(user, userReq.amount);
    }

    /*//////////////////////////////////////////////////////////////
                        STAKING IMPL
    //////////////////////////////////////////////////////////////*/
    function stake(uint256 balancePercent, address vault) external {
        address user = msg.sender;
        uint256 totalStake = _totalStaked[user];
        totalStake += balancePercent;

        require(totalStake < MAX_PERCENT, "can't stake more than 100%");

        _totalStaked[user] = totalStake;
        _userStakes[vault][user] += balancePercent;

        emit Stake(user, vault, balancePercent);
    }

    function unStake(uint256 balancePercent, address vault) external {
        address user = msg.sender;

        _userStakes[vault][user] -= balancePercent;
        _totalStaked[user] -= balancePercent;

        emit UnStake(user, vault, balancePercent);
    }

    /*//////////////////////////////////////////////////////////////
                        BRIBING IMPL
    //////////////////////////////////////////////////////////////*/
    function depositToPot(uint256 amount) external {
        // check for amount staked and gvPower
        address user = msg.sender;
        uint256 totalPower = _power(user);
        uint256 bribedAmount = _bribedAmount[user];

        require(totalPower >= (amount + bribedAmount), "not enough power");

        _bribedAmount[user] += amount;
        pot.deposit(user, amount);
    }

    // Probably this function will be internal?
    function withdrawFromPot(uint256 amount, address user) external {
        // unlock gvAmount
        _bribedAmount[msg.sender] -= amount;
        pot.withdraw(user, amount);
    }

    /*//////////////////////////////////////////////////////////////
                        ONLY GOV
    //////////////////////////////////////////////////////////////*/
    function setPower(bytes32 root) external onlyGov {
        _powerRoot = root;
    }

    function setDelay(uint256 time) external onlyGov {
        time = (time / 1 weeks) * 1 weeks;
        // TODO: what should be minimum delay that even gov can't go under
        require(time > 2 weeks, "min delay 14 days");
        withdrawalDelay = time;
    }

    struct PermitArgs {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    struct Balance {
        uint112 amount;
        uint112 growthRate;
        uint32 depositStart;
    }

    struct WithdrawRequest {
        uint112 amount;
        uint112 rewards;
        uint32 endTime;
    }

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event Deposit(address indexed user, uint256 amount);
    event RedeemRequest(address indexed user, uint256 amount, uint256 endTime);
    event RedeemFinalize(address indexed user, uint256 amount);
    event Stake(
        address indexed user,
        address indexed vault,
        uint256 percentage
    );

    event UnStake(
        address indexed user,
        address indexed vault,
        uint256 percentage
    );
    // TODO: VIEW FUNCTIONS
    // 1. user deposit to growth percentage for the frontend
    // 2. total gvPower staked to different rca Vault's instead of percentage
}
