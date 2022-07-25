import { expect } from "chai";
import { BigNumber } from "ethers";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { EaseToken__factory } from "../src/types";
import { BribePot__factory } from "../src/types/factories/contracts/core/BribePot__factory";
import { RCA_CONTROLLER, RCA_VAULT } from "./constants";
import { bribeFor, getPermitSignature } from "./helpers";
import { Contracts, Signers } from "./types";
import { getTimestamp, fastForward, mine, TIME_IN_SECS } from "./utils";

describe("BribePot", function () {
  const contracts = {} as Contracts;
  const signers = {} as Signers;
  let bobAddress: string;
  let aliceAddress: string;
  let briberAddress: string;
  before(async function () {
    const accounts = await ethers.getSigners();
    signers.gvToken = accounts[0];
    signers.gov = accounts[1];
    signers.briber = accounts[2];
    signers.alice = accounts[3];
    signers.bob = accounts[4];
    signers.otherAccounts = accounts.slice(5);

    // update addresses
    bobAddress = signers.bob.address;
    aliceAddress = signers.alice.address;
    briberAddress = signers.briber.address;
  });

  beforeEach(async function () {
    const EaseTokenFactory = <EaseToken__factory>(
      await ethers.getContractFactory("EaseToken")
    );

    const BribePotFactory = <BribePot__factory>(
      await ethers.getContractFactory("BribePot")
    );

    const nonce = await signers.gvToken.getTransactionCount();
    const easeAddress = getContractAddress({
      from: signers.gvToken.address,
      nonce,
    });

    contracts.ease = await EaseTokenFactory.deploy(signers.gvToken.address);

    contracts.bribePot = await BribePotFactory.deploy(
      signers.gvToken.address,
      easeAddress,
      RCA_CONTROLLER
    );
    // fund user accounts with EASE token
    await contracts.ease
      .connect(signers.gvToken)
      .mint(bobAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.gvToken)
      .mint(aliceAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.gvToken)
      .mint(signers.gvToken.address, parseEther("1000000"));
    await contracts.ease
      .connect(signers.gvToken)
      .mint(briberAddress, parseEther("1000000"));
  });

  describe("restricted", function () {
    it("should restrict address other than gvToken", async function () {
      await expect(
        contracts.bribePot
          .connect(signers.bob)
          .deposit(aliceAddress, parseEther("100"))
      ).to.revertedWith("only gvToken");
      await expect(
        contracts.bribePot
          .connect(signers.bob)
          .withdraw(aliceAddress, parseEther("100"))
      ).to.revertedWith("only gvToken");
      await expect(
        contracts.bribePot.connect(signers.bob).getReward(aliceAddress, false)
      ).to.revertedWith("only gvToken");
    });
  });

  describe("deposit()", function () {
    it("should allow gvToken to deposit on users behalf", async function () {
      // Deposit funds on behalf of the user
      const gvAmount = parseEther("100");
      //   deposit on behalf of bob
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(bobAddress, gvAmount);

      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);

      // check alice balance
      expect(await contracts.bribePot.balanceOf(aliceAddress)).to.equal(
        gvAmount
      );
      // check bob balance
      expect(await contracts.bribePot.balanceOf(bobAddress)).to.equal(gvAmount);

      //   check totalsupply
      expect(await contracts.bribePot.totalSupply()).to.equal(gvAmount.mul(2));
    });
    it("should collect reward on multiple deposit", async function () {
      // deposit
      // Deposit funds on behalf of the user
      const gvAmount = parseEther("100");
      //   deposit on behalf of bob
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(bobAddress, gvAmount);

      // add bribe
      const bribePerWeek = parseEther("10");
      const rcaVaultAddress = RCA_VAULT;
      const numOfWeeks = 4;
      // get signature
      const value = bribePerWeek.mul(numOfWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });

      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
          deadline,
          v,
          r,
          s,
        });

      await fastForward(TIME_IN_SECS.week * 2);
      await mine();

      // deposit again
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(bobAddress, gvAmount);

      const rewardPerToken = await contracts.bribePot.rewardPerToken();
      expect(rewardPerToken).to.gte(parseEther("0.1"));

      // fast forward 4 days
      await fastForward(TIME_IN_SECS.day * 4);
      await mine();
      const earned = await contracts.bribePot.earned(bobAddress);
      // should be greater than 15EASE as rate @10 Ease per week
      // and wee are end of week 2
      expect(earned).to.gt(parseEther("15"));

      await fastForward(TIME_IN_SECS.week * 4);
      await mine();

      // deposit again
      const balanceBefore = await contracts.ease.balanceOf(
        signers.gvToken.address
      );

      await contracts.bribePot
        .connect(signers.gvToken)
        .getReward(bobAddress, false);
      const balanceAfter = await contracts.ease.balanceOf(
        signers.gvToken.address
      );
      // rounding issue 40 ease becomes 39.999
      expect(balanceAfter.sub(balanceBefore)).to.gte(parseEther("39.999"));
    });
  });
  describe("bribe()", function () {
    it("should fail if total supply of venal pot is 0", async function () {
      // try to bribe without depositing
      const bribePerWeek = parseEther("10");
      const numOfWeeks = 4;
      // get signature
      const value = bribePerWeek.mul(numOfWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });

      await expect(
        contracts.bribePot.bribe(bribePerWeek, RCA_VAULT, numOfWeeks, {
          deadline,
          v,
          r,
          s,
        })
      ).to.revertedWith("nothing to bribe");
    });
    it("should allow user to bribe the % of pot", async function () {
      // call deposit
      const gvAmount = parseEther("100");
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);
      // call bribe
      const bribePerWeek = parseEther("10");
      const bribePeriodInWeeks = 4;
      // get signature
      const value = bribePerWeek.mul(bribePeriodInWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, RCA_VAULT, bribePeriodInWeeks, {
          deadline,
          v,
          r,
          s,
        });
      expect(await contracts.ease.balanceOf(spender)).to.equal(value);
      // check week start
      const bribeDetail = await contracts.bribePot.bribes(
        briberAddress,
        RCA_VAULT
      );
      const expectedStartWeek = 1;
      const expectedEndWeek = expectedStartWeek + bribePeriodInWeeks;

      expect(bribeDetail.startWeek).to.equal(expectedStartWeek);
      expect(bribeDetail.endWeek).to.equal(expectedEndWeek);
    });
    it("should not allow user to have multiple bribe for same vault", async function () {
      // call deposit
      const gvAmount = parseEther("100");
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);
      // call bribe
      const bribePerWeek = parseEther("10");
      const numOfWeeks = 4;
      // get signature
      const value = bribePerWeek.mul(numOfWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, RCA_VAULT, numOfWeeks, {
          deadline,
          v,
          r,
          s,
        });
      await expect(
        contracts.bribePot
          .connect(signers.briber)
          .bribe(bribePerWeek, RCA_VAULT, numOfWeeks, {
            deadline,
            v,
            r,
            s,
          })
      ).to.revertedWith("bribe already exists");
    });
    it("should update period finish on new bribe", async function () {
      //
      // call deposit
      const gvAmount = parseEther("100");
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(bobAddress, gvAmount);
      // call bribe
      const bribePerWeek = parseEther("10");
      const numOfWeeks = 4;
      const genesis = await contracts.bribePot.genesis();
      const periodFinishBefore = await contracts.bribePot.periodFinish();
      expect(genesis).to.equal(periodFinishBefore);
      await bribeFor(
        signers.bob,
        bribePerWeek,
        contracts.bribePot,
        contracts.ease,
        numOfWeeks
      );
      // as bribe is active for 4 weeks and we round genesis to floor of the current week
      // expected time finish becomes 5 weeks from genesis
      const expectedTimeFinish = genesis.add(
        BigNumber.from(TIME_IN_SECS.week).mul(numOfWeeks + 1)
      );
      const periodFinishAfter = await contracts.bribePot.periodFinish();
      expect(periodFinishAfter).to.equal(expectedTimeFinish);
    });
  });
  describe("cancelBribe()", function () {
    it("should allow briber to cancel bribe and recieve remaining EASE", async function () {
      // call deposit
      const gvAmount = parseEther("100");
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);
      // call bribe
      const bribePerWeek = parseEther("10");
      const rcaVaultAddress = RCA_VAULT;
      const numOfWeeks = 4;
      await bribeFor(
        signers.briber,
        bribePerWeek,
        contracts.bribePot,
        contracts.ease,
        numOfWeeks
      );
      // deducting 100 secs because tests running in succession may take few seconds
      await fastForward(TIME_IN_SECS.week - 100);
      await mine();
      const userEaseBalBefore = await contracts.ease.balanceOf(briberAddress);
      await contracts.bribePot
        .connect(signers.briber)
        .cancelBribe(rcaVaultAddress);
      const userEaseBalAfter = await contracts.ease.balanceOf(briberAddress);
      expect(userEaseBalAfter.sub(userEaseBalBefore)).to.equal(
        bribePerWeek.mul(3)
      );
    });
    it("should update period finish correctly", async function () {
      // call deposit
      const gvAmount = parseEther("100");
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);

      await bribeFor(
        signers.bob,
        parseEther("10"),
        contracts.bribePot,
        contracts.ease,
        4
      );
      await bribeFor(
        signers.briber,
        parseEther("20"),
        contracts.bribePot,
        contracts.ease,
        10
      );

      let periodFinish = await contracts.bribePot.periodFinish();
      let expectedPeriodFinish = (await contracts.bribePot.genesis()).add(
        TIME_IN_SECS.week * 11
      );
      expect(periodFinish).to.equal(expectedPeriodFinish);
      // Move 3 weeks forward
      await fastForward(TIME_IN_SECS.week * 3);
      await mine();

      // cancle bribe
      await contracts.bribePot.connect(signers.briber).cancelBribe(RCA_VAULT);

      periodFinish = await contracts.bribePot.periodFinish();
      // as signer bob is bribing for 4 week period
      expectedPeriodFinish = (await contracts.bribePot.genesis()).add(
        TIME_IN_SECS.week * 5
      );
      expect(periodFinish).to.equal(expectedPeriodFinish);
    });
  });

  describe("withdraw()", function () {
    it("should allow user to withdraw gvPower and recieve rewards owed", async function () {
      // deposit, add bribe, and withdraw after some time
      // call deposit
      const gvAmount = parseEther("100");
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);
      // call bribe
      const bribePerWeek = parseEther("0.5");
      const rcaVaultAddress = RCA_VAULT;
      const numOfWeeks = 2;
      // get signature
      const value = bribePerWeek.mul(numOfWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
          deadline,
          v,
          r,
          s,
        });
      await fastForward(TIME_IN_SECS.month);
      const balanceBefore = await contracts.ease.balanceOf(
        signers.gvToken.address
      );
      await contracts.bribePot
        .connect(signers.gvToken)
        .withdraw(aliceAddress, gvAmount);

      await contracts.bribePot
        .connect(signers.gvToken)
        .getReward(aliceAddress, false);

      const balanceAfter = await contracts.ease.balanceOf(
        signers.gvToken.address
      );
      expect(balanceAfter.sub(balanceBefore)).to.gte(parseEther("0.499999999"));
    });
  });
  describe("earned()", function () {
    it("should calculate correct earned amount of users at different time", async function () {
      // get valid earned amount      // deposit token
      const gvAmount = parseEther("100");
      //   deposit on behalf of bob
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(bobAddress, gvAmount);

      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);
      // bribe from pot
      const bribePerWeek = parseEther("10");
      const rcaVaultAddress = RCA_VAULT;
      const bribePeriodInWeeks = 2;
      // get signature
      const value = bribePerWeek.mul(bribePeriodInWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });

      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, rcaVaultAddress, bribePeriodInWeeks, {
          deadline,
          v,
          r,
          s,
        });

      const genesis = await contracts.bribePot.genesis();
      // timestamp at which week one starts
      const timestampWeek1 = genesis.add(TIME_IN_SECS.week + 1);

      const timeNeededToReachWeek1 = timestampWeek1.sub(await getTimestamp());
      await fastForward(
        timeNeededToReachWeek1.add(TIME_IN_SECS.week * 2).toNumber()
      );
      await mine();

      const aliceEarned = await contracts.bribePot.earned(aliceAddress);
      const bobEarned = await contracts.bribePot.earned(bobAddress);
      // as alice and bob share 50% each of the bribe pot
      // their rewards collected should be equal
      expect(aliceEarned).to.equal(bobEarned);
    });
  });
  describe("rewardPerToken()", function () {
    beforeEach(async function () {
      const amount = parseEther("1000");

      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(bobAddress, amount);

      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, amount.div(2));

      // call bribe
      const bribePerWeek = parseEther("15");
      const rcaVaultAddress = RCA_VAULT;
      const bribePeriodInWeeks = 4;

      // get signature
      const value = bribePerWeek.mul(bribePeriodInWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, rcaVaultAddress, bribePeriodInWeeks, {
          deadline,
          v,
          r,
          s,
        });
    });
    it("should return correct amount of reward per token at different time", async function () {
      // deposit east tokens
      const bribeDetail = await contracts.bribePot.bribes(
        briberAddress,
        RCA_VAULT
      );

      const genesis = await contracts.bribePot.genesis();
      const bribeStartsIn = genesis
        .add(bribeDetail.startWeek * TIME_IN_SECS.week)
        .sub(await getTimestamp());
      // move time forward upto 2nd Week
      await fastForward(bribeStartsIn.toNumber() + TIME_IN_SECS.week);
      await mine();
      // update bribes
      // check for current bribe
      let rewardPerToken = await contracts.bribePot.rewardPerToken();
      expect(rewardPerToken).to.gte(parseEther("0.01"));

      // move from week2 =>  Day 4 of week2
      await fastForward(TIME_IN_SECS.day * 4);
      await mine();

      rewardPerToken = await contracts.bribePot.rewardPerToken();
      expect(rewardPerToken).to.gte(parseEther("0.015"));

      // move from day4 of week2 =>  Week 4
      await fastForward(TIME_IN_SECS.day * 3 + TIME_IN_SECS.week);
      await mine();

      rewardPerToken = await contracts.bribePot.rewardPerToken();
      expect(rewardPerToken).to.gte(parseEther("0.03"));

      // move from week4 =>  Week 5
      await fastForward(TIME_IN_SECS.day * 3 + TIME_IN_SECS.week);
      await mine();

      rewardPerToken = await contracts.bribePot.rewardPerToken();
      // reward per token should never go beyond 0.04
      expect(rewardPerToken).to.equal(parseEther("0.04"));
      const rewardPerTokenAtWeek5 = rewardPerToken;

      // move from week5 =>  Week6
      await fastForward(TIME_IN_SECS.week);
      await mine();
      const rewardPerTokenAtWeek6 = await contracts.bribePot.rewardPerToken();

      expect(rewardPerTokenAtWeek6.sub(rewardPerTokenAtWeek5)).to.equal(0);
    });
    it("should calculate rewardPerToken correctly on new bribe after gap", async function () {
      // move to week8
      await fastForward(TIME_IN_SECS.week * 8);
      await mine();
      let rewardPerToken = await contracts.bribePot.rewardPerToken();
      expect(rewardPerToken).to.equal(parseEther("0.04"));

      // add new bribe
      const bribePerWeek = parseEther("30");
      const rcaVaultAddress = RCA_VAULT;
      const bribePeriodInWeeks = 1;

      // get signature
      const value = bribePerWeek.mul(bribePeriodInWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, rcaVaultAddress, bribePeriodInWeeks, {
          deadline,
          v,
          r,
          s,
        });
      rewardPerToken = await contracts.bribePot.rewardPerToken();
      expect(rewardPerToken).to.equal(parseEther("0.04"));

      await fastForward(TIME_IN_SECS.week * 2);
      await mine();

      rewardPerToken = await contracts.bribePot.rewardPerToken();
      // new bribe should be expired by now
      // and additional "0.02" EASE per token should be added
      // to reward pre token as bribe was 30EASE/ week for 1 week
      expect(rewardPerToken).to.equal(parseEther("0.06"));
    });
  });
  describe("getRewards()", function () {
    beforeEach(async function () {
      const amount = parseEther("1000");

      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(bobAddress, amount);

      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, amount.div(2));

      // call bribe
      const bribePerWeek = parseEther("15");
      const rcaVaultAddress = RCA_VAULT;
      const bribePeriodInWeeks = 4;

      // get signature
      const value = bribePerWeek.mul(bribePeriodInWeeks);
      const spender = contracts.bribePot.address;
      const deadline = (await getTimestamp()).add(1000);
      const { v, r, s } = await getPermitSignature({
        signer: signers.briber,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, rcaVaultAddress, bribePeriodInWeeks, {
          deadline,
          v,
          r,
          s,
        });
      // forward upto bribe start week
      const genesis = await contracts.bribePot.genesis();
      // time to forward to reach week 1
      const timeToForward = genesis
        .add(TIME_IN_SECS.week)
        .sub(await getTimestamp());

      // forward upto week1
      await fastForward(timeToForward.toNumber());
      await mine();
    });
    it("should update the bribe pot state", async function () {
      // fast forward 2nd day of week2
      await fastForward(TIME_IN_SECS.week + TIME_IN_SECS.day);
      await mine();
      // check earned
      const earned = await contracts.bribePot.earned(bobAddress);
      expect(earned).to.gte(parseEther("11"));

      // call get reward function
      await contracts.bribePot.getReward(bobAddress, false);

      // check last reward update should be equal to timestamp
      const lastRewardUpdate = await contracts.bribePot.lastRewardUpdate();
      expect(lastRewardUpdate).to.equal(await getTimestamp());

      // check last bribe update to week 2
      const lastBribeUpdate = await contracts.bribePot.lastBribeUpdate();
      expect(lastBribeUpdate).to.equal(2);

      // check reward per token stored to be more than "0.01"
      const rewardPerTokenStored =
        await contracts.bribePot.rewardPerTokenStored();
      expect(rewardPerTokenStored).to.gte(parseEther("0.01"));

      // check reward per token paid of bob
      const rewardPerTokenPaid =
        await contracts.bribePot.userRewardPerTokenPaid(bobAddress);
      expect(rewardPerTokenStored).to.equal(rewardPerTokenPaid);

      // check rewards to claim for bob
      const bobRewardsToClaim = await contracts.bribePot.rewards(bobAddress);
      expect(bobRewardsToClaim).to.equal(0);
    });

    it("should collect rewards to gvToken address", async function () {
      // fast forward 2nd day of week2
      await fastForward(TIME_IN_SECS.week + TIME_IN_SECS.day * 2);
      await mine();

      const gvTokenEaseBalanceBefore = await contracts.ease.balanceOf(
        signers.gvToken.address
      );

      // call get reward function
      await contracts.bribePot.getReward(bobAddress, false);
      const gvTokenEaseBalanceAfter = await contracts.ease.balanceOf(
        signers.gvToken.address
      );
      expect(gvTokenEaseBalanceAfter.sub(gvTokenEaseBalanceBefore)).to.gte(
        parseEther("11")
      );
    });

    it("should collect rewards to the user address", async function () {
      // fast forward 2nd day of week2
      await fastForward(TIME_IN_SECS.week + TIME_IN_SECS.day * 2);
      await mine();

      const bobEaseBalBefore = await contracts.ease.balanceOf(bobAddress);

      // call get reward function
      await contracts.bribePot.getReward(bobAddress, true);
      const bobEaseBalAfter = await contracts.ease.balanceOf(bobAddress);
      expect(bobEaseBalAfter.sub(bobEaseBalBefore)).to.gte(parseEther("11"));
    });
  });
});
