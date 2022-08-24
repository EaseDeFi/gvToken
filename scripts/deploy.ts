import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";

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
import { MAINNET_ADDRESSES, RCA_CONTROLLER } from "../test/constants";
import { Contracts, Signers } from "../test/types";
import { getTimestamp } from "../test/utils";

// CONSTANTS
const TOKENSWAP_TRANSFER_AMT = parseEther("1000000");

async function main() {
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
  // deploy ease token
  contracts.ease = <EaseToken>(
    await EASE_TOKEN_FACTORY.connect(signers.user).deploy()
  );
  await contracts.ease.deployed();
  console.log(`Ease Token deployed at ${contracts.ease.address}`);

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

  // Deploy gvToken
  contracts.gvToken = <GvToken>await upgrades.deployProxy(
    GvTokenFactory,
    [
      bribePotAddress,
      easeTokenAddress,
      RCA_CONTROLLER,
      tokenSwapAddress,
      GENESIS,
    ],
    // TODO: discuss what to use transparent of uups
    { kind: "uups" }
  );
  await contracts.gvToken.deployed();
  console.log(`Gv Token deployed at ${contracts.gvToken.address}`);

  // Fund tokenswap with ease token
  await contracts.ease.transfer(tokenSwapAddress, TOKENSWAP_TRANSFER_AMT);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
