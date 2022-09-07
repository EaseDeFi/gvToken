import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { ethers } from "hardhat";

import { DEPLOYED_ADDRESSES } from "../constants";

import {
  EaseToken,
  TokenSwap,
  GvToken,
  BribePot,
  GovernorBravoDelegate,
} from "../src/types";
import { Contracts, Signers } from "../test/types";

async function main() {
  const signers = {} as Signers;
  const contracts = {} as Contracts;
  const accounts = await ethers.getSigners();
  signers.user = accounts[0];

  contracts.ease = <EaseToken>(
    await ethers.getContractAt(
      "EaseToken",
      DEPLOYED_ADDRESSES.easeToken,
      signers.user
    )
  );

  contracts.tokenSwap = <TokenSwap>(
    await ethers.getContractAt(
      "TokenSwap",
      DEPLOYED_ADDRESSES.easeTokenSwap,
      signers.user
    )
  );

  contracts.gvToken = <GvToken>(
    await ethers.getContractAt(
      "GvToken",
      DEPLOYED_ADDRESSES.gvEASE,
      signers.user
    )
  );
  contracts.bribePot = <BribePot>(
    await ethers.getContractAt(
      "BribePot",
      DEPLOYED_ADDRESSES.easeBribePot,
      signers.user
    )
  );
  contracts.easeGovernance = <GovernorBravoDelegate>(
    await ethers.getContractAt(
      "GovernorBravoDelegate",
      DEPLOYED_ADDRESSES.easeGovernance,
      signers.user
    )
  );

  //   TODO: call transactions here
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
