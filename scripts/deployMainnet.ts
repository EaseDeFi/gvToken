import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import hre, { ethers, upgrades } from "hardhat";

import {
  VOTING_DELAY,
  VOTING_PERIOD,
  PROPOSAL_THRESOLD,
  TOKENSWAP_TRANSFER_AMT,
  GENESIS,
} from "../constants";

import {
  EaseToken,
  EaseToken__factory,
  TokenSwap,
  TokenSwap__factory,
  GvToken,
  GvToken__factory,
  BribePot,
  BribePot__factory,
  Timelock__factory,
  GovernorBravoDelegate__factory,
  GovernorBravoDelegator__factory,
  ERC1967Proxy__factory,
} from "../src/types";
import { MAINNET_ADDRESSES, RCA_CONTROLLER } from "../test/constants";
import { Contracts, Deployers } from "../test/types";
import { TIME_IN_SECS } from "../test/utils";
import { BigNumber, Signer } from "ethers";

const VANITY_TRANSFER_AMOUNT = parseEther("0.1");
async function main() {
  const deployers = {} as Deployers;
  const contracts = {} as Contracts;
  const accounts: Signer[] = [];
  deployers.easeDeployer = accounts[0];

  const realEaseToken = "0xEa5eDef1287AfDF9Eb8A46f9773AbFc10820c61c";
  const gvTokenProxy = "0xEa5edeF1eDB2f47B9637c029A6aC3b80a7ae1550";

  // Load private keys
  const privateKeys: string[] = [];
  let i = 1;
  while (process.env[`PRIVATE_KEY${i}`] !== undefined) {
    privateKeys.push(`0x${process.env[`PRIVATE_KEY${i}`] as string}`);
    i++;
  }

  accounts[0] = new ethers.Wallet(privateKeys[0], ethers.provider);
  deployers.easeDeployer = accounts[0];

  // I assume PRIVATE_KEY1 has enough eth to fund other vanity accounts
  for (let i = 1; i < 4; i++) {
    const signer = new ethers.Wallet(privateKeys[i], ethers.provider);
    accounts[i] = signer;
    console.log(await signer.getAddress())
    await accounts[0].sendTransaction({
      to: await accounts[i].getAddress(),
      value: VANITY_TRANSFER_AMOUNT,
    });
  }

  deployers.gvTokenImplDeployer = accounts[1];
  deployers.bribePotProxyDeployer = accounts[2];
  deployers.bribePotImplDeployer = accounts[3];

  const GvTokenFactory = <GvToken__factory>(
    await ethers.getContractFactory("GvToken", deployers.gvTokenImplDeployer)
  );
  const BribePotFactory = <BribePot__factory>(
    await ethers.getContractFactory("BribePot", deployers.bribePotImplDeployer)
  );
  const ERC1977ProxyFactory = <ERC1967Proxy__factory>(
    await ethers.getContractFactory(
      "ERC1967Proxy",
      deployers.bribePotProxyDeployer
    )
  );

  // third contract to deploy nonce+=2
  const bribePotProxyAddress = getContractAddress({
    from: await deployers.bribePotProxyDeployer.getAddress(),
    nonce: await deployers.bribePotProxyDeployer.getTransactionCount(),
  });

  // third contract to deploy nonce+=2
  const bribePotImplAddress = getContractAddress({
    from: await deployers.bribePotImplDeployer.getAddress(),
    nonce: await deployers.bribePotImplDeployer.getTransactionCount(),
  });
  // we will deploy gvToken using deploy proxy
  // which will deploy implementation first and proxy later
  // meaning nonce+4 will nonce while deploying uups proxy
  // fourth contract to deploy nonce+=4
  const gvTokenAddress = getContractAddress({
    from: await deployers.gvTokenImplDeployer.getAddress(),
    nonce: await deployers.gvTokenImplDeployer.getTransactionCount(),
  });

  // deploy bribePot
  contracts.bribePot = <BribePot>(await BribePotFactory.deploy());
  await contracts.bribePot.deployed();
  console.log(`Bribe Pot implementation deployed to ${contracts.bribePot.address}`);
  console.log(bribePotImplAddress);

  const callData = contracts.bribePot.interface.encodeFunctionData(
    "initialize",
    [
      gvTokenProxy,
      realEaseToken,
      RCA_CONTROLLER
    ]
  );
  const proxy = await ERC1977ProxyFactory.deploy(
    contracts.bribePot.address,
    callData
  );
  console.log(`Bribe Pot proxy deployed to ${proxy.address}`);
  console.log(bribePotProxyAddress);

  // Setting gvToken as implementation initially and we will
  // update it to proxy address later
  contracts.gvToken = await GvTokenFactory.deploy();
  await contracts.gvToken.deployed();

  console.log(`Gv Token deployed to: ${contracts.gvToken.address}`);
  console.log(gvTokenAddress);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
