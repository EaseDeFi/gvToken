import "@nomiclabs/hardhat-ethers";
import { getContractAddress } from "ethers/lib/utils";
import { ethers } from "hardhat";

import {
  EaseToken,
  EaseToken__factory,
  IERC20,
  TokenSwap,
  TokenSwap__factory,
} from "../src/types";
import { MAINNET_ADDRESSES } from "../test/constants";
import { Contracts, Signers } from "../test/types";

async function main() {
  const signers = {} as Signers;
  const contracts = {} as Contracts;

  const EASE_TOKEN_FACTORY = <EaseToken__factory>(
    await ethers.getContractFactory("EaseToken")
  );
  const TOKEN_SWAP_FACTORY = <TokenSwap__factory>(
    await ethers.getContractFactory("TokenSwap")
  );

  contracts.armorToken = <IERC20>(
    await ethers.getContractAt("IERC20", MAINNET_ADDRESSES.armorToken)
  );

  const nonce = await signers.user.getTransactionCount();
  const tokenSwapAddress = getContractAddress({
    from: signers.user.address,
    nonce,
  });
  const easeTokenAddress = getContractAddress({
    from: signers.user.address,
    nonce: nonce + 1,
  });

  // deploy tokenswap contract
  contracts.tokenSwap = <TokenSwap>(
    await TOKEN_SWAP_FACTORY.connect(signers.user).deploy(
      easeTokenAddress,
      contracts.armorToken.address
    )
  );
  await contracts.tokenSwap.deployed();
  console.log(`TokenSwap deployed at ${contracts.tokenSwap.address}`);

  // deploy ease token
  contracts.easeToken = <EaseToken>(
    await EASE_TOKEN_FACTORY.connect(signers.user).deploy(tokenSwapAddress)
  );
  await contracts.easeToken.deployed();
  console.log(`Ease Token deployed at ${contracts.easeToken.address}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
