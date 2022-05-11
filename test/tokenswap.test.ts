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
import { ether, resetBlockchain } from "./utils";
import { getContractAddress } from "ethers/lib/utils";
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
      value: ether("1000"),
    });
    // transfer eth to vArmor whale
    await signers.gov.sendTransaction({
      to: vArmorWhale.address,
      value: ether("1"),
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
      await EASE_TOKEN_FACTORY.connect(signers.user).deploy(tokenSwapAddress)
    );
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
      const amount = ether("1000");
      await contracts.armor
        .connect(signers.user)
        .approve(contracts.tokenSwap.address, amount);
      const userEaseBalBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.tokenSwap.connect(signers.user).swap(amount);
      const userEaseBalAfter = await contracts.ease.balanceOf(userAddress);
      expect(userEaseBalAfter.sub(userEaseBalBefore)).to.be.equal(amount);
    });
    it("should allow user to swap vArmor tokens for ease tokens", async function () {
      const userAddress = signers.user.address;
      const amount = ether("1000");
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
    it("should fail if non armor token holder tries to swap for ease token", async function () {
      const amount = ether("1000");
      await contracts.armor
        .connect(signers.gov)
        .approve(contracts.tokenSwap.address, amount);
      await expect(
        contracts.tokenSwap.connect(signers.gov).swap(amount)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
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
      value: ether("1000"),
    });

    const EASE_TOKEN_FACTORY = <EaseToken__factory>(
      await ethers.getContractFactory("EaseToken")
    );

    contracts.ease = <EaseToken>(
      await EASE_TOKEN_FACTORY.connect(signers.user).deploy(
        signers.user.address
      )
    );
  });

  describe("mint()", function () {
    it("should allow minter to mint the token", async function () {
      const amount = ether("1000");
      const userAddress = signers.user.address;
      const userEaseBalBefore = await contracts.ease.balanceOf(userAddress);
      await contracts.ease.connect(signers.user).mint(userAddress, amount);
      const userEaseBalAfter = await contracts.ease.balanceOf(userAddress);
      expect(userEaseBalAfter.sub(userEaseBalBefore)).to.be.equal(amount);
    });
    it("should not allow non minter to mint ease token", async function () {
      const amount = ether("1000");
      const userAddress = signers.user.address;
      await expect(
        contracts.ease.connect(signers.gov).mint(userAddress, amount)
      ).to.revertedWith("only minter");
    });
  });
});
