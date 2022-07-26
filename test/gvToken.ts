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
const MAX_PERCENT = 100_000;

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

  async function bribeFor(
    briber: SignerWithAddress,
    bribePerWeek: BigNumber,
    numOfWeeks: number
  ) {
    // add bribe to bribe pot
    const rcaVaultAddress = RCA_VAULT;
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
    it("should not allow to deposit 0EASE", async function () {
      await expect(depositFor(signers.user, parseEther("0"))).to.revertedWith(
        "cannot deposit 0!"
      );
    });
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
      const withdrawAmt1 = parseEther("400");
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(withdrawAmt1);

      let withdrawRequest = await contracts.gvToken.withdrawRequests(
        userAddress
      );

      expect(withdrawRequest.amount).to.equal(withdrawAmt1);

      let currentDepositCount = (
        await contracts.gvToken.getUserDeposits(userAddress)
      ).length;
      // current deposit count should be 10 because we are withdrawing 400EASE
      // which means 40 deposits of 10EASE each will be poped off on withdraw
      // request
      expect(currentDepositCount).to.equal(10);

      // call withdraw request 2nd time
      const withdrawAmt2 = parseEther("3");
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(withdrawAmt2);

      currentDepositCount = (
        await contracts.gvToken.getUserDeposits(userAddress)
      ).length;

      withdrawRequest = await contracts.gvToken.withdrawRequests(userAddress);

      expect(withdrawRequest.amount).to.equal(withdrawAmt1.add(withdrawAmt2));

      await fastForward(TIME_IN_SECS.month);
      const balanceBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.gvToken.connect(signers.user).withdrawFinalize();
      const balanceAfter = await contracts.ease.balanceOf(userAddress);
      expect(balanceAfter.sub(balanceBefore)).to.equal(
        withdrawAmt1.add(withdrawAmt2)
      );
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
        contracts.gvToken.connect(signers.user).stake(stkPercent, inactiveVault)
      ).to.revertedWith("vault not active");
    });
  });
  describe("unstake()", function () {
    const stkPercent = BigNumber.from(10000);
    const value = parseEther("100");
    const userBribedAmt = value.mul(5).div(10);
    beforeEach(async function () {
      // deposit
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
      await contracts.gvToken.connect(signers.user).depositToPot(userBribedAmt);
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
    describe("powerStaked()", function () {
      it("should update the powerStaked of a user", async function () {
        const powerStakedBefore = await contracts.gvToken.powerStaked(
          userAddress,
          RCA_VAULT
        );

        await contracts.gvToken
          .connect(signers.user)
          .unStake(stkPercent, RCA_VAULT);
        const powerStakedAfter = await contracts.gvToken.powerStaked(
          userAddress,
          RCA_VAULT
        );
        // this sould come out as 5gvEASE
        const expectedPowerStakedIncrease = stkPercent
          .mul(value.sub(userBribedAmt))
          .div(MAX_PERCENT);

        // as we have bribed 50gvEase of a user to bribePot and we have
        // forwarded time by a week, user's actual gvEASE balance at this
        // time is slightly more than 101 gvEASE. So staking 10% to some RCA_VAULT
        // here means staking 10% of (101 - 50)gvEASE which equals to 5.1 gvEASE
        // so we are expecting stakedPower difference to be more than 5gvEASe
        expect(powerStakedBefore.sub(powerStakedAfter)).to.gt(
          expectedPowerStakedIncrease
        );

        // as we are unstaking everything form the vault powerStakedAfter should
        // be zero
        expect(powerStakedAfter).to.equal(0);
      });
    });
    describe("powerAvailableForStake()", function () {
      it("should return correct power available for stake", async function () {
        const userBalance = await contracts.gvToken.balanceOf(userAddress);
        const stakedToRcaVault = await contracts.gvToken.powerStaked(
          userAddress,
          RCA_VAULT
        );
        const expectedPowerAvailableForStake = userBalance
          .sub(userBribedAmt)
          .sub(stakedToRcaVault);
        const powerAvailableForStake =
          await contracts.gvToken.powerAvailableForStake(userAddress);

        expect(powerAvailableForStake).to.equal(expectedPowerAvailableForStake);
      });
    });
  });
  describe("withdrawRequest()", function () {
    const userBribeAmount = parseEther("50");
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
        .depositToPot(userBribeAmount);
      // add 100 gvEase from bob to bribe pot
      await contracts.gvToken.connect(signers.bob).depositToPot(value);
      await bribeFor(signers.briber, parseEther("10"), 2);

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
    it("should withdraw from pot if withdraw amount is > available gvEASE", async function () {
      const amount = parseEther("60");

      const bribedAmtBefore = await contracts.gvToken.bribedAmount(userAddress);
      await contracts.gvToken.connect(signers.user).withdrawRequest(amount);
      const bribedAmtAfter = await contracts.gvToken.bribedAmount(userAddress);
      // as user has bribed 50gvEASE and user's gvEASE balance by this
      // time is slightly more than 101 gvEASE if we withdraw 60 gvEASE
      // we need to withdraw slightly more than 9gvEASE from bribed amount of the user
      const expectedReductionInBribeAmt = parseEther("9");
      expect(bribedAmtBefore.sub(bribedAmtAfter)).to.gt(
        expectedReductionInBribeAmt
      );
    });
    it("should emit RedeemRequest event", async function () {
      // check for emit
      const amount = parseEther("10");
      // 14 days delay
      const endTime = (await getTimestamp()).add(TIME_IN_SECS.week * 2).add(1);
      await expect(
        contracts.gvToken.connect(signers.user).withdrawRequest(amount)
      )
        .to.emit(contracts.gvToken, "RedeemRequest")
        .withArgs(userAddress, amount, endTime);
    });
    it("should update withdraw request of user on multiple requests", async function () {
      const firstWithdrawAmt = parseEther("60");
      // first withdraw request
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(firstWithdrawAmt);
      let withdrawRequest = await contracts.gvToken.withdrawRequests(
        userAddress
      );
      // delay until
      const firstEndTime = (await getTimestamp()).add(TIME_IN_SECS.week * 2);
      expect(withdrawRequest.amount).to.equal(firstWithdrawAmt);
      expect(withdrawRequest.endTime).to.equal(firstEndTime);
      // move forward
      await fastForward(TIME_IN_SECS.week);
      await mine();

      // 2nd withdraw request
      const secondWithdrawAmt = parseEther("10");
      const secondEndTime = (await getTimestamp()).add(TIME_IN_SECS.week * 2);

      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(secondWithdrawAmt);

      withdrawRequest = await contracts.gvToken.withdrawRequests(userAddress);

      expect(withdrawRequest.amount).to.equal(
        firstWithdrawAmt.add(secondWithdrawAmt)
      );
      expect(withdrawRequest.endTime).to.gte(secondEndTime);
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
      await bribeFor(signers.briber, parseEther("10"), 2);

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
      await contracts.gvToken.connect(signers.user).withdrawRequest(amount);
      await expect(
        contracts.gvToken.connect(signers.user).withdrawFinalize()
      ).to.revertedWith("withdrawal not yet allowed");
    });
    it("should allow user to finalize withdarw after delay", async function () {
      const withdrawAmount = parseEther("10");
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(withdrawAmount);
      // forward time beyond delay
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();

      const userEaseBalBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.gvToken.connect(signers.user).withdrawFinalize();
      const userEaseBalAfter = await contracts.ease.balanceOf(userAddress);

      expect(userEaseBalAfter.sub(userEaseBalBefore)).to.equal(withdrawAmount);
    });
    it("should emit RedeemFinalize event with valid args", async function () {
      const amount = parseEther("10");
      await contracts.gvToken.connect(signers.user).withdrawRequest(amount);
      // forward time beyond delay
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();

      await expect(contracts.gvToken.connect(signers.user).withdrawFinalize())
        .to.emit(contracts.gvToken, "RedeemFinalize")
        .withArgs(userAddress, amount);
    });
  });
  describe("claimReward()", function () {
    const depositAmt = parseEther("100");
    const bribePerWeek = parseEther("5");
    beforeEach(async function () {
      // deposit for user
      await depositFor(signers.user, depositAmt);

      await contracts.gvToken
        .connect(signers.user)
        .depositToPot(depositAmt.div(2));

      // bribe from vPot
      const numOfWeeks = 4;
      await bribeFor(signers.briber, bribePerWeek, numOfWeeks);

      await fastForward(TIME_IN_SECS.week * 2);
      await mine();
    });
    it("should transfer reward amount to the user's wallet", async function () {
      const userBalanceBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.gvToken.connect(signers.user).claimReward();
      const userBalanceAfter = await contracts.ease.balanceOf(userAddress);
      // as we are fast forward into week 2 rewards earned by user through
      // bribe has been active for > 1 weeks and < 2 weeks. That means if
      // user is the only briber he should get reward more than 5EASE but
      // less than 10EASE
      expect(userBalanceAfter.sub(userBalanceBefore)).to.gt(parseEther("5"));
      expect(userBalanceAfter.sub(userBalanceBefore)).to.lt(parseEther("10"));
    });
  });
  describe("claimAndDepositReward()", function () {
    beforeEach(async function () {
      // deposit for user
      const depositAmt = parseEther("100");
      await depositFor(signers.user, depositAmt);

      await contracts.gvToken
        .connect(signers.user)
        .depositToPot(depositAmt.div(2));

      // bribe from vPot
      const bribePerWeek = parseEther("5");
      const numOfWeeks = 4;
      await bribeFor(signers.briber, bribePerWeek, numOfWeeks);

      await fastForward(TIME_IN_SECS.week * 2);
      await mine();
    });
    it("should claim reward and deposit for gvEASE", async function () {
      const gvTokenEaseBalBefore = await contracts.ease.balanceOf(
        contracts.gvToken.address
      );
      const depositsBefore = await contracts.gvToken.getUserDeposits(
        userAddress
      );
      const balanceBefore = await contracts.gvToken.balanceOf(userAddress);
      await contracts.gvToken.connect(signers.user).claimAndDepositReward();

      const gvTokenEaseBalAfter = await contracts.ease.balanceOf(
        contracts.gvToken.address
      );
      const depositsAfter = await contracts.gvToken.getUserDeposits(
        userAddress
      );
      const balanceAfter = await contracts.gvToken.balanceOf(userAddress);

      // With bribe rate being @5EASE/week and we are at week 2 reward
      // collected by user should be more than 5EASE but less than 10EASE
      expect(gvTokenEaseBalAfter.sub(gvTokenEaseBalBefore)).to.gt(
        parseEther("5")
      );
      expect(gvTokenEaseBalAfter.sub(gvTokenEaseBalBefore)).to.lt(
        parseEther("10")
      );
      // should add reward EASE amount to deposits array of the user
      expect(depositsAfter.length - depositsBefore.length).to.equal(1);

      // as current time is between 2nd week and third week reward amount should
      // be greater than bribe per week (i.e 5EASE/week)
      expect(balanceAfter.sub(balanceBefore)).to.gt(parseEther("5"));
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
