import "@nomiclabs/hardhat-ethers";
import { getContractAddress } from "ethers/lib/utils";
import { ethers } from "hardhat";

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
  const gvTokenAddress = getContractAddress({
    from: signers.user.address,
    nonce: nonce + 2,
  });
  // fourth contract to deploy nonce+=3
  const bribePotAddress = getContractAddress({
    from: signers.user.address,
    nonce: nonce + 3,
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
    await EASE_TOKEN_FACTORY.connect(signers.user).deploy(tokenSwapAddress)
  );
  await contracts.ease.deployed();
  console.log(`Ease Token deployed at ${contracts.ease.address}`);
  console.log({ easeTokenAddress });

  const GENESIS = await getTimestamp();
  // Deploy gvToken
  contracts.gvToken = <GvToken>(
    await GvTokenFactory.connect(signers.user).deploy(
      bribePotAddress,
      easeTokenAddress,
      RCA_CONTROLLER,
      signers.user.address,
      GENESIS
    )
  );
  await contracts.gvToken.deployed();
  console.log(`Gv Token deployed at ${contracts.gvToken.address}`);
  console.log({ gvTokenAddress });

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
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
