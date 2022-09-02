import { Contracts, Signers } from "./types";
import { ethers, upgrades } from "hardhat";
import { RCA_CONTROLLER } from "./constants";
import { getTimestamp } from "./utils";
import {
  GvToken,
  GvTokenV2,
  GvTokenV2__factory,
  GvToken__factory,
} from "../src/types";
import { expect } from "chai";

describe("GvTokenV2", function () {
  const contracts = {} as Contracts;
  const signers = {} as Signers;
  let bribePotAddress: string;
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
    const GENESIS = await getTimestamp();
    const GvTokenFactory = <GvToken__factory>(
      await ethers.getContractFactory("GvToken")
    );
    contracts.gvToken = <GvToken>(
      await upgrades.deployProxy(
        GvTokenFactory,
        [
          bribePotAddress,
          easeAddress,
          RCA_CONTROLLER,
          tokenSwapAddress,
          GENESIS,
        ],
        { kind: "uups" }
      )
    );
  });
  it("should deploy the contract", async function () {
    const owner = await contracts.gvToken.owner();
    expect(owner === signers.user.address);
    expect(await contracts.gvToken.pot()).to.equal(bribePotAddress);
    expect(await contracts.gvToken.stakingToken()).to.equal(easeAddress);
  });
  it("should initialize the contract", async function () {
    const addrZero = bribePotAddress;
    await expect(
      contracts.gvToken.initialize(addrZero, addrZero, addrZero, addrZero, 1)
    ).to.be.reverted;
  });
  it("should upgrade the contract", async function () {
    const GvTokenV2Factory = <GvTokenV2__factory>(
      await ethers.getContractFactory("GvTokenV2")
    );
    contracts.gvTokenV2 = <GvTokenV2>(
      await upgrades.upgradeProxy(contracts.gvToken.address, GvTokenV2Factory)
    );

    // checking if gvToken address remains the same
    expect(contracts.gvToken.address).to.equal(contracts.gvTokenV2.address);
    // checking v2 deployment function
    expect(await contracts.gvTokenV2.version()).to.equal("V2");

    // checking v1 storage values
    expect(await contracts.gvTokenV2.pot()).to.equal(bribePotAddress);
    expect(await contracts.gvTokenV2.stakingToken()).to.equal(easeAddress);
  });
});
