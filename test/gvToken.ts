import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { getContractAddress, parseEther, randomBytes } from "ethers/lib/utils";
import hre, { ethers } from "hardhat";
import {
  BribePot__factory,
  EaseToken__factory,
  GvToken__factory,
  IERC20,
  IVArmor,
  TokenSwap,
  TokenSwap__factory,
} from "../src/types";
import { MAINNET_ADDRESSES, RCA_CONTROLLER, RCA_VAULT } from "./constants";
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
    signers.easeDeployer = accounts[6];
    signers.vArmorHolder = accounts[7];
    signers.otherAccounts = accounts.slice(8);
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
    const TOKEN_SWAP_FACTORY = <TokenSwap__factory>(
      await ethers.getContractFactory("TokenSwap")
    );

    const GvTokenFactory = <GvToken__factory>(
      await ethers.getContractFactory("GvToken")
    );
    const BribePotFactory = <BribePot__factory>(
      await ethers.getContractFactory("BribePot")
    );

    const userNonce = await signers.user.getTransactionCount();
    const gvTokenAddress = getContractAddress({
      from: signers.user.address,
      nonce: userNonce,
    });
    const bribePotAddress = getContractAddress({
      from: signers.user.address,
      nonce: userNonce + 1,
    });
    const GENESIS = (await getTimestamp()).sub(TIME_IN_SECS.year);
    contracts.ease = await EaseTokenFactory.connect(
      signers.easeDeployer
    ).deploy();
    const easeAddress = contracts.ease.address;

    contracts.gvToken = await GvTokenFactory.deploy();
    contracts.bribePot = await BribePotFactory.deploy(
      gvTokenAddress,
      easeAddress,
      RCA_CONTROLLER
    );
    contracts.tokenSwap = <TokenSwap>(
      await TOKEN_SWAP_FACTORY.connect(signers.user).deploy(
        contracts.ease.address,
        MAINNET_ADDRESSES.armor,
        MAINNET_ADDRESSES.vArmor
      )
    );
    // Initialize gvToken
    await contracts.gvToken.initialize(
      bribePotAddress,
      easeAddress,
      RCA_CONTROLLER,
      contracts.tokenSwap.address,
      signers.gov.address,
      GENESIS
    );

    await hre.network.provider.send("hardhat_impersonateAccount", [
      MAINNET_ADDRESSES.vArmorWhale,
    ]);
    await hre.network.provider.send("hardhat_impersonateAccount", [
      MAINNET_ADDRESSES.armorWhale,
    ]);
    const vArmorWhale = await ethers.getSigner(MAINNET_ADDRESSES.vArmorWhale);
    const armorWhale = await ethers.getSigner(MAINNET_ADDRESSES.armorWhale);

    contracts.vArmor = <IVArmor>(
      await ethers.getContractAt("IVArmor", MAINNET_ADDRESSES.vArmor)
    );
    contracts.armor = <IERC20>(
      await ethers.getContractAt("IERC20", MAINNET_ADDRESSES.armor)
    );

    // Fund whale's wallet with eth
    await signers.user.sendTransaction({
      to: vArmorWhale.address,
      value: parseEther("1"),
    });
    await signers.user.sendTransaction({
      to: armorWhale.address,
      value: parseEther("1"),
    });

    // transfer vArmor to user wallet
    const vArmorAmount = await contracts.vArmor.balanceOf(vArmorWhale.address);
    await contracts.vArmor
      .connect(vArmorWhale)
      .transfer(signers.vArmorHolder.address, vArmorAmount);

    // transfer armor to user address
    const armorAmount = await contracts.armor.balanceOf(armorWhale.address);
    await contracts.armor
      .connect(armorWhale)
      .transfer(signers.vArmorHolder.address, armorAmount);

    // fund tokenSwap address with EASE token
    await contracts.ease
      .connect(signers.easeDeployer)
      .transfer(contracts.tokenSwap.address, parseEther("1000000"));

    // fund user accounts with EASE token
    await contracts.ease
      .connect(signers.easeDeployer)
      .transfer(bobAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.easeDeployer)
      .transfer(aliceAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.easeDeployer)
      .transfer(userAddress, parseEther("1000000"));
    await contracts.ease
      .connect(signers.easeDeployer)
      .transfer(briberAddress, parseEther("1000000"));
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

  describe("#initialState", function () {
    it("should return correct name", async function () {
      expect(await contracts.gvToken.name()).to.equal("Growing Vote Ease");
    });
    it("should return correct symbol", async function () {
      expect(await contracts.gvToken.symbol()).to.equal("gvEase");
    });
    it("should return correct decimals", async function () {
      expect(await contracts.gvToken.decimals()).to.equal(18);
    });
  });
  describe("restricted", function () {
    it("should not allow other address to call restricted functions", async function () {
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
    it("should fail if wrong permit sig is used", async function () {
      const depositAmt = parseEther("100");
      const deadline = (await getTimestamp()).add(1000);
      const spender = contracts.gvToken.address;
      // get permit signature with user as a signer
      const { v, r, s } = await getPermitSignature({
        signer: signers.user,
        token: contracts.ease,
        value: depositAmt,
        deadline,
        spender,
      });
      // call deposit with alice's wallet with bob's permit sig
      await expect(
        contracts.gvToken
          .connect(signers.alice)
          ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](depositAmt, {
            deadline,
            v,
            r,
            s,
          })
      ).to.revertedWith("INVALID_SIGNER");
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
    it("should deposit multiple times and allow user to bribe,stake,and withdraw ", async function () {
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
    it("should not allow wallet without ease to deposit", async function () {
      const amount = parseEther("100");
      await expect(depositFor(signers.otherAccounts[0], amount)).to.reverted;
    });
    it("should allow user to deposit without permit if allowance is enough", async function () {
      // approve gvToken to use ease on user's behalf
      const depositAmount = parseEther("100");
      await contracts.ease
        .connect(signers.user)
        .approve(contracts.gvToken.address, depositAmount);
      // call deposit without permit args
      const userGvBalBefore = await contracts.gvToken.balanceOf(userAddress);
      await contracts.gvToken
        .connect(signers.user)
        ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](depositAmount, {
          deadline: 0,
          v: 0,
          r: ethers.constants.HashZero,
          s: ethers.constants.HashZero,
        });
      const userGvBalAfter = await contracts.gvToken.balanceOf(userAddress);
      expect(userGvBalAfter.sub(userGvBalBefore)).to.gte(depositAmount);
    });
    describe("#vArmor", function () {
      let bobValue: BigNumber;
      let bobDepositStart: BigNumber;
      let aliceValue: BigNumber;
      let vArmorHolderValue: BigNumber;
      let aliceDepositStart: BigNumber;
      let userValue: BigNumber;
      let userDepositStart: BigNumber;
      let vArmorHolderDepositStart: BigNumber;
      let powerTree: BalanceTree;
      const vArmorAmount = parseEther("100");
      beforeEach(async function () {
        // complete this anon
        bobValue = parseEther("1000");
        bobDepositStart = (await getTimestamp()).sub(TIME_IN_SECS.month);
        aliceValue = parseEther("1200");
        aliceDepositStart = (await getTimestamp()).sub(TIME_IN_SECS.month * 3);
        userValue = parseEther("800");
        // using userDeposit start before genesis to revert when called deposit
        // using this proof
        vArmorHolderValue = await contracts.vArmor.vArmorToArmor(vArmorAmount);
        userDepositStart = BigNumber.from(
          (await contracts.gvToken.genesis()) - 1000
        );
        vArmorHolderDepositStart = (await getTimestamp()).sub(
          TIME_IN_SECS.month * 3
        );
        powerTree = new BalanceTree([
          {
            account: bobAddress,
            amount: bobValue,
            depositStart: bobDepositStart,
          },
          {
            account: aliceAddress,
            amount: aliceValue,
            depositStart: aliceDepositStart,
          },
          {
            account: userAddress,
            amount: userValue,
            depositStart: userDepositStart,
          },
          {
            account: signers.vArmorHolder.address,
            amount: vArmorHolderValue,
            depositStart: vArmorHolderDepositStart,
          },
        ]);
        const root = powerTree.getHexRoot();
        await contracts.gvToken.connect(signers.gov).setPower(root);
      });
      describe("depositWithVArmor()", function () {
        it("should allow vArmor hodler to directly get gvEase", async function () {
          const vArmorHolderAddress = signers.vArmorHolder.address;
          await contracts.vArmor
            .connect(signers.vArmorHolder)
            .approve(contracts.tokenSwap.address, vArmorAmount);
          const deadline = (await getTimestamp()).add(1000);
          const spender = contracts.gvToken.address;
          const vArmorHolderProof = powerTree.getProof(
            signers.vArmorHolder.address,
            vArmorHolderValue,
            vArmorHolderDepositStart
          );
          const { v, r, s } = await getPermitSignature({
            signer: signers.vArmorHolder,
            token: contracts.ease,
            value: vArmorHolderValue,
            deadline,
            spender,
          });
          const vArmorHolderEaseBalBefore = await contracts.ease.balanceOf(
            vArmorHolderAddress
          );
          const vArmorHolderGvEaseBalBefore = await contracts.gvToken.balanceOf(
            vArmorHolderAddress
          );
          const vArmorHolderDepositValueBefore =
            await contracts.gvToken.totalDeposit(vArmorHolderAddress);
          const gvTokenEaseBalBefore = await contracts.ease.balanceOf(
            contracts.gvToken.address
          );
          await contracts.gvToken
            .connect(signers.vArmorHolder)
            .depositWithVArmor(
              vArmorHolderValue,
              vArmorAmount,
              vArmorHolderDepositStart,
              vArmorHolderProof,
              { v, r, s, deadline }
            );
          const gvTokenEaseBalAfter = await contracts.ease.balanceOf(
            contracts.gvToken.address
          );
          const vArmorHolderEaseBalAfter = await contracts.ease.balanceOf(
            vArmorHolderAddress
          );
          const vArmorHolderDepositValueAfter =
            await contracts.gvToken.totalDeposit(vArmorHolderAddress);
          const vArmorHolderGvEaseBalAfter = await contracts.gvToken.balanceOf(
            vArmorHolderAddress
          );
          // gvToken's ease balance should increase by expected ease deposit amount
          expect(gvTokenEaseBalAfter.sub(gvTokenEaseBalBefore)).to.equal(
            vArmorHolderValue
          );
          // vArmor holders ease balance should remain the same
          expect(vArmorHolderEaseBalAfter).to.equal(vArmorHolderEaseBalBefore);

          // Varmor holder's gvBalance diff should be >24% more
          // than the deposit amount
          expect(
            vArmorHolderGvEaseBalAfter.sub(vArmorHolderGvEaseBalBefore)
          ).to.gt(vArmorHolderValue.add(vArmorHolderValue.mul(24).div(100)));

          // depsoit value of vArmor holder should increase by the amount
          // of ease that can recieve head start.
          expect(
            vArmorHolderDepositValueAfter.sub(vArmorHolderDepositValueBefore)
          ).to.equal(vArmorHolderValue);
        });
      });
      it("should fail if wrong proof is provided by vArmor holder", async function () {
        // Bob deposit
        const deadline = (await getTimestamp()).add(1000);
        const spender = contracts.gvToken.address;
        const aliceProof = powerTree.getProof(
          aliceAddress,
          aliceValue,
          aliceDepositStart
        );
        const { v, r, s } = await getPermitSignature({
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
            ](bobValue, bobDepositStart, aliceProof, { v, r, s, deadline })
        ).to.reverted;
      });
      it("should fail if depositStart is before genesis", async function () {
        const deadline = (await getTimestamp()).add(1000);
        const spender = contracts.gvToken.address;
        const userProof = powerTree.getProof(
          userAddress,
          userValue,
          userDepositStart
        );
        const { v, r, s } = await getPermitSignature({
          signer: signers.user,
          token: contracts.ease,
          value: userValue,
          deadline,
          spender,
        });
        // check for emit too
        await expect(
          contracts.gvToken
            .connect(signers.user)
            [
              "deposit(uint256,uint256,bytes32[],(uint256,uint8,bytes32,bytes32))"
            ](userValue, userDepositStart, userProof, { v, r, s, deadline })
        ).to.revertedWith("depositStart < genesis");
      });
      it("should allow vArmor holders to deposit", async function () {
        // Bob deposit
        const deadline = (await getTimestamp()).add(1000);
        const spender = contracts.gvToken.address;
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
          [
            "deposit(uint256,uint256,bytes32[],(uint256,uint8,bytes32,bytes32))"
          ](aliceValue, aliceDepositStart, aliceProof, { v, r, s, deadline });
        const aliceEaseBalAfter = await contracts.ease.balanceOf(aliceAddress);
        const alicePower = await contracts.gvToken.balanceOf(aliceAddress);
        expect(alicePower).to.gt(aliceValue.add(parseEther("10")));
        // check ease balance
        expect(aliceEaseBalBefore.sub(aliceEaseBalAfter)).to.equal(aliceValue);
      });
    });
    describe("depositWithArmor()", function () {
      it("should allow armor holder's to swap Armor for gvEase", async function () {
        const armorHolderAddress = signers.vArmorHolder.address;
        const value = parseEther("100");
        const deadline = (await getTimestamp()).add(1000);
        const spender = contracts.gvToken.address;
        const { v, r, s } = await getPermitSignature({
          signer: signers.vArmorHolder,
          token: contracts.ease,
          value,
          deadline,
          spender,
        });
        // Approve token swap contract to use armor
        await contracts.armor
          .connect(signers.vArmorHolder)
          .approve(contracts.tokenSwap.address, value);

        const powerBefore = await contracts.gvToken.balanceOf(
          armorHolderAddress
        );
        await expect(
          contracts.gvToken
            .connect(signers.vArmorHolder)
            .depositWithArmor(value, {
              deadline,
              v,
              r,
              s,
            })
        )
          .to.emit(contracts.gvToken, "Deposited")
          .withArgs(armorHolderAddress, value);

        const powerAfter = await contracts.gvToken.balanceOf(
          armorHolderAddress
        );
        expect(powerAfter.sub(powerBefore)).to.equal(value);
      });
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

      // Move a week forward
      await fastForward(TIME_IN_SECS.week);
      await mine();
    });
    it("should fail if withdraw amount is greater than deposited amount", async function () {
      const amount = parseEther("200");
      await expect(
        contracts.gvToken.connect(signers.user).withdrawRequest(amount)
      ).to.revertedWith("not enough deposit!");
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
    it("should update totalSupply correctly", async function () {
      // as gvEase contracts has 2 deposits of 200 ease worth in total
      // the total supply of gvEase will remain 200 gvEASE as there is
      // no mechanism in gvToken contract to take into account of the
      // grown votes. For that case we have setTotalSupply function
      // which can be called by governance if there's a need to.
      // if the amount of gvEASE being withdrawn is greater than total
      // supply the contract set's total supply to zero

      const amount = parseEther("100");
      let totalSupplyBefore = await contracts.gvToken.totalSupply();
      // user withdraw request
      await contracts.gvToken.connect(signers.user).withdrawRequest(amount);
      let totalSupplyAfter = await contracts.gvToken.totalSupply();
      // after one week of deposit gvPower removed from total supply
      // should be greater than withdrawn amount
      expect(totalSupplyBefore.sub(totalSupplyAfter)).to.gt(amount);

      // bob withdraw request
      // on bob withdraw request even though bob's balance is greater
      // than gvEase total supply at this moment the contract set's total
      // supply to zero to not cause underflow.
      totalSupplyBefore = await contracts.gvToken.totalSupply();
      await contracts.gvToken.connect(signers.bob).withdrawRequest(amount);
      totalSupplyAfter = await contracts.gvToken.totalSupply();
      expect(totalSupplyAfter).to.equal(0);
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

      const bobDelegated = await contracts.gvToken.delegated(bobAddress);

      // bob's delegated should be equal ot bob's balance
      expect(bobDelegated).to.equal(bobBalance);
    });
    it("should update checkpoint on withdrawal", async function () {
      // deposit
      const depositAmount = parseEther("100");
      await depositFor(signers.user, depositAmount);
      // delegate
      await contracts.gvToken.connect(signers.user).delegate(aliceAddress);
      // check Delegated balance
      const checkpointCountb4 = await contracts.gvToken.numCheckpoints(
        aliceAddress
      );
      const withdrawAmount = parseEther("10");
      const aliceCheckPointB4 = await contracts.gvToken.checkpoints(
        aliceAddress,
        checkpointCountb4 - 1
      );

      expect(aliceCheckPointB4.votes).to.gte(depositAmount);

      // request withdraw
      await expect(
        contracts.gvToken.connect(signers.user).withdrawRequest(withdrawAmount)
      ).to.emit(contracts.gvToken, "DelegateVotesChanged");

      const checkpointCountAftr = await contracts.gvToken.numCheckpoints(
        aliceAddress
      );
      expect(checkpointCountAftr - checkpointCountb4).to.equal(1);

      const aliceCheckpointAftr = await contracts.gvToken.checkpoints(
        aliceAddress,
        checkpointCountAftr - 1
      );
      const votesDifference = aliceCheckPointB4.votes.sub(
        aliceCheckpointAftr.votes
      );
      // as there are few transactions in between and timestamp should
      // have slightly moved forward by now, user's gvPower should
      // have grown by small amount even withdraw request of 10% of
      // user deposit will not change votes by exactly 10 EASE it will
      // be 9.99999 EASE
      expect(votesDifference).to.gte(parseEther("9.9999"));
    });
    it("should not update checkpoint on withdrawal", async function () {
      // As we fast forward time before calling withdrawal request
      // the user's votes should be grown by significant amount
      // that small withdrawal will not result in writing new checkpoint

      // deposit
      const depositAmount = parseEther("100");
      await depositFor(signers.user, depositAmount);
      // delegate
      await contracts.gvToken.connect(signers.user).delegate(aliceAddress);

      // forward time
      await fastForward(TIME_IN_SECS.month * 4);
      await mine();

      // check Delegated balance
      const checkpointCountb4 = await contracts.gvToken.numCheckpoints(
        aliceAddress
      );
      const withdrawAmount = parseEther("10");
      const aliceCheckPointB4 = await contracts.gvToken.checkpoints(
        aliceAddress,
        checkpointCountb4 - 1
      );

      expect(aliceCheckPointB4.votes).to.gte(depositAmount);

      // request withdraw
      await expect(
        contracts.gvToken.connect(signers.user).withdrawRequest(withdrawAmount)
      ).to.not.emit(contracts.gvToken, "DelegateVotesChanged");

      const checkpointCountAftr = await contracts.gvToken.numCheckpoints(
        aliceAddress
      );
      // as amount being withdrawn is 10EASE and user's total gvEASE balance
      // by now is more than 132gvEase, withdrawing 10 EASE will reduce
      // total gvEase balance of user around 119 gvEASE which is more than
      // delegated amount i.e (100 100 gvEASE)
      expect(checkpointCountAftr - checkpointCountb4).to.equal(0);

      const aliceCheckpointAftr = await contracts.gvToken.checkpoints(
        aliceAddress,
        checkpointCountAftr - 1
      );
      const votesDifference = aliceCheckPointB4.votes.sub(
        aliceCheckpointAftr.votes
      );
      // as the delegates vote was not updated vote diff should be 0
      expect(votesDifference).to.equal(0);
    });
  });
  describe("totalSupply()", function () {
    it("should update totalSupply on deposit", async function () {
      const depositAmount = parseEther("100");
      await depositFor(signers.user, depositAmount);
      const totalSupply = await contracts.gvToken.totalSupply();
      expect(totalSupply).to.equal(depositAmount);
    });
    it("should update totalSupply on withdraw", async function () {
      const depositAmount = parseEther("100");
      await depositFor(signers.user, depositAmount);

      await fastForward(TIME_IN_SECS.month);
      await mine();
      // By this time the user's gvToken balance should be more
      // than deposit amount but total supply will still be deposit
      // if the below will not underflow then our logic to update
      // totalsupply works
      await contracts.gvToken
        .connect(signers.user)
        .withdrawRequest(depositAmount);

      const totalSupply = await contracts.gvToken.totalSupply();
      expect(totalSupply).to.equal(0);
    });
  });

  describe("setTotalSupply()", function () {
    it("should allow governance to update total supply only within bounds", async function () {
      await expect(
        contracts.gvToken.connect(signers.gov).setTotalSupply(1)
      ).to.revertedWith("not in range");

      // deposit fast forward and update
      const depositAmount = parseEther("200");
      await depositFor(signers.user, depositAmount);

      await fastForward(TIME_IN_SECS.month * 2);
      await mine();

      // user deposit balance by this time should be at least
      // grown by 30 gvEASE we update total supply using governance
      const userBalance = await contracts.gvToken.balanceOf(userAddress);
      await contracts.gvToken.connect(signers.gov).setTotalSupply(userBalance);

      await expect(
        contracts.gvToken
          .connect(signers.gov)
          .setTotalSupply(userBalance.sub(1000))
      ).to.revertedWith("existing > new amount");
    });
  });
  describe("setDelay()", function () {
    it("should set withdrawal delay", async function () {
      const newDelay = TIME_IN_SECS.week * 3;
      await contracts.gvToken.connect(signers.gov).setDelay(newDelay);
      const updatedDelay = await contracts.gvToken.withdrawalDelay();
      expect(updatedDelay).to.equal(newDelay);
    });
    it("should not set withdrawal delay less than 7 days", async function () {
      const newDelay = TIME_IN_SECS.day * 3;
      await expect(
        contracts.gvToken.connect(signers.gov).setDelay(newDelay)
      ).to.revertedWith("min delay 7 days");
    });
  });
  describe("setPower()", function () {
    it("should allow governance to set power root", async function () {
      //
      const bobValue = parseEther("100");
      const aliceValue = parseEther("100");
      const depositStart = await getTimestamp();
      const powerTree = new BalanceTree([
        {
          account: bobAddress,
          amount: bobValue,
          depositStart,
        },
        {
          account: aliceAddress,
          amount: aliceValue,
          depositStart,
        },
      ]);
      const root = powerTree.getHexRoot();
      await contracts.gvToken.connect(signers.gov).setPower(root);
    });
  });
});
