import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { getContractAddress, parseEther, randomBytes } from "ethers/lib/utils";
import { ethers } from "hardhat";
import {
  BribePot__factory,
  EaseToken__factory,
  GvToken__factory,
} from "../src/types/factories/contracts/core";
import { RCA_CONTROLLER, RCA_VAULT } from "./constants";
import { getPermitSignature } from "./helpers";
import BalanceTree from "./helpers/balance-tree";
import { Contracts, Signers } from "./types";
import { fastForward, getTimestamp, mine, TIME_IN_SECS } from "./utils";

describe("GvToken", function () {
  const contracts = {} as Contracts;
  const signers = {} as Signers;
  let userAddress: string;
  let bobAddress: string;
  let aliceAddress: string;
  let briberAddress: string;
  before(async function () {
    const accounts = await ethers.getSigners();
    signers.user = accounts[0];
    signers.gov = accounts[1];
    signers.guardian = accounts[2];
    signers.alice = accounts[3];
    signers.bob = accounts[4];
    signers.briber = accounts[5];
    signers.otherAccounts = accounts.slice(6);
    // fill in address
    userAddress = signers.user.address;
    bobAddress = signers.bob.address;
    aliceAddress = signers.alice.address;
    briberAddress = signers.briber.address;
  });
  beforeEach(async function () {
    const EaseTokenFactory = <EaseToken__factory>(
      await ethers.getContractFactory("EaseToken")
    );
    const GvTokenFactory = <GvToken__factory>(
      await ethers.getContractFactory("GvToken")
    );
    const BribePotFactory = <BribePot__factory>(
      await ethers.getContractFactory("BribePot")
    );

    const nonce = await signers.user.getTransactionCount();
    const easeAddress = getContractAddress({
      from: signers.user.address,
      nonce,
    });
    const gvTokenAddress = getContractAddress({
      from: signers.user.address,
      nonce: nonce + 1,
    });
    const bribePotAddress = getContractAddress({
      from: signers.user.address,
      nonce: nonce + 2,
    });
    const GENESIS = (await getTimestamp()).sub(TIME_IN_SECS.year);
    contracts.ease = await EaseTokenFactory.deploy(signers.user.address);
    contracts.gvToken = await GvTokenFactory.deploy(
      bribePotAddress,
      easeAddress,
      RCA_CONTROLLER,
      signers.gov.address,
      GENESIS
    );
    contracts.bribePot = await BribePotFactory.deploy(
      gvTokenAddress,
      easeAddress,
      RCA_CONTROLLER
    );
    // fund user accounts with EASE token
    await contracts.ease
      .connect(signers.user)
      .mint(bobAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.user)
      .mint(aliceAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.user)
      .mint(userAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.user)
      .mint(briberAddress, parseEther("1000000"));
  });

  async function depositFor(user: SignerWithAddress, value: BigNumber) {
    const deadline = (await getTimestamp()).add(1000);
    const spender = contracts.gvToken.address;
    const { v, r, s } = await getPermitSignature({
      signer: user,
      token: contracts.ease,
      value,
      deadline,
      spender,
    });
    await contracts.gvToken
      .connect(user)
      ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
        deadline,
        v,
        r,
        s,
      });
  }

  async function bribeFor(briber: SignerWithAddress, bribePerWeek: BigNumber) {
    // add bribe to bribe pot
    const rcaVaultAddress = RCA_VAULT;
    const numOfWeeks = 2;
    const totalBribeAmt = bribePerWeek.mul(numOfWeeks);
    const spender = contracts.bribePot.address;
    const deadline = (await getTimestamp()).add(1000);
    const { v, r, s } = await getPermitSignature({
      signer: briber,
      token: contracts.ease,
      value: totalBribeAmt,
      deadline,
      spender,
    });
    // add bribe amount to pot
    await contracts.bribePot
      .connect(briber)
      .bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
        deadline,
        v,
        r,
        s,
      });
  }

  describe("restricted", function () {
    it("should not allow other address to call functions", async function () {
      await expect(contracts.gvToken.setPower(randomBytes(32))).to.revertedWith(
        "only gov"
      );
    });
  });

  describe("deposit()", function () {
    it("should deposit ease and recieve gv Power", async function () {
      const value = parseEther("100");
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
      let { v, r, s } = await getPermitSignature({
        signer: signers.user,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      const userEaseBalBefore = await contracts.ease.balanceOf(userAddress);
      await expect(
        contracts.gvToken
          .connect(signers.user)
          ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
            deadline,
            v,
            r,
            s,
          })
      )
        .to.emit(contracts.gvToken, "Deposited")
        .withArgs(userAddress, value);
      const userEaseBalAfter = await contracts.ease.balanceOf(userAddress);
      expect(userEaseBalBefore.sub(userEaseBalAfter)).to.equal(value);

      const power = await contracts.gvToken.balanceOf(userAddress);
      expect(power).to.equal(value);

      // another user
      ({ v, r, s } = await getPermitSignature({
        signer: signers.bob,
        token: contracts.ease,
        spender,
        value,
        deadline,
      }));

      await contracts.gvToken
        .connect(signers.bob)
        ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
          deadline,
          v,
          r,
          s,
        });

      // total ease deposit
      expect(await contracts.gvToken.totalDeposited()).to.equal(value.mul(2));
    });

    it("should allow vArmor holders to deposit", async function () {
      // complete this anon
      const bobValue = parseEther("1000");
      const bobDepositStart = (await getTimestamp()).sub(TIME_IN_SECS.month);
      const aliceValue = parseEther("1200");
      const aliceDepositStart = (await getTimestamp()).sub(
        TIME_IN_SECS.month * 3
      );
      const powerTree = new BalanceTree([
        { account: bobAddress, amount: bobValue, powerEarned: bobDepositStart },
        {
          account: aliceAddress,
          amount: aliceValue,
          powerEarned: aliceDepositStart,
        },
      ]);
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
      // set root
      const root = powerTree.getHexRoot();
      await contracts.gvToken.connect(signers.gov).setPower(root);
      // Bob deposit
      const bobProof = powerTree.getProof(
        bobAddress,
        bobValue,
        bobDepositStart
      );
      let { v, r, s } = await getPermitSignature({
        signer: signers.bob,
        token: contracts.ease,
        value: bobValue,
        deadline,
        spender,
      });
      // check for emit too
      await expect(
        contracts.gvToken
          .connect(signers.bob)
          [
            "deposit(uint256,uint256,bytes32[],(uint256,uint8,bytes32,bytes32))"
          ](bobValue, bobDepositStart, bobProof, { v, r, s, deadline })
      )
        .to.emit(contracts.gvToken, "Deposited")
        .withArgs(bobAddress, bobValue);

      const bobGvBal = await contracts.gvToken.balanceOf(bobAddress);
      // TODO: calculate expected bob extra power
      expect(bobGvBal).to.gt(bobValue.add(parseEther("10")));

      // Alice Deposit
      const aliceProof = powerTree.getProof(
        aliceAddress,
        aliceValue,
        aliceDepositStart
      );
      // update v,r,s for alice
      // I didn't know we could destructure like this
      ({ v, r, s } = await getPermitSignature({
        signer: signers.alice,
        token: contracts.ease,
        value: aliceValue,
        deadline,
        spender,
      }));
      const aliceEaseBalBefore = await contracts.ease.balanceOf(aliceAddress);
      await contracts.gvToken
        .connect(signers.alice)
        ["deposit(uint256,uint256,bytes32[],(uint256,uint8,bytes32,bytes32))"](
          aliceValue,
          aliceDepositStart,
          aliceProof,
          { v, r, s, deadline }
        );
      const aliceEaseBalAfter = await contracts.ease.balanceOf(aliceAddress);
      const alicePower = await contracts.gvToken.balanceOf(aliceAddress);
      expect(alicePower).to.gt(aliceValue.add(parseEther("10")));
      // check ease balance
      expect(aliceEaseBalBefore.sub(aliceEaseBalAfter)).to.equal(aliceValue);
    });
    it("should deposit multiple times and allow user to bribe,stake,and withdraw ", async function () {
      //
      const value = parseEther("10");
      let deadline = (await getTimestamp()).add(1000);
      const initialDepositCount = 50;
      const spender = contracts.gvToken.address;
      for (let i = 0; i < initialDepositCount; i++) {
        deadline = (await getTimestamp()).add(1000);
        const { v, r, s } = await getPermitSignature({
          signer: signers.user,
          token: contracts.ease,
          value,
          deadline,
          spender,
        });
        await contracts.gvToken
          .connect(signers.user)
          ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
            deadline,
            v,
            r,
            s,
          });
        await fastForward(TIME_IN_SECS.month);
        await mine();
      }
      const balPercent = BigNumber.from(10_000);

      await contracts.gvToken
        .connect(signers.user)
        .stake(balPercent, RCA_VAULT);

      await contracts.gvToken
        .connect(signers.user)
        .depositToPot(parseEther("400"));

      // update bribe pot as it's been 50 months since genesis
      // without any bribes

      // first withdraw request
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(parseEther("400"), true);

      const popCount1 = (await contracts.gvToken.withdrawRequests(userAddress))
        .popCount;
      // we have deposits of 10Ease every batch withdraw request
      // of 400EASE results in 40 deposit elements
      expect(popCount1).to.equal(40);

      let currentDepositCount = (
        await contracts.gvToken.getUserDeposits(userAddress)
      ).length;

      expect(currentDepositCount).to.equal(initialDepositCount);

      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(parseEther("3"), true);

      currentDepositCount = (
        await contracts.gvToken.getUserDeposits(userAddress)
      ).length;

      const userWithdrawRequest = await contracts.gvToken.withdrawRequests(
        userAddress
      );

      expect(userWithdrawRequest.popCount).to.equal(40 + 1);

      const depositsBeforeWithdraw = await contracts.gvToken.getUserDeposits(
        userAddress
      );
      await fastForward(TIME_IN_SECS.month);
      await contracts.gvToken.connect(signers.user).withdrawFinalize();
      const deposits = await contracts.gvToken.getUserDeposits(userAddress);
      const expectedDepositsLength = BigNumber.from(
        depositsBeforeWithdraw.length
      ).sub(userWithdrawRequest.popCount);
      expect(deposits.length).to.equal(BigNumber.from(expectedDepositsLength));
    });

    it("should add rewards of bribed amount on multiple deposit", async function () {
      const value = parseEther("1000");
      // deposit
      await depositFor(signers.bob, value);

      // deposit to bribePot
      await contracts.gvToken.connect(signers.bob).depositToPot(value);

      // bribe the pot
      const bribePerWeek = parseEther("50");
      await bribeFor(signers.briber, bribePerWeek);

      // fast forward few weeks
      const genesisPot = await contracts.bribePot.genesis();
      const timeNeededToReachWeek1 = genesisPot
        .add(TIME_IN_SECS.week)
        .sub(await getTimestamp());

      // fast forward inbetween week2 and week3
      await fastForward(
        timeNeededToReachWeek1.add(TIME_IN_SECS.week).toNumber()
      );
      await mine();

      // call deposit again
      const newDepositValue = parseEther("1001");
      await depositFor(signers.bob, newDepositValue);

      const deposits = await contracts.gvToken.getUserDeposits(
        signers.bob.address
      );

      const lastDeposit = deposits[deposits.length - 1];

      expect(lastDeposit.amount.sub(newDepositValue)).to.gte(bribePerWeek);
    });
  });
  describe("stake()", function () {
    const stkPercent = BigNumber.from(10000);
    beforeEach(async function () {
      // deposit
      const value = parseEther("100");
      // deposit bob
      await depositFor(signers.bob, value);

      // deposit user
      await depositFor(signers.user, value);

      // deposit to pot
      // add 50 gvEase from user to bribe pot
      await contracts.gvToken
        .connect(signers.user)
        .depositToPot(value.mul(5).div(10));
      // add 100 gvEase from bob to bribe pot
      await contracts.gvToken.connect(signers.bob).depositToPot(value);

      // add bribe to bribe pot
      const bribePerWeek = parseEther("10");
      const rcaVaultAddress = RCA_VAULT;
      const numOfWeeks = 2;
      const totalBribeAmt = bribePerWeek.mul(numOfWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value: totalBribeAmt,
        deadline,
        spender,
      });
      // add bribe amount to pot
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
          deadline,
          v,
          r,
          s,
        });
      // forward beyond 2nd week
      const genesis = await contracts.bribePot.genesis();
      const timeNeededToReachWeek1 = genesis
        .add(TIME_IN_SECS.week)
        .sub(await getTimestamp());
      // move beyond week2
      await fastForward(
        timeNeededToReachWeek1.add(TIME_IN_SECS.week).toNumber()
      );
      await mine();
    });
    it("should emit Stake event on successful stake", async function () {
      // stake to a vault
      expect(
        await contracts.gvToken
          .connect(signers.user)
          .stake(stkPercent, RCA_VAULT)
      )
        .to.emit(contracts.gvToken, "Stake")
        .withArgs(userAddress, RCA_VAULT, stkPercent);
    });
    it("should fail if staking % is more than 100%", async function () {
      // this should revert
      await expect(
        contracts.gvToken
          .connect(signers.user)
          .stake(stkPercent.mul(11), RCA_VAULT)
      ).to.revertedWith("can't stake more than 100%");
    });
    it("should revert if inactive vault is passed", async function () {
      const inactiveVault = signers.otherAccounts[0].address;
      await expect(
        contracts.gvToken
          .connect(signers.user)
          .stake(stkPercent.mul(11), inactiveVault)
      ).to.revertedWith("vault not active");
      // work
    });
    it("should collect rewards on behalf of the staker from bribePot", async function () {
      // work
      const depositsBeforeStake = await contracts.gvToken.getUserDeposits(
        userAddress
      );

      await contracts.gvToken
        .connect(signers.user)
        .stake(stkPercent, RCA_VAULT);

      const depositsAfterStake = await contracts.gvToken.getUserDeposits(
        userAddress
      );
      // collected rewards should be deposited to gvToken
      expect(depositsAfterStake.length - depositsBeforeStake.length).to.equal(
        1
      );
      const rewardsAmount =
        depositsAfterStake[depositsAfterStake.length - 1].amount;

      // as user's share in bribe pot is 33% expected rewards
      // at 10EASE pre week of bribe equals around 3.33 EASE
      const expectedRewards = parseEther("3.33");
      expect(rewardsAmount).to.gte(expectedRewards);
    });
  });
  describe("unstake()", function () {
    const stkPercent = BigNumber.from(10000);
    beforeEach(async function () {
      // deposit
      const value = parseEther("100");
      // deposit bob
      await depositFor(signers.bob, value);

      // deposit user
      await depositFor(signers.user, value);

      // stake to a vault
      await contracts.gvToken
        .connect(signers.user)
        .stake(stkPercent, RCA_VAULT);

      // deposit to pot
      // add 50 gvEase from user to bribe pot
      await contracts.gvToken
        .connect(signers.user)
        .depositToPot(value.mul(5).div(10));
      // add 100 gvEase from bob to bribe pot
      await contracts.gvToken.connect(signers.bob).depositToPot(value);

      // add bribe to bribe pot
      const bribePerWeek = parseEther("10");
      const rcaVaultAddress = RCA_VAULT;
      const numOfWeeks = 2;
      const totalBribeAmt = bribePerWeek.mul(numOfWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value: totalBribeAmt,
        deadline,
        spender,
      });
      // add bribe amount to pot
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
          deadline,
          v,
          r,
          s,
        });

      // forward beyond 2nd week
      const genesis = await contracts.bribePot.genesis();
      const timeNeededToReachWeek1 = genesis
        .add(TIME_IN_SECS.week)
        .sub(await getTimestamp());
      // move beyond week2
      await fastForward(
        timeNeededToReachWeek1.add(TIME_IN_SECS.week).toNumber()
      );
      await mine();
    });
    it("should collect rewards from bribe pot", async function () {
      // unstake to see if rewards has been collected
      const depositsBefore = await contracts.gvToken.getUserDeposits(
        userAddress
      );
      await contracts.gvToken
        .connect(signers.user)
        .unStake(stkPercent, RCA_VAULT);
      const depositsAfter = await contracts.gvToken.getUserDeposits(
        userAddress
      );
      expect(depositsAfter.length - depositsBefore.length).to.equal(1);
      // total deposited from pot
      const rewardAmount = depositsAfter[depositsAfter.length - 1].amount;

      // reward amount for a week of bribe would be more than 3 as user
      // share in bribePot is around 33% and bribe per week is 10EASE
      const expectedRewardAmount = parseEther("3.33");
      expect(rewardAmount).to.gte(expectedRewardAmount);
    });
    it("should emit UnStake event", async function () {
      // call unstake to emit
      expect(
        await contracts.gvToken
          .connect(signers.user)
          .unStake(stkPercent, RCA_VAULT)
      )
        .to.emit(contracts.gvToken, "UnStake")
        .withArgs(userAddress, RCA_VAULT, stkPercent);
    });
    it("should revert if user is trying to withdraw from inactive vault", async function () {
      // call unstake to a different vault
      const inactiveVault = signers.user.address;
      await expect(
        contracts.gvToken
          .connect(signers.user)
          .unStake(stkPercent, inactiveVault)
      ).to.reverted;
    });
  });
  describe("withdrawRequest()", function () {
    this.beforeEach(async function () {
      const value = parseEther("100");
      // deposit bob
      await depositFor(signers.bob, value);

      // deposit user
      await depositFor(signers.user, value);

      // deposit to pot
      // add 50 gvEase from user to bribe pot
      await contracts.gvToken
        .connect(signers.user)
        .depositToPot(value.mul(5).div(10));
      // add 100 gvEase from bob to bribe pot
      await contracts.gvToken.connect(signers.bob).depositToPot(value);
      await bribeFor(signers.briber, parseEther("10"));

      // forward beyond 2nd week
      const genesis = await contracts.bribePot.genesis();
      const timeNeededToReachWeek1 = genesis
        .add(TIME_IN_SECS.week)
        .sub(await getTimestamp());
      // move beyond week2
      await fastForward(
        timeNeededToReachWeek1.add(TIME_IN_SECS.week).toNumber()
      );
      await mine();
    });
    it("should withdraw from pot if withdraw includes pot", async function () {
      const amount = parseEther("10");
      await contracts.gvToken.connect(signers.bob).claimAndDepositReward();
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(amount, true);

      const withdrawRequest = await contracts.gvToken.withdrawRequests(
        userAddress
      );
      const expectedRewardAmount = parseEther("3.33");
      expect(withdrawRequest.rewards).to.gte(expectedRewardAmount);
    });
    it("should emit RedeemRequest event", async function () {
      // check for emit
      const amount = parseEther("10");
      // 14 days delay
      const endTime = (await getTimestamp()).add(TIME_IN_SECS.week * 2).add(1);
      await expect(
        contracts.gvToken.connect(signers.user).withdrawRequest(amount, true)
      )
        .to.emit(contracts.gvToken, "RedeemRequest")
        .withArgs(userAddress, amount, endTime);
    });
    it("should add rewards to current withdraw request", async function () {
      // do something
      const amount = parseEther("10");
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(amount, true);
      const withdrawRequest = await contracts.gvToken.withdrawRequests(
        userAddress
      );
      const expectedReward = parseEther("3.33");
      expect(withdrawRequest.rewards).to.gt(expectedReward);
    });
  });
  describe("withdrawFinalize()", function () {
    this.beforeEach(async function () {
      const value = parseEther("100");
      // deposit bob
      await depositFor(signers.bob, value);

      // deposit user
      await depositFor(signers.user, value);

      // deposit to pot
      // add 50 gvEase from user to bribe pot
      await contracts.gvToken
        .connect(signers.user)
        .depositToPot(value.mul(5).div(10));
      // add 100 gvEase from bob to bribe pot
      await contracts.gvToken.connect(signers.bob).depositToPot(value);
      await bribeFor(signers.briber, parseEther("10"));

      // forward beyond 2nd week
      const genesis = await contracts.bribePot.genesis();
      const timeNeededToReachWeek1 = genesis
        .add(TIME_IN_SECS.week)
        .sub(await getTimestamp());
      // move beyond week2
      await fastForward(
        timeNeededToReachWeek1.add(TIME_IN_SECS.week).toNumber()
      );
      await mine();
    });
    it("should not allow user to finalize withraw before delay", async function () {
      // do something
      const amount = parseEther("10");
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(amount, true);
      await expect(
        contracts.gvToken.connect(signers.user).withdrawFinalize()
      ).to.revertedWith("withdrawal not yet allowed");
    });
    it("should allow user to finalize withdarw after delay", async function () {
      const amount = parseEther("10");
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(amount, true);
      // forward time beyond delay
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();

      const userEaseBalBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.gvToken.connect(signers.user).withdrawFinalize();
      const userEaseBalAfter = await contracts.ease.balanceOf(userAddress);

      const expectedReward = parseEther("3.33");

      expect(userEaseBalAfter.sub(userEaseBalBefore)).to.gt(
        amount.add(expectedReward)
      );
    });
    it("should emit RedeemFinalize event with valid args", async function () {
      const amount = parseEther("10");
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(amount, true);
      // forward time beyond delay
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();

      await expect(contracts.gvToken.connect(signers.user).withdrawFinalize())
        .to.emit(contracts.gvToken, "RedeemFinalize")
        .withArgs(userAddress, amount);
    });
  });
  describe("delegate()", function () {
    it("should delegate and update checkpoint", async function () {
      const amount = parseEther("100");
      await depositFor(signers.bob, amount);

      // deposit again
      await depositFor(signers.bob, amount);

      // forward time
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();
      // move delegates
      await contracts.gvToken.connect(signers.bob).delegate(bobAddress);
      let bobBalance = await contracts.gvToken.balanceOf(bobAddress);

      let numCheckpoints = await contracts.gvToken.numCheckpoints(bobAddress);

      // bob last checkpoint
      let lastBobCheckPoint = await contracts.gvToken.checkpoints(
        bobAddress,
        numCheckpoints - 1
      );
      // bob current vote should be equal to delegated votes
      expect(lastBobCheckPoint.votes).to.equal(bobBalance);

      // move forward
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();

      // call delegate to self again
      await contracts.gvToken.connect(signers.bob).delegate(bobAddress);

      // update variables
      bobBalance = await contracts.gvToken.balanceOf(bobAddress);
      numCheckpoints = await contracts.gvToken.numCheckpoints(bobAddress);
      // bob last checkpoint
      lastBobCheckPoint = await contracts.gvToken.checkpoints(
        bobAddress,
        numCheckpoints - 1
      );

      // move forward
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();

      // call delegate to alice
      await contracts.gvToken.connect(signers.bob).delegate(aliceAddress);

      // update variables
      bobBalance = await contracts.gvToken.balanceOf(bobAddress);
      numCheckpoints = await contracts.gvToken.numCheckpoints(bobAddress);
      // bob last checkpoint
      lastBobCheckPoint = await contracts.gvToken.checkpoints(
        bobAddress,
        numCheckpoints - 1
      );
      // bob's checkpoint votes should be 0
      expect(lastBobCheckPoint.votes).to.equal(0);
      // alice numCheckpoint
      const aliceNumCheckpoints = await contracts.gvToken.numCheckpoints(
        aliceAddress
      );
      // alice last checkpoint
      const lastAliceCheckpoint = await contracts.gvToken.checkpoints(
        aliceAddress,
        aliceNumCheckpoints - 1
      );

      // alice's checkpoint votes should be bob's balance
      expect(lastAliceCheckpoint.votes).to.equal(bobBalance);
      // bob's delegated should be equal ot bob's balance

      const bobDelegated = await contracts.gvToken.delegated(bobAddress);
      // delegated should update upto balance on latest delegate call

      expect(bobDelegated).to.equal(bobBalance);
    });
  });
});
