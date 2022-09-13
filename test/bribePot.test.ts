import { expect } from "chai";
import { BigNumber } from "ethers";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

import {
  BribePot,
  EaseToken__factory,
  ERC1967Proxy__factory,
} from "../src/types";
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
    signers.deployer = accounts[5];
    signers.otherAccounts = accounts.slice(5);

    // update addresses
    bobAddress = signers.bob.address;
    aliceAddress = signers.alice.address;
    briberAddress = signers.briber.address;
  });

  beforeEach(async function () {
    const EaseTokenFactory = <EaseToken__factory>(
      await ethers.getContractFactory("EaseToken", signers.deployer)
    );

    const BribePotFactory = <BribePot__factory>(
      await ethers.getContractFactory("BribePot", signers.deployer)
    );
    const ERC1977ProxyFactory = <ERC1967Proxy__factory>(
      await ethers.getContractFactory("ERC1967Proxy", signers.deployer)
    );

    const nonce = await signers.deployer.getTransactionCount();
    const easeAddress = getContractAddress({
      from: signers.deployer.address,
      nonce,
    });

    contracts.ease = await EaseTokenFactory.deploy(signers.gov.address);

    // Validate BribePot Implementation for upgradability
    await upgrades.validateImplementation(BribePotFactory);

    contracts.bribePot = await BribePotFactory.deploy();

    const callData = contracts.bribePot.interface.encodeFunctionData(
      "initialize",
      [signers.gvToken.address, easeAddress, RCA_CONTROLLER]
    );
    const proxy = await ERC1977ProxyFactory.deploy(
      contracts.bribePot.address,
      callData
    );

    await proxy.deployed();

    // update gvToken to proxy
    contracts.bribePot = <BribePot>(
      await ethers.getContractAt("BribePot", proxy.address)
    );
    // fund user accounts with EASE token
    await contracts.ease
      .connect(signers.deployer)
      .transfer(bobAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.deployer)
      .transfer(aliceAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.deployer)
      .transfer(signers.gvToken.address, parseEther("1000000"));
    await contracts.ease
      .connect(signers.deployer)
      .transfer(briberAddress, parseEther("1000000"));
  });

  describe("#initialState", function () {
    it("should initialize the contract state correctly", async function () {
      const genesis = (await getTimestamp())
        .div(TIME_IN_SECS.week)
        .mul(TIME_IN_SECS.week);

      expect(await contracts.bribePot.genesis()).to.equal(genesis);
      expect(await contracts.bribePot.periodFinish()).to.equal(genesis);
      expect(await contracts.bribePot.lastRewardUpdate()).to.equal(genesis);
      expect(await contracts.bribePot.lastBribeUpdate()).to.equal(0);

      expect(await contracts.bribePot.owner()).to.equal(
        signers.deployer.address
      );
      expect(await contracts.bribePot.name()).to.equal("Ease Bribe Pot");
    });
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
    it("should allow users to bribe => cancel => and bribe again immediately", async function () {
      const gvAmount = parseEther("100");
      const balBeforeBribe = await contracts.ease.balanceOf(briberAddress);

      //  deposit to pot
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
        numOfWeeks,
        rcaVaultAddress
      );
      // Cancle bribe
      await contracts.bribePot
        .connect(signers.briber)
        .cancelBribe(rcaVaultAddress);
      // bribe again
      const balAfterBribeCancel = await contracts.ease.balanceOf(briberAddress);
      expect(balAfterBribeCancel).to.equal(balBeforeBribe);
      // it should allow to bribe quickly after cancelling
      await bribeFor(
        signers.briber,
        bribePerWeek,
        contracts.bribePot,
        contracts.ease,
        numOfWeeks,
        rcaVaultAddress
      );
      const balNow = await contracts.ease.balanceOf(briberAddress);
      expect(balAfterBribeCancel.sub(balNow)).to.equal(
        bribePerWeek.mul(numOfWeeks)
      );
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
    it.only("should check if the DOS bug exists", async function () {
      const gvAmount = parseEther("100");

      //  deposit to pot
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);
      const bribePerWeek = parseEther("10");
      const rcaVaultAddress = RCA_VAULT;
      const numOfWeeks = 0;
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

      // adding bribe amount to pot with numOfWeeks 0 should revert
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
          deadline,
          v,
          r,
          s,
        });

      // move 1 month
      await fastForward(TIME_IN_SECS.month);
      await mine();

      await expect(
        contracts.bribePot
          .connect(signers.gvToken)
          .deposit(aliceAddress, gvAmount)
      ).to.reverted;

      await expect(
        contracts.bribePot
          .connect(signers.gvToken)
          .withdraw(aliceAddress, gvAmount)
      ).to.reverted;

      await expect(
        contracts.bribePot
          .connect(signers.gvToken)
          .getReward(aliceAddress, true)
      ).to.reverted;
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
    it("should allow user to bribe without permit if allowance is enough", async function () {
      // call deposit
      const gvAmount = parseEther("100");
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(bobAddress, gvAmount);
      // call bribe
      const bribePerWeek = parseEther("10");
      const numOfWeeks = 4;
      // approve bribePot
      await contracts.ease
        .connect(signers.briber)
        .approve(contracts.bribePot.address, bribePerWeek.mul(numOfWeeks));
      // if this contract call doesn't fail we can be sure it worked
      await contracts.bribePot
        .connect(signers.briber)
        .bribe(bribePerWeek, RCA_VAULT, numOfWeeks, {
          deadline: 0,
          v: 0,
          r: ethers.constants.HashZero,
          s: ethers.constants.HashZero,
        });
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

      const currWeek = (await getTimestamp())
        .sub(await contracts.bribePot.genesis())
        .div(TIME_IN_SECS.week)
        .add(1);
      await expect(
        contracts.bribePot.connect(signers.briber).cancelBribe(rcaVaultAddress)
      )
        .to.emit(contracts.bribePot, "BribeCanceled")
        .withArgs(briberAddress, rcaVaultAddress, bribePerWeek, currWeek);

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
      await expect(contracts.bribePot.getReward(bobAddress, false))
        .to.emit(contracts.bribePot, "RewardPaid")
        .withArgs(bobAddress, anyValue);
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
      await expect(contracts.bribePot.getReward(bobAddress, true))
        .to.emit(contracts.bribePot, "RewardPaid")
        .withArgs(bobAddress, anyValue);
      const bobEaseBalAfter = await contracts.ease.balanceOf(bobAddress);
      expect(bobEaseBalAfter.sub(bobEaseBalBefore)).to.gte(parseEther("11"));
    });
  });
  describe("bribePerWeek()", function () {
    it("should return correct bribe per week", async function () {
      // bribe per week
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
      let bribeRate = await contracts.bribePot.bribePerWeek();
      expect(bribeRate).to.equal(0);

      // fast forward 2 weeks
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();

      bribeRate = await contracts.bribePot.bribePerWeek();
      expect(bribeRate).to.equal(bribePerWeek);
      // fast forward 2 weeks
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();
      bribeRate = await contracts.bribePot.bribePerWeek();
      expect(bribeRate).to.equal(bribePerWeek);

      // if we fast forward 1 week we will reach to week 5 which
      // means that the bribe will no longer be active
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();
      bribeRate = await contracts.bribePot.bribePerWeek();
      expect(bribeRate).to.equal(0);
    });
  });
  describe("earnable()", function () {
    it("should return correct value for earnable", async function () {
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
      // move to a week where bribe is active
      await fastForward(TIME_IN_SECS.week);
      await mine();

      const aliceEarnable = await contracts.bribePot.earnable(aliceAddress);
      // as alice has 33.33% of total supply deposited gvEASE she should get
      // 33.33% of rewards for current week
      expect(aliceEarnable).to.equal(parseEther("5"));

      const bobEarnable = await contracts.bribePot.earnable(bobAddress);
      // as alice has 66.66% of total supply deposited gvEASE he should get
      // 66.66% of rewards for current week
      expect(bobEarnable).to.equal(parseEther("10"));
    });
  });
  describe("expectedGvAmount()", function () {
    it("should return correct expected gvEase amount", async function () {
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

      let expectedGvAmount = await contracts.bribePot.expectedGvAmount(
        bribePerWeek
      );
      // user should get 100% of total supply if he is the first briber
      const totalSupply = await contracts.bribePot.totalSupply();
      expect(expectedGvAmount).to.equal(totalSupply);

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
      // move forward to next week so bribe becomes active
      await fastForward(TIME_IN_SECS.week);
      await mine();

      expectedGvAmount = await contracts.bribePot.expectedGvAmount(
        bribePerWeek
      );
      // expected gvAmount should be 50% of total supply
      expect(expectedGvAmount).to.equal(totalSupply.div(2));
    });
  });
  describe("earningsPerWeek()", function () {
    it("should return correct earnings per week", async function () {
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
      // move forward to next week so bribe becomes active
      await fastForward(TIME_IN_SECS.week);
      await mine();
      const totalSupply = await contracts.bribePot.totalSupply();

      // if the user supplies gvEASE equal to total supply their earnings
      // per week should be 50% of bribeRate
      let earningsPerWeek = await contracts.bribePot.earningsPerWeek(
        totalSupply
      );
      // if a user is willing to deposit 100% of total supply he should get
      // 50.00% of rewards
      expect(earningsPerWeek).to.equal(bribePerWeek.div(2));
      earningsPerWeek = await contracts.bribePot.earningsPerWeek(
        totalSupply.div(2)
      );
      // if a user is willing to deposit 50% of total supply he should get
      // 33.33% of rewards
      expect(earningsPerWeek).to.equal(bribePerWeek.div(3));
    });
  });
});
