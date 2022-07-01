import { expect } from "chai";
import { BigNumber, Wallet } from "ethers";
import { getContractAddress, parseEther, randomBytes } from "ethers/lib/utils";
import { ethers } from "hardhat";
import {
  EaseToken__factory,
  GvToken__factory,
  BribePot__factory,
} from "../src/types";
import { RCA_CONTROLLER } from "./constants";
import { getPermitSignature } from "./helpers";
import BalanceTree from "./helpers/balance-tree";
import { Contracts, Signers } from "./types";
import { fastForward, getTimestamp, mine, TIME_IN_SECS } from "./utils";

const PERCENTAGE_SCALE = BigNumber.from(1000);

describe("GvToken", function () {
  const contracts = {} as Contracts;
  const signers = {} as Signers;
  before(async function () {
    const accounts = await ethers.getSigners();
    signers.user = accounts[0];
    signers.gov = accounts[1];
    signers.guardian = accounts[2];
    signers.alice = accounts[3];
    signers.bob = accounts[4];
    signers.otherAccounts = accounts.slice(5);
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
    contracts.ease = await EaseTokenFactory.deploy(signers.user.address);
    contracts.gvToken = await GvTokenFactory.deploy(
      bribePotAddress,
      easeAddress,
      signers.gov.address
    );
    contracts.bribePot = await BribePotFactory.deploy(
      gvTokenAddress,
      easeAddress,
      RCA_CONTROLLER
    );
    // fund user accounts with EASE token
    await contracts.ease
      .connect(signers.user)
      .mint(signers.bob.address, parseEther("1000000"));
    await contracts.ease
      .connect(signers.user)
      .mint(signers.alice.address, parseEther("1000000"));
    await contracts.ease
      .connect(signers.user)
      .mint(signers.user.address, parseEther("1000000"));
  });
  describe("restricted", function () {
    it("should not allow other address to call functions", async function () {
      await expect(
        contracts.bribePot.deposit(signers.user.address, parseEther("100"))
      ).to.revertedWith("only gvToken");
      await expect(
        contracts.bribePot.withdraw(signers.user.address, parseEther("100"))
      ).to.revertedWith("only gvToken");
      await expect(contracts.gvToken.setPower(randomBytes(32))).to.revertedWith(
        "only gov"
      );
    });
  });
  describe("deposit()", function () {
    it("should deposit ease and recieve gv Power", async function () {
      //
      const userAddress = signers.user.address;
      const value = parseEther("100");
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
      const { v, r, s } = await getPermitSignature({
        signer: signers.user,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      // check for emit too
      expect(
        await contracts.gvToken
          .connect(signers.user)
          ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
            deadline,
            v,
            r,
            s,
          })
      )
        .to.emit(contracts.gvToken, "Deposit")
        .withArgs(userAddress, value);
      const power = await contracts.gvToken.power(userAddress);
      expect(power).to.equal(value);
    });

    xit("should update the contract states correctly", async function () {
      // TODO: complete this after adding view functions if necessary
    });

    it("should give extra power to vArmor holders", async function () {
      // vArmor holders come with me
      const bobAddress = signers.bob.address;
      const bobValue = parseEther("1000");
      const bobExtraPower = parseEther("100");
      const aliceAddress = signers.alice.address;
      const aliceValue = parseEther("1200");
      const aliceExtraPower = parseEther("135");
      const powerTree = new BalanceTree([
        { account: bobAddress, amount: bobValue, powerEarned: bobExtraPower },
        {
          account: aliceAddress,
          amount: aliceValue,
          powerEarned: aliceExtraPower,
        },
      ]);
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
      // set root
      const root = powerTree.getHexRoot();
      await contracts.gvToken.connect(signers.gov).setPower(root);
      // Bob deposit
      const bobProof = powerTree.getProof(bobAddress, bobValue, bobExtraPower);
      let { v, r, s } = await getPermitSignature({
        signer: signers.bob,
        token: contracts.ease,
        value: bobValue,
        deadline,
        spender,
      });
      // check for emit too
      expect(
        await contracts.gvToken
          .connect(signers.bob)
          [
            "deposit(uint256,uint256,bytes32[],(uint256,uint8,bytes32,bytes32))"
          ](bobValue, bobExtraPower, bobProof, { v, r, s, deadline })
      )
        .to.emit(contracts.gvToken, "Deposit")
        .withArgs(bobAddress, bobValue);

      const bobPower = await contracts.gvToken.power(bobAddress);
      expect(bobPower).to.equal(bobValue.add(bobExtraPower));

      // Alice Deposit
      const aliceProof = powerTree.getProof(
        aliceAddress,
        aliceValue,
        aliceExtraPower
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
          aliceExtraPower,
          aliceProof,
          { v, r, s, deadline }
        );
      const aliceEaseBalAfter = await contracts.ease.balanceOf(aliceAddress);
      const alicePower = await contracts.gvToken.power(aliceAddress);
      expect(alicePower).to.equal(aliceValue.add(aliceExtraPower));
      // check ease balance
      expect(aliceEaseBalBefore.sub(aliceEaseBalAfter)).to.equal(aliceValue);
    });
    it("should collect power earned on multiple deposits", async function () {
      const userAddress = signers.user.address;
      const value = parseEther("100");
      let deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
      let { v, r, s } = await getPermitSignature({
        signer: signers.user,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      // check for emit too

      await contracts.gvToken
        .connect(signers.user)
        ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
          deadline,
          v,
          r,
          s,
        });

      await fastForward(TIME_IN_SECS.year / 2);
      await mine();

      deadline = (await getTimestamp()).add(1000);
      ({ v, r, s } = await getPermitSignature({
        signer: signers.user,
        token: contracts.ease,
        value,
        deadline,
        spender,
      }));
      await contracts.gvToken
        .connect(signers.user)
        ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
          deadline,
          v,
          r,
          s,
        });

      const power = await contracts.gvToken.power(userAddress);
      const depositedAmount = value.mul(2);
      const growth = value.div(2);
      const expectedPower = depositedAmount.add(growth);
      expect(power).to.gte(expectedPower);
    });
  });
  describe("stake()", async function () {
    it("should allow user to stake in any rca-vault", async function () {
      const vaultAddress = Wallet.createRandom().address;
      // deposit
      const value = parseEther("100");
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
      const { v, r, s } = await getPermitSignature({
        signer: signers.user,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      // check for emit too

      await contracts.gvToken
        .connect(signers.user)
        ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
          deadline,
          v,
          r,
          s,
        });
      // stake
      const balancePercent = PERCENTAGE_SCALE.mul(50);
      const userAddress = signers.user.address;
      expect(
        await contracts.gvToken
          .connect(signers.user)
          .stake(balancePercent, vaultAddress)
      )
        .to.emit(contracts.gvToken, "Stake")
        .withArgs(userAddress, vaultAddress, balancePercent);
    });
    it("should fail if user tries to stake more than 100%", async function () {
      const vaultAddress = Wallet.createRandom().address;
      // deposit
      const value = parseEther("100");
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
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
      // stake
      const balancePercent = PERCENTAGE_SCALE.mul(101);
      await expect(
        contracts.gvToken
          .connect(signers.user)
          .stake(balancePercent, vaultAddress)
      ).to.revertedWith("can't stake more than 100%");
    });
    xit("should update the contract states correctly", async function () {
      // TODO: complete this after adding view functions if necessary
    });
  });
  describe("unStake()", function () {
    it("should allow user to unstake their power from rca-vault", async function () {
      const vaultAddress = Wallet.createRandom().address;
      // deposit
      const value = parseEther("100");
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
      const { v, r, s } = await getPermitSignature({
        signer: signers.user,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      // check for emit too

      await contracts.gvToken
        .connect(signers.user)
        ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
          deadline,
          v,
          r,
          s,
        });
      // stake
      const balancePercent = PERCENTAGE_SCALE.mul(50);
      const userAddress = signers.user.address;
      await contracts.gvToken
        .connect(signers.user)
        .stake(balancePercent, vaultAddress);
      expect(
        await contracts.gvToken
          .connect(signers.user)
          .unStake(balancePercent, vaultAddress)
      )
        .to.emit(contracts.gvToken, "UnStake")
        .withArgs(userAddress, vaultAddress, balancePercent);
    });
  });
  describe("withdrawRequest()", function () {
    it("should allow user to submit withdraw request", async function () {
      //
      const value = parseEther("100");
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
      const { v, r, s } = await getPermitSignature({
        signer: signers.user,
        token: contracts.ease,
        value,
        deadline,
        spender,
      });
      // check for emit too

      await contracts.gvToken
        .connect(signers.user)
        ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
          deadline,
          v,
          r,
          s,
        });
      const endTime = (await getTimestamp()).add(TIME_IN_SECS.day * 14);
      const userAddress = signers.user.address;
      expect(
        await contracts.gvToken
          .connect(signers.user)
          .withdrawRequest(value, false)
      )
        .to.emit(contracts.gvToken, "RedeemRequest")
        .withArgs(userAddress, value, endTime);
    });
    it("should update contract state on withdraw request", async function () {
      const userAddress = signers.user.address;
      const value = parseEther("100");
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
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

      const powerBefore = await contracts.gvToken.power(userAddress);
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(value, false);
      const powerAfter = await contracts.gvToken.power(userAddress);
      expect(powerBefore.sub(powerAfter)).to.equal(value);
      expect(powerAfter).to.equal(0);

      const endTime = (await getTimestamp()).add(TIME_IN_SECS.day * 14);
      const withdrawRequest = await contracts.gvToken.withdrawRequests(
        userAddress
      );

      expect(withdrawRequest.amount).to.equal(value);
      expect(withdrawRequest.endTime).to.equal(endTime);
      expect(withdrawRequest.rewards).to.equal(0);
    });

    xit("should remove gvPower from bribepot", async function () {
      const userAddress = signers.user.address;
      const value = parseEther("100");
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
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

      // deposit to bribe pot
      await contracts.gvToken.connect(signers.user).depositToPot(value);

      const powerBribedBefore = await contracts.bribePot.balanceOf(userAddress);
      console.log(powerBribedBefore);
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(value, true);

      const powerBribedAfter = await contracts.bribePot.balanceOf(userAddress);
      expect(powerBribedBefore.sub(powerBribedAfter)).to.equal(value);
    });
    xit("should collect reward from bribepot", async function () {
      // TODO: complete this
    });
  });
});
