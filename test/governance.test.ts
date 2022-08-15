import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import exp from "constants";
import { BigNumber } from "ethers";
import { getContractAddress, parseEther, randomBytes } from "ethers/lib/utils";
import { ethers } from "hardhat";
import {
  GovernorBravoDelegate__factory,
  GovernorBravoDelegator__factory,
  Timelock__factory,
} from "../src/types";
import {
  BribePot__factory,
  EaseToken__factory,
  GvToken__factory,
} from "../src/types/factories/contracts/core";
import { RCA_CONTROLLER, RCA_VAULT } from "./constants";
import { getPermitSignature } from "./helpers";
import { Contracts, Signers } from "./types";
import { getTimestamp, TIME_IN_SECS } from "./utils";

// wait 1 block before voting starts
const VOTING_DELAY = BigNumber.from(1);
// voting period in blocks (1 week approx)
const VOTING_PERIOD = BigNumber.from(40320);
const PROPOSAL_THRESOLD = parseEther("1000");

describe("EaseGovernance", function () {
  const contracts = {} as Contracts;
  const signers = {} as Signers;
  let implAddress: string;
  before(async function () {
    const accounts = await ethers.getSigners();
    signers.user = accounts[0];
    signers.gov = accounts[1];
    signers.guardian = accounts[2];
    signers.alice = accounts[3];
    signers.bob = accounts[4];
    signers.briber = accounts[5];
    signers.easeDeployer = accounts[6];
    signers.otherAccounts = accounts.slice(7);
  });
  beforeEach(async function () {
    const EaseTokenFactory = <EaseToken__factory>(
      await ethers.getContractFactory("EaseToken")
    );
    const GvTokenFactory = <GvToken__factory>(
      await ethers.getContractFactory("GvToken")
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
    const userNonce = await signers.user.getTransactionCount();
    const gvTokenAddress = getContractAddress({
      from: signers.user.address,
      nonce: userNonce,
    });
    const bribePotAddress = getContractAddress({
      from: signers.user.address,
      nonce: userNonce + 1,
    });
    const GENESIS = (await getTimestamp()).sub(TIME_IN_SECS.year);
    contracts.ease = await EaseTokenFactory.connect(
      signers.easeDeployer
    ).deploy();
    const easeAddress = contracts.ease.address;

    contracts.gvToken = await GvTokenFactory.deploy(
      bribePotAddress,
      easeAddress,
      RCA_CONTROLLER,
      signers.gov.address,
      GENESIS
    );

    contracts.bribePot = await BribePotFactory.deploy(
      gvTokenAddress,
      easeAddress,
      RCA_CONTROLLER
    );
    contracts.timelock = await TimelockFactory.deploy(
      signers.guardian.address,
      TIME_IN_SECS.day * 2
    );
    const bravoDelegate = await GovernorBravoDelegateFactory.deploy();
    implAddress = bravoDelegate.address;
    const bravoDelegator = await GovernorBravoDelegatorFactory.deploy(
      contracts.timelock.address,
      contracts.gvToken.address,
      signers.guardian.address,
      bravoDelegate.address,
      VOTING_PERIOD,
      VOTING_DELAY,
      PROPOSAL_THRESOLD
    );
    contracts.easeGovernance = await ethers.getContractAt(
      "GovernorBravoDelegate",
      bravoDelegator.address
    );
  });

  async function depositFor(user: SignerWithAddress, value: BigNumber) {
    const deadline = (await getTimestamp()).add(1000);
    const spender = contracts.gvToken.address;
    const { v, r, s } = await getPermitSignature({
      signer: user,
      token: contracts.ease,
      value,
      deadline,
      spender,
    });
    await contracts.gvToken
      .connect(user)
      ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
        deadline,
        v,
        r,
        s,
      });
  }

  async function bribeFor(
    briber: SignerWithAddress,
    bribePerWeek: BigNumber,
    numOfWeeks: number
  ) {
    // add bribe to bribe pot
    const rcaVaultAddress = RCA_VAULT;
    const totalBribeAmt = bribePerWeek.mul(numOfWeeks);
    const spender = contracts.bribePot.address;
    const deadline = (await getTimestamp()).add(1000);
    const { v, r, s } = await getPermitSignature({
      signer: briber,
      token: contracts.ease,
      value: totalBribeAmt,
      deadline,
      spender,
    });
    // add bribe amount to pot
    await contracts.bribePot
      .connect(briber)
      .bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
        deadline,
        v,
        r,
        s,
      });
  }
  describe("#initialState", function () {
    it("should initialize contract properly", async function () {
      expect(await contracts.easeGovernance.admin()).to.equal(
        signers.guardian.address
      );

      expect(await contracts.easeGovernance.name()).to.equal(
        "Ease Governor Bravo"
      );

      expect(await contracts.easeGovernance.timelock()).to.equal(
        contracts.timelock.address
      );

      expect(await contracts.easeGovernance.gvEase()).to.equal(
        contracts.gvToken.address
      );

      expect(await contracts.easeGovernance.implementation()).to.equal(
        implAddress
      );

      expect(await contracts.easeGovernance.votingDelay()).to.equal(
        VOTING_DELAY
      );

      expect(await contracts.easeGovernance.votingPeriod()).to.equal(
        VOTING_PERIOD
      );

      expect(await contracts.easeGovernance.proposalThreshold()).to.equal(
        PROPOSAL_THRESOLD
      );
    });
  });
});
