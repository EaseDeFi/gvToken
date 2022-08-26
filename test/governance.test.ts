import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import { ethers, upgrades } from "hardhat";
import {
  GovernorBravoDelegate__factory,
  GovernorBravoDelegator__factory,
  GvToken,
  Timelock__factory,
} from "../src/types";
import {
  BribePot__factory,
  EaseToken__factory,
  GvToken__factory,
} from "../src/types/factories/contracts/core";
import { RCA_CONTROLLER } from "./constants";
import { getPermitSignature } from "./helpers";
import { Contracts, Signers } from "./types";
import {
  fastForward,
  getTimestamp,
  mine,
  mineNBlocks,
  TIME_IN_SECS,
} from "./utils";

import { VOTING_DELAY, VOTING_PERIOD, PROPOSAL_THRESOLD } from "../constants";

chai.use(solidity);

describe("EaseGovernance", function () {
  const contracts = {} as Contracts;
  const signers = {} as Signers;
  let userAddress: string;
  let bobAddress: string;
  let aliceAddress: string;
  let implAddress: string;
  // Proposal args
  let targets: string[];
  let values: BigNumber[];
  let signatures: string[];
  let calldatas: string[];
  let description: string;
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
    ).deploy(govAddress);
    const easeAddress = contracts.ease.address;
    // As we will not call depositWithVarmor or depositWithArmor
    const tokenSwapAddress = easeAddress;
    // 1st transaction
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

    // 2nd transaction
    contracts.bribePot = await BribePotFactory.connect(signers.deployer).deploy(
      gvTokenAddress,
      easeAddress,
      RCA_CONTROLLER
    );
    // 3rd transaction
    contracts.timelock = await TimelockFactory.connect(signers.deployer).deploy(
      govAddress,
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
    await contracts.ease.transfer(userAddress, parseEther("1000000"));
    await contracts.ease.transfer(aliceAddress, parseEther("1000000"));
    await contracts.ease.transfer(bobAddress, parseEther("1000000"));

    // initialize proposal args
    targets = [contracts.timelock.address];
    values = [parseEther("0")];
    signatures = [""];
    calldatas = [
      contracts.timelock.interface.encodeFunctionData("setPendingAdmin", [
        signers.guardian.address,
      ]),
    ];
    description = "Set pending admin of timelock";
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
  describe("propose()", function () {
    // PROPOSAL ARGS

    this.beforeEach(async function () {
      // deposit to gvEase for the user
      const userDepositVal = parseEther("500000");
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
      // alice has only about 100 gvEASE and proposal threshold is 1000 EASE
      await expect(
        contracts.easeGovernance
          .connect(signers.alice)
          .propose(targets, values, signatures, calldatas, description)
      ).to.revertedWith(
        "GovernorBravo::propose: proposer votes below proposal threshold"
      );
    });
    it("should allow user with enough votes to submit a proposal", async function () {
      await contracts.easeGovernance
        .connect(signers.user)
        .propose(targets, values, signatures, calldatas, description);
      expect(await contracts.easeGovernance.proposalCount()).to.equal(1);
    });
    it("should allow whitelisted account to submit a proposal", async function () {
      const timeNow = await getTimestamp();
      await contracts.easeGovernance
        .connect(signers.guardian)
        ._setWhitelistAccountExpiration(
          bobAddress,
          timeNow.add(TIME_IN_SECS.month)
        );
      // bob has been whitelisted and should be able to submit
      // a proposal
      await contracts.easeGovernance
        .connect(signers.bob)
        .propose(targets, values, signatures, calldatas, description);
      expect(await contracts.easeGovernance.proposalCount()).to.equal(1);
    });
  });
  describe("queue()", function () {
    beforeEach(async function () {
      // deposit to gvEase for the user
      const userDepositVal = parseEther("500000");
      await depositFor(signers.user, userDepositVal);
      await contracts.gvToken.connect(signers.user).delegate(userAddress);

      // deposit for alice
      const aliceDepositVal = parseEther("100");
      await depositFor(signers.alice, aliceDepositVal);
      await contracts.gvToken.connect(signers.alice).delegate(aliceAddress);
    });
    it("should not queue proposal if not succeeded", async function () {
      // submit a proposal
      await contracts.easeGovernance
        .connect(signers.user)
        .propose(targets, values, signatures, calldatas, description);
      await expect(contracts.easeGovernance.queue(1)).to.be.reverted;
    });
    it("should queue a proposal if succeeded", async function () {
      //
      await contracts.easeGovernance
        .connect(signers.user)
        .propose(targets, values, signatures, calldatas, description);
      // mine a block
      await mine();
      // cast vote
      // as the user has 500K votes and threshold is 400k it should be enough
      const proposalId = await contracts.easeGovernance.proposalCount();
      await contracts.easeGovernance
        .connect(signers.user)
        .castVote(proposalId, 1);

      // mine upto voting period ends
      await mineNBlocks(VOTING_PERIOD.toNumber());

      // queue transaction
      await contracts.easeGovernance
        .connect(signers.guardian)
        .queue(proposalId);
      // if we reach here means we successfully queued the transaction
    });
  });
  describe("execute()", function () {
    beforeEach(async function () {
      // deposit to gvEase for the user
      const userDepositVal = parseEther("500000");
      await depositFor(signers.user, userDepositVal);
      await contracts.gvToken.connect(signers.user).delegate(userAddress);

      // deposit for alice
      const aliceDepositVal = parseEther("600000");
      await depositFor(signers.alice, aliceDepositVal);
      await contracts.gvToken.connect(signers.alice).delegate(aliceAddress);

      // transfer ownership of gvEase from deployer to timelock
      await contracts.gvToken.transferOwnership(contracts.timelock.address);
    });
    it("should execute a proposal if conditions are met", async function () {
      await contracts.easeGovernance
        .connect(signers.user)
        .propose(targets, values, signatures, calldatas, description);
      // mine a block
      await mine();
      // cast vote
      // as the user has 500K votes and threshold is 400k it should be enough
      const proposalId = await contracts.easeGovernance.proposalCount();
      await contracts.easeGovernance
        .connect(signers.user)
        .castVote(proposalId, 1);

      // mine upto voting period ends
      await mineNBlocks(VOTING_PERIOD.toNumber());

      // queue transaction
      await contracts.easeGovernance.queue(proposalId);

      // wait for time delay
      await fastForward(TIME_IN_SECS.day * 2);
      await mine();

      expect(await contracts.timelock.pendingAdmin()).to.equal(
        ethers.constants.AddressZero
      );
      // execute transaction
      expect(await contracts.easeGovernance.execute(proposalId))
        .to.emit(contracts.easeGovernance, "ProposalExecuted")
        .withArgs(proposalId);

      // governance should set pending admin as guardian on successful
      // proposal execution
      expect(await contracts.timelock.pendingAdmin()).to.equal(
        signers.guardian.address
      );
    });
    it("should update withdrawal delay of gvToken", async function () {
      // update proposal args
      targets = [contracts.gvToken.address];
      calldatas = [
        contracts.gvToken.interface.encodeFunctionData("setDelay", [
          TIME_IN_SECS.month,
        ]),
      ];
      description = "Set withdrawal delay to one month";

      // Submit a proposal
      await contracts.easeGovernance
        .connect(signers.user)
        .propose(targets, values, signatures, calldatas, description);
      // mine a block
      await mine();
      // cast vote
      // as the user has 500K votes and threshold is 400k it should be enough
      const proposalId = await contracts.easeGovernance.proposalCount();
      await contracts.easeGovernance
        .connect(signers.user)
        .castVote(proposalId, 1);

      // mine upto voting period ends
      await mineNBlocks(VOTING_PERIOD.toNumber());

      // queue transaction
      await contracts.easeGovernance.queue(proposalId);

      // wait for time delay
      await fastForward(TIME_IN_SECS.day * 2);
      await mine();
      // withdrawal delay should be 1 week
      expect(await contracts.gvToken.withdrawalDelay()).to.equal(
        TIME_IN_SECS.week
      );
      // execute transaction
      expect(await contracts.easeGovernance.execute(proposalId))
        .to.emit(contracts.easeGovernance, "ProposalExecuted")
        .withArgs(proposalId);

      // governance should update withdrawal delay to 4 Weeks after
      // successful proposal execution. The reason being 4 weeks instead
      // of 1 month is that withdrawal delay is mod of 1 week
      expect(await contracts.gvToken.withdrawalDelay()).to.equal(
        TIME_IN_SECS.week * 4
      );
    });
  });
  describe("cancel()", function () {
    let proposalId: BigNumber;
    beforeEach(async function () {
      // deposit to gvEase for the user
      const userDepositVal = parseEther("500000");
      await depositFor(signers.user, userDepositVal);
      await contracts.gvToken.connect(signers.user).delegate(userAddress);

      // deposit for alice
      const aliceDepositVal = parseEther("600000");
      await depositFor(signers.alice, aliceDepositVal);
      await contracts.gvToken.connect(signers.alice).delegate(aliceAddress);

      await contracts.easeGovernance
        .connect(signers.alice)
        .propose(targets, values, signatures, calldatas, description);
      // mine a block
      await mine();
      // cast vote
      // as the user has 500K votes and threshold is 400k it should be enough
      proposalId = await contracts.easeGovernance.proposalCount();
      await contracts.easeGovernance
        .connect(signers.user)
        .castVote(proposalId, 1);

      // mine upto voting period ends
      await mineNBlocks(VOTING_PERIOD.toNumber());

      // queue transaction
      await contracts.easeGovernance.queue(proposalId);

      // wait for time delay
      await fastForward(TIME_IN_SECS.day * 2);
      await mine();
    });
    it("should allow admin to cancel a proposal", async function () {
      // cancle proposal
      await contracts.easeGovernance
        .connect(signers.guardian)
        .cancel(proposalId);
      const proposal = await contracts.easeGovernance.proposals(proposalId);

      expect(proposal.canceled).to.be.true;
    });
    it("should allow porposer to cancel the proposal", async function () {
      // cancle proposal
      await contracts.easeGovernance.connect(signers.alice).cancel(proposalId);
      const proposal = await contracts.easeGovernance.proposals(proposalId);

      expect(proposal.canceled).to.be.true;
    });
    it("should not allow users to cancle the proposal", async function () {
      await expect(
        contracts.easeGovernance.connect(signers.user).cancel(proposalId)
      ).to.be.reverted;
    });
  });
  describe("_setQuorumVotes()", function () {
    beforeEach(async function () {
      // deposit to gvEase for the user
      const userDepositVal = parseEther("500000");
      await depositFor(signers.user, userDepositVal);

      // deposit for alice
      const aliceDepositVal = parseEther("600000");
      await depositFor(signers.alice, aliceDepositVal);
    });
    it("should update quorumVotes", async function () {
      const totalSupply = await contracts.gvToken.totalSupply();
      const newQuorumVotes = totalSupply.mul(10).div(100);
      const oldQuorumVotes = await contracts.easeGovernance.quorumVotes();
      await expect(
        contracts.easeGovernance
          .connect(signers.guardian)
          ._setQuorumVotes(newQuorumVotes)
      )
        .to.emit(contracts.easeGovernance, "QuorumVotesSet")
        .withArgs(oldQuorumVotes, newQuorumVotes);
    });
    it("should fail if new quorum votes is less than 5% of gvEase total supply", async function () {
      const totalSupply = await contracts.gvToken.totalSupply();
      const newQuorumVotes = totalSupply.mul(4).div(100);
      await expect(
        contracts.easeGovernance
          .connect(signers.guardian)
          ._setQuorumVotes(newQuorumVotes)
      ).to.revertedWith(
        "GovernorBravo::_setQuorumVotes: invalid quorum amount"
      );
    });
    it("should fail if new quorum votes is more than 50% of gvEase total supply", async function () {
      const totalSupply = await contracts.gvToken.totalSupply();
      const newQuorumVotes = totalSupply.mul(51).div(100);
      await expect(
        contracts.easeGovernance
          .connect(signers.guardian)
          ._setQuorumVotes(newQuorumVotes)
      ).to.revertedWith(
        "GovernorBravo::_setQuorumVotes: invalid quorum amount"
      );
    });
  });
});
