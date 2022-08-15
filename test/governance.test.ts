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
  let userAddress: string;
  let bobAddress: string;
  let aliceAddress: string;
  let implAddress: string;
  before(async function () {
    const accounts = await ethers.getSigners();
    signers.deployer = accounts[0];
    signers.user = accounts[1];
    signers.guardian = accounts[2];
    signers.alice = accounts[3];
    signers.bob = accounts[4];
    signers.briber = accounts[5];
    signers.easeDeployer = accounts[6];
    signers.otherAccounts = accounts.slice(7);
    // initialize addresses
    userAddress = signers.user.address;
    bobAddress = signers.bob.address;
    aliceAddress = signers.alice.address;
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
    const deployerNonce = await signers.deployer.getTransactionCount();
    const gvTokenAddress = getContractAddress({
      from: signers.deployer.address,
      nonce: deployerNonce,
    });
    const bribePotAddress = getContractAddress({
      from: signers.deployer.address,
      nonce: deployerNonce + 1,
    });

    const govAddress = getContractAddress({
      from: signers.deployer.address,
      nonce: deployerNonce + 4,
    });

    const GENESIS = (await getTimestamp()).sub(TIME_IN_SECS.year);
    contracts.ease = await EaseTokenFactory.connect(
      signers.easeDeployer
    ).deploy();
    const easeAddress = contracts.ease.address;
    // 1st transaction
    contracts.gvToken = await GvTokenFactory.connect(signers.deployer).deploy(
      bribePotAddress,
      easeAddress,
      RCA_CONTROLLER,
      govAddress,
      GENESIS
    );

    // 2nd transaction
    contracts.bribePot = await BribePotFactory.connect(signers.deployer).deploy(
      gvTokenAddress,
      easeAddress,
      RCA_CONTROLLER
    );
    // 3rd transaction
    contracts.timelock = await TimelockFactory.connect(signers.deployer).deploy(
      signers.guardian.address,
      TIME_IN_SECS.day * 2
    );
    // 4th transaction
    const bravoDelegate = await GovernorBravoDelegateFactory.connect(
      signers.deployer
    ).deploy();
    implAddress = bravoDelegate.address;
    // 5th transaction
    const bravoDelegator = await GovernorBravoDelegatorFactory.connect(
      signers.deployer
    ).deploy(
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

    // transfer EASE token to wallets
    await contracts.ease.transfer(userAddress, parseEther("100000"));
    await contracts.ease.transfer(aliceAddress, parseEther("100000"));
    await contracts.ease.transfer(bobAddress, parseEther("100000"));
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
  // TESTS
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
  describe.only("propose()", function () {
    // PROPOSAL ARGS

    let targets: string[];
    let values: BigNumber[];
    let signatures: string[];
    let calldatas: string[];
    let description: string;
    this.beforeEach(async function () {
      targets = [contracts.gvToken.address];
      values = [parseEther("0")];
      signatures = [""];
      calldatas = [
        contracts.gvToken.interface.encodeFunctionData("setPower", [
          randomBytes(32),
        ]),
      ];
      description = "Merkle root for vArmor holders";
      // deposit to gvEase for the user
      const userDepositVal = parseEther("20000");
      await depositFor(signers.user, userDepositVal);
      await contracts.gvToken.connect(signers.user).delegate(userAddress);

      // deposit for alice
      const aliceDepositVal = parseEther("100");
      await depositFor(signers.alice, aliceDepositVal);
      await contracts.gvToken.connect(signers.alice).delegate(aliceAddress);
    });
    it("should fail if user submitting proposal doesnt have enough gvPower", async function () {
      // bob doesn't have any gvPower
      await expect(
        contracts.easeGovernance
          .connect(signers.bob)
          .propose(targets, values, signatures, calldatas, description)
      ).to.revertedWith(
        "GovernorBravo::propose: proposer votes below proposal threshold"
      );
      // alice has only about 100 gvEASE
      await expect(
        contracts.easeGovernance
          .connect(signers.alice)
          .propose(targets, values, signatures, calldatas, description)
      ).to.revertedWith(
        "GovernorBravo::propose: proposer votes below proposal threshold"
      );
    });
    it("should allow user to submit a proposal", async function () {
      // do something anon

      await contracts.easeGovernance
        .connect(signers.user)
        .propose(targets, values, signatures, calldatas, description);
    });
  });
});
