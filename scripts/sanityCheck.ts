import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { DEPLOYED_ADDRESSES } from "../constants";
import { GovernorBravoDelegate, GvToken, Timelock } from "../src/types";
import { Contracts } from "../test/types";
import { TIME_IN_SECS } from "../test/utils";

type ProposalArgs = {
  targets: string[];
  values: BigNumber[];
  signatures: string[];
  calldatas: string[];
  description: string;
};

const HOUR = BigNumber.from(3600);
// approx blocks in hour
const BLOCKS_IN_HOUR = HOUR.div(15);

const WITHDRAWAL_DELAY = TIME_IN_SECS.week;
// voting period in blocks 3 days(1 day = 5760 blocks approx)
const VOTING_PERIOD = 5760 * 3;
// execution delay in secs
const TIMELOCK_DELAY = TIME_IN_SECS.day * 2;
async function main() {
  const contracts = {} as Contracts;
  contracts.easeGovernance = <GovernorBravoDelegate>(
    await ethers.getContractAt(
      "GovernorBravoDelegate",
      DEPLOYED_ADDRESSES.governance
    )
  );
  const forwardTime = async (time: BigNumber) => {
    //
    await ethers.provider.send("evm_increaseTime", [
      ethers.utils.hexValue(time),
    ]);
  };
  const forwardBlock = async (blockCount: BigNumber) => {
    await ethers.provider.send("evm_increaseBlocks", [
      ethers.utils.hexValue(blockCount),
    ]);
  };

  contracts.gvToken = <GvToken>(
    await ethers.getContractAt("GvToken", DEPLOYED_ADDRESSES.gvToken)
  );

  contracts.timelock = <Timelock>(
    await ethers.getContractAt("Timelock", DEPLOYED_ADDRESSES.timelock)
  );

  const signer = (await ethers.getSigners())[0];

  const withdrawalDelayCallData =
    contracts.gvToken.interface.encodeFunctionData("setDelay", [
      WITHDRAWAL_DELAY,
    ]);
  const votingPeriodCallData =
    contracts.easeGovernance.interface.encodeFunctionData("_setVotingPeriod", [
      VOTING_PERIOD,
    ]);
  const timelockDelayCallData = contracts.timelock.interface.encodeFunctionData(
    "setDelay",
    [TIMELOCK_DELAY]
  );

  const voteDelegatedTo = await contracts.gvToken.delegates(signer.address);
  if (voteDelegatedTo === ethers.constants.AddressZero) {
    // delegate to self
    await contracts.gvToken.delegate(signer.address);
  }

  // Start gvToken set withdrawal delay vote
  let proposalArgs: ProposalArgs = {
    calldatas: [withdrawalDelayCallData],
    description: "Update withdrawal delay",
    signatures: [""],
    targets: [contracts.gvToken.address],
    values: [BigNumber.from(0)],
  };
  console.log("Proposing to update withdrawal delay......");
  await contracts.easeGovernance
    .connect(signer)
    .propose(
      proposalArgs.targets,
      proposalArgs.values,
      proposalArgs.signatures,
      proposalArgs.calldatas,
      proposalArgs.description
    );
  let proposalId = await contracts.easeGovernance.proposalCount();

  // forward block
  await forwardBlock(BigNumber.from(2));
  // Vote yes
  console.log("Casting vote for withdrawal delay change......");
  await contracts.easeGovernance
    .connect(signer)
    .castVote(proposalId, BigNumber.from(1));

  //   // Wait 1 hour and forward block
  await forwardTime(HOUR.add(100));
  await forwardBlock(BigNumber.from(BLOCKS_IN_HOUR.add(10)));

  // queue it
  console.log("Queue proposal for withdrawal delay change......");
  await contracts.easeGovernance.connect(signer).queue(proposalId);
  // Start vote for timelock + voting period increases
  proposalArgs = {
    calldatas: [votingPeriodCallData, timelockDelayCallData],
    description: "Update voting period and timelock delay",
    signatures: ["", ""],
    targets: [contracts.easeGovernance.address, contracts.timelock.address],
    values: [BigNumber.from(0), BigNumber.from(0)],
  };
  console.log("Porposing to update voting period and timelock delay......");
  await contracts.easeGovernance
    .connect(signer)
    .propose(
      proposalArgs.targets,
      proposalArgs.values,
      proposalArgs.signatures,
      proposalArgs.calldatas,
      proposalArgs.description
    );
  proposalId = await contracts.easeGovernance.proposalCount();
  //   mine a block
  await forwardBlock(BigNumber.from(2));
  // Vote yes
  console.log("Voting Yes to update voting period and timelock delay......");
  await contracts.easeGovernance
    .connect(signer)
    .castVote(proposalId, BigNumber.from(1));

  // Wait 1 hour and forward block,
  await forwardTime(HOUR.add(100));
  await forwardBlock(BigNumber.from(BLOCKS_IN_HOUR.add(10)));
  // queue it
  console.log(
    "Queue proposal to update voting period and timelock delay......"
  );
  await contracts.easeGovernance.connect(signer).queue(proposalId);
  // Withdraw gvTokens
  const totalDeposit = await contracts.gvToken.totalDeposit(signer.address);
  await contracts.gvToken.connect(signer).withdrawRequest(totalDeposit);

  // Execute all
  // Wait 1 hour and forward block,
  await forwardTime(HOUR.add(100));
  await forwardBlock(BigNumber.from(BLOCKS_IN_HOUR.add(10)));
  //   execute first proposal
  console.log("Execute withdrawal delay proposal......");
  await contracts.easeGovernance.connect(signer).execute(proposalId.sub(1));
  //   execute second proposal
  console.log("Execute Voting period change and timelock delay proposal......");
  await contracts.easeGovernance.connect(signer).execute(proposalId);

  // VERIFY
  const withdrawalDelay = await contracts.gvToken.withdrawalDelay();
  const timelockDelay = await contracts.timelock.delay();
  const votingPeriod = await contracts.easeGovernance.votingPeriod();
  if (
    withdrawalDelay.eq(WITHDRAWAL_DELAY) &&
    timelockDelay.eq(TIMELOCK_DELAY) &&
    votingPeriod.eq(VOTING_PERIOD)
  ) {
    console.log("Votes executed and updated successfully!");
  } else {
    console.log("!!!!!! Update Failed !!!!!!");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
