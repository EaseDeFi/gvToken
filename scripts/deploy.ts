import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { getContractAddress } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";

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
  IERC20,
  TokenSwap,
  TokenSwap__factory,
  GvToken,
  GvToken__factory,
  BribePot,
  BribePot__factory,
  IVArmor,
  Timelock__factory,
  GovernorBravoDelegate__factory,
  GovernorBravoDelegator__factory,
  ERC1967Proxy__factory,
} from "../src/types";
import { MAINNET_ADDRESSES, RCA_CONTROLLER } from "../test/constants";
import { Contracts, Signers } from "../test/types";
import { TIME_IN_SECS } from "../test/utils";

async function main() {
  const signers = {} as Signers;
  const contracts = {} as Contracts;
  const accounts = await ethers.getSigners();
  signers.deployer = accounts[0];

  const EASE_TOKEN_FACTORY = <EaseToken__factory>(
    await ethers.getContractFactory("EaseToken")
  );
  const TOKEN_SWAP_FACTORY = <TokenSwap__factory>(
    await ethers.getContractFactory("TokenSwap")
  );
  const GvTokenFactory = <GvToken__factory>(
    await ethers.getContractFactory("GvToken")
  );
  const ERC1977ProxyFactory = <ERC1967Proxy__factory>(
    await ethers.getContractFactory("ERC1967Proxy")
  );
  const BribePotFactory = <BribePot__factory>(
    await ethers.getContractFactory("BribePot")
  );

  const TimelockFactory = <Timelock__factory>(
    await ethers.getContractFactory("Timelock")
  );
  const GovernorBravoDelegateFactory = <GovernorBravoDelegate__factory>(
    await ethers.getContractFactory("GovernorBravoDelegate")
  );
  const GovernorBravoDelegatorFactory = <GovernorBravoDelegator__factory>(
    await ethers.getContractFactory("GovernorBravoDelegator")
  );
  contracts.armor = <IERC20>(
    await ethers.getContractAt("IERC20", MAINNET_ADDRESSES.armor)
  );

  contracts.vArmor = <IVArmor>(
    await ethers.getContractAt("IVArmor", MAINNET_ADDRESSES.vArmor)
  );
  const nonce = await signers.deployer.getTransactionCount();
  // first contract to deploy
  const tokenSwapAddress = getContractAddress({
    from: signers.deployer.address,
    nonce,
  });
  // 2nd contract to deploy nonce+=1
  const easeTokenAddress = getContractAddress({
    from: signers.deployer.address,
    nonce: nonce + 1,
  });
  // third contract to deploy nonce+=2
  const bribePotAddress = getContractAddress({
    from: signers.deployer.address,
    nonce: nonce + 2,
  });
  // we will deploy gvToken using deploy proxy
  // which will deploy implementation first and proxy later
  // meaning nonce+4 will nonce while deploying uups proxy
  // fourth contract to deploy nonce+=4
  const gvTokenAddress = getContractAddress({
    from: signers.deployer.address,
    nonce: nonce + 4,
  });

  const timelockAddress = getContractAddress({
    from: signers.deployer.address,
    nonce: nonce + 5,
  });
  const govAddress = getContractAddress({
    from: signers.deployer.address,
    nonce: nonce + 7,
  });
  // deploy tokenswap contract
  contracts.tokenSwap = <TokenSwap>(
    await TOKEN_SWAP_FACTORY.connect(signers.deployer).deploy(
      easeTokenAddress,
      contracts.armor.address,
      contracts.vArmor.address
    )
  );

  await contracts.tokenSwap.deployed();
  console.log(`TokenSwap deployed to ${contracts.tokenSwap.address}`);
  // deploy ease token
  contracts.ease = <EaseToken>(
    await EASE_TOKEN_FACTORY.connect(signers.deployer).deploy(timelockAddress)
  );
  await contracts.ease.deployed();
  console.log(`Ease Token deployed to ${contracts.ease.address}`);

  // deploy bribePot
  contracts.bribePot = <BribePot>(
    await BribePotFactory.connect(signers.deployer).deploy(
      gvTokenAddress,
      easeTokenAddress,
      RCA_CONTROLLER
    )
  );
  await contracts.bribePot.deployed();
  console.log(`Bribe Pot deployed to ${contracts.bribePot.address}`);

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

  contracts.timelock = await TimelockFactory.deploy(
    govAddress,
    TIME_IN_SECS.day * 2
  );
  console.log(`Timelock deployed to: `, contracts.timelock.address);

  const bravoDelegate = await GovernorBravoDelegateFactory.deploy();

  const bravoDelegator = await GovernorBravoDelegatorFactory.deploy(
    contracts.timelock.address,
    contracts.gvToken.address,
    signers.deployer.address, // deployer as guardain
    bravoDelegate.address,
    VOTING_PERIOD,
    VOTING_DELAY,
    PROPOSAL_THRESOLD
  );
  console.log(`Governance deployed to: `, bravoDelegator.address);

  // Fund tokenswap with ease token
  await contracts.ease.transfer(tokenSwapAddress, TOKENSWAP_TRANSFER_AMT);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
