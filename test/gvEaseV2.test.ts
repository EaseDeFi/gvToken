import { Contracts, Signers } from "./types";
import { ethers, upgrades } from "hardhat";
import { RCA_CONTROLLER } from "./constants";
import {
  ERC1967Proxy__factory,
  GvToken,
  GvTokenV2,
  GvTokenV2__factory,
  GvToken__factory,
} from "../src/types";
import { expect } from "chai";
import { GENESIS } from "../constants";

describe("GvTokenV2", function () {
  const contracts = {} as Contracts;
  const signers = {} as Signers;
  let bribePotAddress: string;
  let bribePotAddress2: string;
  let easeAddress: string;
  let tokenSwapAddress: string;
  beforeEach(async function () {
    //
    const accounts = await ethers.getSigners();
    signers.user = accounts[0];
    signers.gov = accounts[1];
    bribePotAddress = accounts[2].address;
    easeAddress = accounts[3].address;
    tokenSwapAddress = accounts[4].address;
    bribePotAddress2 = accounts[5].address;
    const GvTokenFactory = <GvToken__factory>(
      await ethers.getContractFactory("GvToken")
    );
    const ERC1977ProxyFactory = <ERC1967Proxy__factory>(
      await ethers.getContractFactory("ERC1967Proxy")
    );
    // Deploy gvToken
    // Validate GvToken Implementation for upgradability
    await upgrades.validateImplementation(GvTokenFactory);

    // Setting gvToken as implementation initially and we will
    // update it to proxy address later
    contracts.gvToken = await GvTokenFactory.deploy();
    const callData = contracts.gvToken.interface.encodeFunctionData(
      "initialize",
      [bribePotAddress, easeAddress, RCA_CONTROLLER, tokenSwapAddress, GENESIS]
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
  });
  it("should deploy the contract", async function () {
    const owner = await contracts.gvToken.owner();
    expect(owner === signers.user.address);
    expect(await contracts.gvToken.pot()).to.equal(bribePotAddress);
    expect(await contracts.gvToken.stakingToken()).to.equal(easeAddress);
  });
  it("should not initialize the contract", async function () {
    const addrZero = bribePotAddress;
    await expect(
      contracts.gvToken.initialize(addrZero, addrZero, addrZero, addrZero, 1)
    ).to.be.reverted;
  });
  it("should upgrade the contract", async function () {
    contracts.gvTokenV2 = <GvTokenV2>(
      await ethers.getContractAt("GvTokenV2", contracts.gvToken.address)
    );

    // v1 should not have version funciton
    await expect(contracts.gvTokenV2.version()).to.reverted;

    const GvTokenV2Factory = <GvTokenV2__factory>(
      await ethers.getContractFactory("GvTokenV2")
    );
    // Validate implementation
    await upgrades.validateImplementation(GvTokenV2Factory);

    const gvTokenV2Impl = await GvTokenV2Factory.deploy();
    await gvTokenV2Impl.deployed();

    await contracts.gvToken.upgradeTo(gvTokenV2Impl.address);

    // checking v2 deployment function
    expect(await contracts.gvTokenV2.version()).to.equal("V2");

    // checking v1 storage values
    expect(await contracts.gvTokenV2.pot()).to.equal(bribePotAddress);
    expect(await contracts.gvTokenV2.stakingToken()).to.equal(easeAddress);
  });
  it("should upgrade and reinitialize the contract", async function () {
    contracts.gvTokenV2 = <GvTokenV2>(
      await ethers.getContractAt("GvTokenV2", contracts.gvToken.address)
    );
    const GvTokenV2Factory = <GvTokenV2__factory>(
      await ethers.getContractFactory("GvTokenV2")
    );
    // Validate implementation
    await upgrades.validateImplementation(GvTokenV2Factory);

    const gvTokenV2Impl = await GvTokenV2Factory.deploy();
    await gvTokenV2Impl.deployed();

    // check initialized arguments before contract upgrade
    expect(await contracts.gvToken.pot()).to.equal(bribePotAddress);
    expect(await contracts.gvToken.genesis()).to.equal(GENESIS);
    expect(await contracts.gvToken.rcaController()).to.equal(RCA_CONTROLLER);
    expect(await contracts.gvToken.tokenSwap()).to.equal(tokenSwapAddress);
    expect(await contracts.gvToken.stakingToken()).to.equal(easeAddress);

    const callData = gvTokenV2Impl.interface.encodeFunctionData(
      "reinitialize",
      [bribePotAddress2]
    );

    await expect(
      contracts.gvToken.upgradeToAndCall(gvTokenV2Impl.address, callData)
    )
      .to.emit(contracts.gvToken, "Initialized")
      .withArgs(2);
    // check initialized arguments after contract upgrade
    // check bribe pot address after
    expect(await contracts.gvToken.pot()).to.equal(bribePotAddress2);
    // check previous args are unchanged
    expect(await contracts.gvToken.genesis()).to.equal(GENESIS);
    expect(await contracts.gvToken.rcaController()).to.equal(RCA_CONTROLLER);
    expect(await contracts.gvToken.tokenSwap()).to.equal(tokenSwapAddress);
    expect(await contracts.gvToken.stakingToken()).to.equal(easeAddress);
  });
});
