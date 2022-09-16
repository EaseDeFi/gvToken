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

const VANITY_TRANSFER_AMOUNT = parseEther("0.05");
async function main() {
  const deployers = {} as Deployers;
  const contracts = {} as Contracts;
  const accounts = await ethers.getSigners();
  deployers.easeDeployer = accounts[0];
  const isMainnet = ["mainnet"].includes(hre.network.name);
  if (isMainnet) {
    console.log(accounts.length);
    if (accounts.length < 9) {
      throw new Error("You must have at least 9 privateKeys in .env..");
    }
    // I assume PRIVATE_KEY1 has enough eth to fund other vanity accounts
    for (let i = 1; i < 9; i++) {
      await accounts[0].sendTransaction({
        to: accounts[i].address,
        value: VANITY_TRANSFER_AMOUNT,
      });
    }

    deployers.easeDeployer = accounts[1];
    deployers.tokenSwapDeployer = accounts[2];
    deployers.gvTokenImplDeployer = accounts[3];
    deployers.gvTokenProxyDeployer = accounts[4];
    deployers.bribePotDeployer = accounts[5];
    deployers.timelockDeployer = accounts[6];
    deployers.govDelegateDeployer = accounts[7];
    deployers.govDelegatorDeployer = accounts[8];
  } else {
    // We use PRIVATE_KEY1 as a deployer for all
    // PRIVATE_KEY1 should have all the funds
    deployers.easeDeployer = accounts[0];
    deployers.tokenSwapDeployer = accounts[0];
    deployers.gvTokenImplDeployer = accounts[0];
    deployers.gvTokenProxyDeployer = accounts[0];
    deployers.bribePotDeployer = accounts[0];
    deployers.timelockDeployer = accounts[0];
    deployers.govDelegateDeployer = accounts[0];
    deployers.govDelegatorDeployer = accounts[0];
  }

  const EaseTokenFactory = <EaseToken__factory>(
    await ethers.getContractFactory("EaseToken", deployers.easeDeployer)
  );
  const TokenSwapFactory = <TokenSwap__factory>(
    await ethers.getContractFactory("TokenSwap", deployers.tokenSwapDeployer)
  );
  const GvTokenFactory = <GvToken__factory>(
    await ethers.getContractFactory("GvToken", deployers.gvTokenImplDeployer)
  );
  const ERC1977ProxyFactory = <ERC1967Proxy__factory>(
    await ethers.getContractFactory(
      "ERC1967Proxy",
      deployers.gvTokenProxyDeployer
    )
  );
  const BribePotFactory = <BribePot__factory>(
    await ethers.getContractFactory("BribePot", deployers.bribePotDeployer)
  );

  const TimelockFactory = <Timelock__factory>(
    await ethers.getContractFactory("Timelock", deployers.timelockDeployer)
  );
  const GovernorBravoDelegateFactory = <GovernorBravoDelegate__factory>(
    await ethers.getContractFactory(
      "GovernorBravoDelegate",
      deployers.govDelegateDeployer
    )
  );
  const GovernorBravoDelegatorFactory = <GovernorBravoDelegator__factory>(
    await ethers.getContractFactory(
      "GovernorBravoDelegator",
      deployers.govDelegatorDeployer
    )
  );

  // first contract to deploy
  const tokenSwapAddress = getContractAddress({
    from: deployers.tokenSwapDeployer.address,
    nonce: await deployers.tokenSwapDeployer.getTransactionCount(),
  });
  // 2nd contract to deploy nonce+=1
  const easeTokenAddress = getContractAddress({
    from: deployers.easeDeployer.address,
    nonce: await deployers.easeDeployer.getTransactionCount(),
  });
  // third contract to deploy nonce+=2
  const bribePotAddress = getContractAddress({
    from: deployers.bribePotDeployer.address,
    nonce: await deployers.bribePotDeployer.getTransactionCount(),
  });
  // we will deploy gvToken using deploy proxy
  // which will deploy implementation first and proxy later
  // meaning nonce+4 will nonce while deploying uups proxy
  // fourth contract to deploy nonce+=4
  const gvTokenAddress = getContractAddress({
    from: deployers.gvTokenProxyDeployer.address,
    nonce: await deployers.gvTokenProxyDeployer.getTransactionCount(),
  });

  const timelockAddress = getContractAddress({
    from: deployers.timelockDeployer.address,
    nonce: await deployers.timelockDeployer.getTransactionCount(),
  });
  const govAddress = getContractAddress({
    from: deployers.govDelegatorDeployer.address,
    nonce: await deployers.govDelegatorDeployer.getTransactionCount(),
  });
  // deploy tokenswap contract
  contracts.tokenSwap = <TokenSwap>(
    await TokenSwapFactory.deploy(
      easeTokenAddress,
      MAINNET_ADDRESSES.armor,
      MAINNET_ADDRESSES.vArmor
    )
  );

  await contracts.tokenSwap.deployed();
  console.log(`TokenSwap deployed to ${contracts.tokenSwap.address}`);
  console.log(tokenSwapAddress);
  // deploy ease token
  contracts.ease = <EaseToken>await EaseTokenFactory.deploy(timelockAddress);
  await contracts.ease.deployed();
  console.log(`Ease Token deployed to ${contracts.ease.address}`);
  console.log(easeTokenAddress);

  // deploy bribePot
  contracts.bribePot = <BribePot>await BribePotFactory.deploy();
  await contracts.bribePot.deployed();
  console.log(`Bribe Pot deployed to ${contracts.bribePot.address}`);
  console.log(bribePotAddress);

  // Deploy gvToken
  // Validate GvToken Implementation for upgradability
  await upgrades.validateImplementation(GvTokenFactory);

  // Setting gvToken as implementation initially and we will
  // update it to proxy address later
  contracts.gvToken = await GvTokenFactory.deploy();
  await contracts.gvToken.deployed();

  const callData = contracts.gvToken.interface.encodeFunctionData(
    "initialize",
    [
      bribePotAddress,
      easeTokenAddress,
      RCA_CONTROLLER,
      tokenSwapAddress,
      GENESIS,
    ]
  );
  const proxy = await ERC1977ProxyFactory.deploy(
    contracts.gvToken.address,
    callData
  );

  await proxy.deployed();

  // update gvToken to proxy
  contracts.gvToken = <GvToken>(
    await ethers.getContractAt("GvToken", proxy.address)
  );
  console.log(`Gv Token deployed to: ${contracts.gvToken.address}`);
  console.log(gvTokenAddress);

  contracts.timelock = await TimelockFactory.deploy(
    govAddress,
    TIME_IN_SECS.day * 2
  );
  console.log(`Timelock deployed to: `, contracts.timelock.address);
  console.log(timelockAddress);

  const bravoDelegate = await GovernorBravoDelegateFactory.deploy();

  const bravoDelegator = await GovernorBravoDelegatorFactory.deploy(
    contracts.timelock.address,
    contracts.gvToken.address,
    deployers.govDelegatorDeployer.address, // deployer as guardain
    bravoDelegate.address,
    VOTING_PERIOD,
    VOTING_DELAY,
    PROPOSAL_THRESOLD
  );
  console.log(`Governance deployed to: `, bravoDelegator.address);
  console.log(govAddress);

  await contracts.bribePot.initialize(
    gvTokenAddress,
    easeTokenAddress,
    RCA_CONTROLLER
  );
  // Fund tokenswap with ease token
  await contracts.ease.transfer(tokenSwapAddress, TOKENSWAP_TRANSFER_AMT);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
