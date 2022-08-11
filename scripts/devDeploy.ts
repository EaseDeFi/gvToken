import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import hre, { ethers, upgrades } from "hardhat";

import {
  EaseToken,
  EaseToken__factory,
  IERC20,
  TokenSwap,
  TokenSwap__factory,
  GvToken,
  GvToken__factory,
  BribePot,
  BribePot__factory,
  IVArmor,
} from "../src/types";
import {
  MAINNET_ADDRESSES,
  RCA_CONTROLLER,
  RCA_VAULTS,
} from "../test/constants";
import { Contracts, Signers } from "../test/types";
import { getTimestamp } from "../test/utils";
import { bribeFor, depositFor } from "../test/helpers";
const PERCENT_MUL_FACTOR = 1000;

async function main() {
  const canImpersonate = ["localhost", "hardhat"].includes(hre.network.name);
  const isTenderlyFork = hre.network.name === "tenderly";
  const signers = {} as Signers;
  const contracts = {} as Contracts;
  const accounts = await ethers.getSigners();
  signers.user = accounts[0];

  const EASE_TOKEN_FACTORY = <EaseToken__factory>(
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

  contracts.armor = <IERC20>(
    await ethers.getContractAt("IERC20", MAINNET_ADDRESSES.armor)
  );

  contracts.vArmor = <IVArmor>(
    await ethers.getContractAt("IVArmor", MAINNET_ADDRESSES.vArmor)
  );
  const nonce = await signers.user.getTransactionCount();
  // first contract to deploy
  const tokenSwapAddress = getContractAddress({
    from: signers.user.address,
    nonce,
  });
  // 2nd contract to deploy nonce+=1
  const easeTokenAddress = getContractAddress({
    from: signers.user.address,
    nonce: nonce + 1,
  });
  // third contract to deploy nonce+=2
  const bribePotAddress = getContractAddress({
    from: signers.user.address,
    nonce: nonce + 2,
  });
  // we will deploy gvToken using deploy proxy
  // which will deploy implementation first and proxy later
  // meaning nonce+4 will nonce while deploying uups proxy
  // fourth contract to deploy nonce+=4
  const gvTokenAddress = getContractAddress({
    from: signers.user.address,
    nonce: nonce + 4,
  });

  // deploy tokenswap contract
  contracts.tokenSwap = <TokenSwap>(
    await TOKEN_SWAP_FACTORY.connect(signers.user).deploy(
      easeTokenAddress,
      contracts.armor.address,
      contracts.vArmor.address
    )
  );

  await contracts.tokenSwap.deployed();
  console.log(`TokenSwap deployed at ${contracts.tokenSwap.address}`);
  console.log({ tokenSwapAddress });
  // deploy ease token
  contracts.ease = <EaseToken>(
    await EASE_TOKEN_FACTORY.connect(signers.user).deploy()
  );
  await contracts.ease.deployed();
  console.log(`Ease Token deployed at ${contracts.ease.address}`);
  console.log({ easeTokenAddress });

  const GENESIS = await getTimestamp();
  // deploy bribePot
  contracts.bribePot = <BribePot>(
    await BribePotFactory.connect(signers.user).deploy(
      gvTokenAddress,
      easeTokenAddress,
      RCA_CONTROLLER
    )
  );
  await contracts.bribePot.deployed();
  console.log(`Bribe Pot deployed at ${contracts.bribePot.address}`);
  console.log({ bribePotAddress });

  // Deploy gvToken
  contracts.gvToken = <GvToken>(
    await upgrades.deployProxy(
      GvTokenFactory,
      [
        bribePotAddress,
        easeTokenAddress,
        RCA_CONTROLLER,
        tokenSwapAddress,
        signers.user.address,
        GENESIS,
      ],
      { kind: "uups" }
    )
  );
  await contracts.gvToken.deployed();
  console.log(`Gv Token deployed at ${contracts.gvToken.address}`);
  console.log({ gvTokenAddress });

  // Fund tokenswap with ease token
  await contracts.ease.transfer(tokenSwapAddress, parseEther("1000000"));
  async function depositStakeBribe() {
    // swap armor for ease
    // approve armor
    const transferAmount = parseEther("20000");
    if (canImpersonate) {
      // impersonate whale and transfer armor to user
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [MAINNET_ADDRESSES.armorWhale],
      });
      const armorWhale = await ethers.getSigner(MAINNET_ADDRESSES.armorWhale);
      await contracts.armor
        .connect(armorWhale)
        .transfer(signers.user.address, parseEther("100000"));
    }

    if (isTenderlyFork || canImpersonate) {
      // NOTE: if it is a tenderly fork you are running on make sure
      // account of MAINNET_PRIVATE_KEY has at least 20k armor at forked block
      // else tokenswap will fail
      console.log("Approving armor tokens....");
      await contracts.armor
        .connect(signers.user)
        .approve(contracts.tokenSwap.address, transferAmount);
      console.log("Approving armor for ease....");
      await contracts.tokenSwap.connect(signers.user).swap(transferAmount);
      // DEPOSIT: 10k EASE to gvTOKEN
      const depositAmount = parseEther("10000");
      console.log("Deposit ease for gvEASE....");
      await depositFor(
        signers.user,
        depositAmount,
        contracts.gvToken,
        contracts.ease
      );
      // STAKE 25% on one vault
      const stakePercentage = PERCENT_MUL_FACTOR * 25;
      console.log("Stake 25% in first rca-vault....");
      await contracts.gvToken
        .connect(signers.user)
        .stake(stakePercentage, RCA_VAULTS.ezYvCrvIronBank);
      // STAKE 25% on another vault
      console.log("Stake 25% in second rca-vault....");
      await contracts.gvToken
        .connect(signers.user)
        .stake(stakePercentage, RCA_VAULTS.ezYvDAI);
      // put 50% up for bribe
      console.log("Deposit gvEASE to bribe pot....");
      await contracts.gvToken
        .connect(signers.user)
        .depositToPot(depositAmount.div(2));
      // start bribe for 100 EASE on third vault
      const bribePerWeek = parseEther("100");
      const numOfWeeks = 2;
      console.log("Bribe gvEASE from bribe pot for third rca-vault....");
      await bribeFor(
        signers.user,
        bribePerWeek,
        contracts.bribePot,
        contracts.ease,
        numOfWeeks,
        RCA_VAULTS.ezYvUSDC
      );
      // start bribe for 100 EASE on fourth vault
      console.log("Bribe gvEASE from bribe pot for fourth rca-vault....");
      await bribeFor(
        signers.user,
        bribePerWeek,
        contracts.bribePot,
        contracts.ease,
        numOfWeeks,
        RCA_VAULTS.ezYvWETH
      );
    }
  }
  await depositStakeBribe();
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});