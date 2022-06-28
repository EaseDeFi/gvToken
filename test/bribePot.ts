import { expect } from "chai";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { EaseToken__factory } from "../src/types";
import { BribePot__factory } from "../src/types/factories/contracts/core/BribePot__factory";
import { RCA_CONTROLLER, RCA_VAULT } from "./constants";
import { getPermitSignature } from "./helpers";
import { Contracts, Signers } from "./types";
import { getTimestamp, fastForward, mine, TIME_IN_SECS } from "./utils";

describe("BribePot", function () {
  const contracts = {} as Contracts;
  const signers = {} as Signers;
  before(async function () {
    const accounts = await ethers.getSigners();
    signers.gvToken = accounts[0];
    signers.gov = accounts[1];
    signers.briber = accounts[2];
    signers.alice = accounts[3];
    signers.bob = accounts[4];
    signers.otherAccounts = accounts.slice(5);
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
      .mint(signers.bob.address, parseEther("1000000"));
    await contracts.ease
      .connect(signers.gvToken)
      .mint(signers.alice.address, parseEther("1000000"));
    await contracts.ease
      .connect(signers.gvToken)
      .mint(signers.gvToken.address, parseEther("1000000"));
    await contracts.ease
      .connect(signers.gvToken)
      .mint(signers.briber.address, parseEther("1000000"));
  });

  describe("restricted", function () {
    it("should restrict address other than gvToken", async function () {
      await expect(
        contracts.bribePot
          .connect(signers.bob)
          .deposit(signers.alice.address, parseEther("100"))
      ).to.revertedWith("only gvToken");
      await expect(
        contracts.bribePot
          .connect(signers.bob)
          .withdraw(signers.alice.address, parseEther("100"))
      ).to.revertedWith("only gvToken");
      await expect(
        contracts.bribePot.connect(signers.bob).getReward(signers.alice.address)
      ).to.revertedWith("only gvToken");
    });
  });

  describe("deposit()", function () {
    it("should allow gvToken to deposit on users behalf", async function () {
      // Deposit funds on behalf of the user
      const gvAmount = parseEther("100");
      const bobAddress = signers.bob.address;
      const aliceAddress = signers.alice.address;
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
      const bobAddress = signers.bob.address;
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
      // increase evm time and mine
      await fastForward(TIME_IN_SECS.week * 2);
      await mine();
      const rewardBefore = await contracts.bribePot.rewards(bobAddress);

      // deposit again
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(bobAddress, gvAmount);

      const rewardAfter = await contracts.bribePot.rewards(bobAddress);

      let rewardPerTokenStored =
        await contracts.bribePot.rewardPerTokenStored();

      expect(rewardPerTokenStored).to.gt(parseEther("0.2"));

      expect(rewardAfter.sub(rewardBefore)).to.gt(bribePerWeek.mul(2));
      await fastForward((TIME_IN_SECS.week + 100) * 4);
      await mine();
      rewardPerTokenStored = await contracts.bribePot.rewardPerTokenStored();

      // deposit again
      const balanceBefore = await contracts.ease.balanceOf(
        signers.gvToken.address
      );
      await contracts.bribePot.connect(signers.gvToken).getReward(bobAddress);
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

      await expect(
        contracts.bribePot.bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
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
      const aliceAddress = signers.alice.address;
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);
      // call bribe
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
      expect(await contracts.ease.balanceOf(spender)).to.equal(value);
      // check week start
      // check week end
    });
    it("should not allow user to have multiple bribe for same vault", async function () {
      // call deposit
      const gvAmount = parseEther("100");
      const aliceAddress = signers.alice.address;
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);
      // call bribe
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
      await expect(
        contracts.bribePot
          .connect(signers.briber)
          .bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
            deadline,
            v,
            r,
            s,
          })
      ).to.revertedWith("bribe already exists");
    });
  });
  describe("cancelBribe()", function () {
    it("should allow briber to cancel bribe and recieve remaining EASE", async function () {
      // call deposit
      const gvAmount = parseEther("100");
      const aliceAddress = signers.alice.address;
      await contracts.bribePot
        .connect(signers.gvToken)
        .deposit(aliceAddress, gvAmount);
      // call bribe
      const bribePerWeek = parseEther("10");
      const rcaVaultAddress = RCA_VAULT;
      const numOfWeeks = 4;
      // get signature
      const briberAddress = signers.briber.address;
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
  });

  describe("withdraw()", async function () {
    it("should allow user to withdraw gvPower and recieve rewards owed", async function () {
      // deposit, add bribe, and withdraw after some time
      // call deposit
      const gvAmount = parseEther("100");
      const aliceAddress = signers.alice.address;
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

      await contracts.bribePot.connect(signers.gvToken).getReward(aliceAddress);

      const balanceAfter = await contracts.ease.balanceOf(
        signers.gvToken.address
      );
      expect(balanceAfter.sub(balanceBefore)).to.gte(parseEther("0.499999999"));
    });
  });
});
