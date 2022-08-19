import hre, { ethers } from "hardhat";
import type { Signers, Contracts } from "./types";
import type {
  EaseToken,
  EaseToken__factory,
  TokenSwap,
  TokenSwap__factory,
  IERC20,
  IVArmor,
} from "../src/types";
import { MAINNET_ADDRESSES } from "./constants";
import { resetBlockchain } from "./utils";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import { expect } from "chai";

describe("TokenSwap", function () {
  const signers = {} as Signers;
  const contracts = {} as Contracts;
  before(async function () {
    await resetBlockchain();
    const accounts = await ethers.getSigners();
    signers.user = accounts[0];
    signers.gov = accounts[1];
    signers.otherAccounts = accounts.slice(2);
  });
  beforeEach(async function () {
    await hre.network.provider.send("hardhat_impersonateAccount", [
      MAINNET_ADDRESSES.armorWhale,
    ]);
    await hre.network.provider.send("hardhat_impersonateAccount", [
      MAINNET_ADDRESSES.vArmorWhale,
    ]);
    const vArmorWhale = await ethers.getSigner(MAINNET_ADDRESSES.vArmorWhale);
    signers.user = await ethers.getSigner(MAINNET_ADDRESSES.armorWhale);
    // transfer eth to user
    await signers.gov.sendTransaction({
      to: signers.user.address,
      value: parseEther("1000"),
    });
    // transfer eth to vArmor whale
    await signers.gov.sendTransaction({
      to: vArmorWhale.address,
      value: parseEther("1"),
    });

    const EASE_TOKEN_FACTORY = <EaseToken__factory>(
      await ethers.getContractFactory("EaseToken")
    );
    const TOKEN_SWAP_FACTORY = <TokenSwap__factory>(
      await ethers.getContractFactory("TokenSwap")
    );

    contracts.armor = <IERC20>(
      await ethers.getContractAt("IERC20", MAINNET_ADDRESSES.armor)
    );
    contracts.vArmor = <IVArmor>(
      await ethers.getContractAt("IVArmor", MAINNET_ADDRESSES.vArmor)
    );
    // transfer vArmor to user wallet
    const vArmorAmount = await contracts.vArmor.balanceOf(vArmorWhale.address);
    await contracts.vArmor
      .connect(vArmorWhale)
      .transfer(signers.user.address, vArmorAmount);

    const nonce = await signers.user.getTransactionCount();
    const tokenSwapAddress = getContractAddress({
      from: signers.user.address,
      nonce,
    });
    const easeTokenAddress = getContractAddress({
      from: signers.user.address,
      nonce: nonce + 1,
    });

    contracts.tokenSwap = <TokenSwap>(
      await TOKEN_SWAP_FACTORY.connect(signers.user).deploy(
        easeTokenAddress,
        contracts.armor.address,
        MAINNET_ADDRESSES.vArmor
      )
    );
    contracts.ease = <EaseToken>(
      await EASE_TOKEN_FACTORY.connect(signers.user).deploy()
    );
    await contracts.ease
      .connect(signers.user)
      .transfer(tokenSwapAddress, parseEther("100000000"));
  });
  describe("Initialize", function () {
    it("should initialize contract properly", async function () {
      expect(await contracts.tokenSwap.armor()).to.be.equal(
        contracts.armor.address
      );
      expect(await contracts.tokenSwap.ease()).to.be.equal(
        contracts.ease.address
      );
      expect(await contracts.tokenSwap.vArmor()).to.be.equal(
        contracts.vArmor.address
      );
    });
  });
  describe("swap()", function () {
    it("should allow user to swap armor tokens for ease tokens", async function () {
      const userAddress = signers.user.address;
      const amount = parseEther("1000");
      await contracts.armor
        .connect(signers.user)
        .approve(contracts.tokenSwap.address, amount);
      const userEaseBalBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.tokenSwap.connect(signers.user).swap(amount);
      const userEaseBalAfter = await contracts.ease.balanceOf(userAddress);
      expect(userEaseBalAfter.sub(userEaseBalBefore)).to.be.equal(amount);
    });
    it("should fail if non armor token holder tries to swap for ease token", async function () {
      const amount = parseEther("1000");
      await contracts.armor
        .connect(signers.gov)
        .approve(contracts.tokenSwap.address, amount);
      await expect(
        contracts.tokenSwap.connect(signers.gov).swap(amount)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });
  describe("swapFor()", function () {
    it("should allow other users to swap Armor for EASE on holders behalf", async function () {
      const userAddress = signers.user.address;
      const amount = parseEther("1000");
      await contracts.armor
        .connect(signers.user)
        .approve(contracts.tokenSwap.address, amount);

      const userEaseBalBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.tokenSwap
        .connect(signers.otherAccounts[0])
        .swapFor(userAddress, amount);
      const userEaseBalAfter = await contracts.ease.balanceOf(userAddress);
      expect(userEaseBalAfter.sub(userEaseBalBefore)).to.be.equal(amount);
    });
    it("should fail if Armor holder hasn't approved the swap contract", async function () {
      const userAddress = signers.user.address;
      const amount = parseEther("1000");
      await expect(
        contracts.tokenSwap
          .connect(signers.otherAccounts[0])
          .swapFor(userAddress, amount)
      ).to.revertedWith("ERC20: transfer amount exceeds allowance");
    });
  });
  describe("swapVArmor()", function () {
    it("should allow user to swap vArmor tokens for ease tokens", async function () {
      const userAddress = signers.user.address;
      const amount = parseEther("1000");
      await contracts.vArmor
        .connect(signers.user)
        .approve(contracts.tokenSwap.address, amount);
      const easeTokensToMint = await contracts.vArmor.vArmorToArmor(amount);
      const userEaseBalBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.tokenSwap.connect(signers.user).swapVArmor(amount);
      const userEaseBalAfter = await contracts.ease.balanceOf(userAddress);
      expect(userEaseBalAfter.sub(userEaseBalBefore)).to.equal(
        easeTokensToMint
      );
    });
    it("should fail if non vArmor holder tries to swap for ease token", async function () {
      const amount = parseEther("1000");
      await contracts.armor
        .connect(signers.gov)
        .approve(contracts.tokenSwap.address, amount);
      await expect(
        contracts.tokenSwap.connect(signers.gov).swapVArmor(amount)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });
  describe("swapVArmorFor()", function () {
    it("should allow other users to swap vArmor for EASE on holders behalf", async function () {
      const userAddress = signers.user.address;
      const amount = parseEther("1000");
      await contracts.vArmor
        .connect(signers.user)
        .approve(contracts.tokenSwap.address, amount);
      // amount of ease the user will recieve
      const easeTokensToMint = await contracts.vArmor.vArmorToArmor(amount);

      const userEaseBalBefore = await contracts.ease.balanceOf(userAddress);
      // swap vArmor on behalf or a user
      await contracts.tokenSwap
        .connect(signers.otherAccounts[0])
        .swapVArmorFor(userAddress, amount);
      const userEaseBalAfter = await contracts.ease.balanceOf(userAddress);
      expect(userEaseBalAfter.sub(userEaseBalBefore)).to.equal(
        easeTokensToMint
      );
    });
    it("should fail if vArmor holder hasn't approved the swap contract", async function () {
      const userAddress = signers.user.address;
      const amount = parseEther("1000");
      await expect(
        contracts.tokenSwap
          .connect(signers.otherAccounts[0])
          .swapVArmorFor(userAddress, amount)
      ).to.revertedWith("ERC20: transfer amount exceeds allowance");
    });
  });
});

describe("EaseToken", function () {
  const signers = {} as Signers;
  const contracts = {} as Contracts;
  before(async function () {
    await resetBlockchain();
    const accounts = await ethers.getSigners();
    signers.user = accounts[0];
    signers.gov = accounts[1];
    signers.otherAccounts = accounts.slice(2);
  });

  beforeEach(async function () {
    await hre.network.provider.send("hardhat_impersonateAccount", [
      MAINNET_ADDRESSES.armorWhale,
    ]);
    signers.user = await ethers.getSigner(MAINNET_ADDRESSES.armorWhale);
    // transfer eth to user
    await signers.gov.sendTransaction({
      to: signers.user.address,
      value: parseEther("1000"),
    });

    const EASE_TOKEN_FACTORY = <EaseToken__factory>(
      await ethers.getContractFactory("EaseToken")
    );

    contracts.ease = <EaseToken>(
      await EASE_TOKEN_FACTORY.connect(signers.user).deploy()
    );
  });

  describe("#initialState", function () {
    it("should set correct metadata", async function () {
      expect(await contracts.ease.name()).to.equal("Ease Token");
      expect(await contracts.ease.symbol()).to.equal("EASE");
    });
    it("should mint total supply to the deployer", async function () {
      const userAddress = signers.user.address;
      const totalSupply = await contracts.ease.totalSupply();
      const expectedTotalSupply = parseEther("750000000");

      expect(totalSupply).to.equal(expectedTotalSupply);

      const deployerBalance = await contracts.ease.balanceOf(userAddress);

      expect(deployerBalance).to.equal(expectedTotalSupply);
    });
  });
  describe("burn()", function () {
    it("should allow user to burn ease tokens", async function () {
      const userAddress = signers.user.address;
      const burnAmt = parseEther("1000");
      const balanceBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.ease.connect(signers.user).burn(burnAmt);
      const balanceAfter = await contracts.ease.balanceOf(userAddress);
      expect(balanceBefore.sub(balanceAfter)).to.equal(burnAmt);
    });
  });
});
