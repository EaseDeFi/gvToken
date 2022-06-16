/// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

// import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IERC20.sol";
import "../library/MerkleProof.sol";

// solhint-disable not-rely-on-time

interface IBribePot {
    function deposit(address from, uint256 amount) external;

    function withdraw(address to, uint256 amount) external returns (uint256);

    function exit(address user) external;

    function getReward(address user) external;
}

contract GvToken {
    uint256 public constant MAX_PERCENT = 100_000;

    IBribePot public pot;
    IERC20 public stakingToken;

    address public gov;
    bytes32 private _powerRoot;
    uint256 public withdrawalDelay;

    mapping(address => Balance) private _balance;
    mapping(address => WithdrawRequest) private withdrawRequests;

    // user => total % staked
    mapping(address => uint256) private _totalStaked;
    // rca-vault => userAddress => %Staked
    mapping(address => mapping(address => uint256)) private _userStakes;
    mapping(address => uint256) private _bribedAmount;

    constructor(
        address _pot,
        address _stakingToken,
        address _gov
    ) {
        pot = IBribePot(_pot);
        stakingToken = IERC20(_stakingToken);
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
        _deposit(msg.sender, block.timestamp, amount, args);
        emit Deposit(msg.sender, amount);
    }

    // for vArmor holders
    function deposit(
        uint256 amount,
        uint256 timeStart,
        bytes32[] memory proof,
        PermitArgs memory args
    ) external {
        bytes32 leaf = keccak256(
            abi.encodePacked(msg.sender, amount, timeStart)
        );

        require(MerkleProof.verify(proof, _powerRoot, leaf), "invalid proof");
        _deposit(msg.sender, timeStart, amount, args);
        emit Deposit(msg.sender, amount);
    }

    function _deposit(
        address user,
        uint256 amount,
        uint256 startTime,
        PermitArgs memory args
    ) private {
        Balance memory userBal = _balance[user];
        userBal.depositStart = _normalizeTimeForward(
            userBal.amount,
            userBal.depositStart,
            amount,
            startTime
        );
        userBal.amount = uint112(amount);

        stakingToken.permit(
            args.owner,
            args.spender,
            args.value,
            args.deadline,
            args.v,
            args.r,
            args.s
        );
        stakingToken.transferFrom(user, address(this), amount);
        // Update user balance
        _balance[user] = userBal;
    }

    function withdrawRequest(uint256 amount) external {
        address user = msg.sender;
        Balance memory userBal = _balance[user];
        // TODO: check amount deposited to the bribe pot
        // do we want to withdraw from bribe pot on withdraw
        // request?

        require(userBal.amount >= amount, "not enough balance");

        WithdrawRequest memory currReq = withdrawRequests[user];

        uint256 endTime = block.timestamp + withdrawalDelay;
        currReq.endTime = _normalizeTimeForward(
            amount,
            endTime,
            currReq.amount,
            currReq.endTime
        );
        withdrawRequests[user] = currReq;

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

        stakingToken.transfer(user, userReq.amount);

        emit RedeemFinalize(user, userReq.amount);
    }

    function depositToVPot(uint256 amount) external {
        // TODO: lock gvAmount
        pot.deposit(msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                        STAKING IMPL
    //////////////////////////////////////////////////////////////*/
    function stake(uint256 balancePercent, address vault) external {
        address user = msg.sender;
        uint256 userStake = _totalStaked[user];
        userStake += balancePercent;

        // TODO: check how much of token has been bribed

        require(userStake < MAX_PERCENT, "can't stake more than 100%");

        _totalStaked[user] = userStake;
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
        // TODO: check for power of user
        _bribedAmount[msg.sender] += amount;
        pot.deposit(msg.sender, amount);
    }

    // Probably this function will be internal?
    function withdrawFromVPot(uint256 amount, address user) external {
        // unlock gvAmount
        _bribedAmount[msg.sender] -= amount;
        pot.withdraw(user, amount);
    }

    // this should be only gov
    function setPot(address bribePot) external {
        pot = IBribePot(bribePot);
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

    struct PermitArgs {
        address owner;
        address spender;
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    struct Balance {
        uint128 amount;
        uint32 depositStart;
    }

    struct WithdrawRequest {
        uint128 amount;
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
}
