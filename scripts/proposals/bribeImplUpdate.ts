import "@nomiclabs/hardhat-ethers";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { DEPLOYED_ADDRESSES } from "../../constants";
import { BribePot, GovernorBravoDelegate } from "../../src/types";
import { Contracts } from "../../test/types";
import { TIME_IN_SECS } from "../../test/utils";

const UNITS_TO_FORWARD = {
  block: (TIME_IN_SECS.day * 3) / 15,
  time: 2 * TIME_IN_SECS.day,
};
export const forwardTime = async (time: BigNumber) => {
  //
  await ethers.provider.send("evm_increaseTime", [ethers.utils.hexValue(time)]);
};
export const forwardBlock = async (blockCount: BigNumber) => {
  await ethers.provider.send("evm_increaseBlocks", [
    ethers.utils.hexValue(blockCount),
  ]);
};

async function main() {
  const PROPOSAL_ID = 7;
  const contracts = {} as Contracts;
  const signers = await ethers.getSigners();
  console.log("Signer 0's balance", await signers[0].getBalance());

  contracts.easeGovernance = <GovernorBravoDelegate>(
    await ethers.getContractAt(
      "GovernorBravoDelegate",
      DEPLOYED_ADDRESSES.governance
    )
  );
  contracts.bribePot = <BribePot>(
    await ethers.getContractAt("BribePot", DEPLOYED_ADDRESSES.bribePot)
  );
  const proposal = await contracts.easeGovernance.proposals(PROPOSAL_ID);
  console.log(proposal);
  const details = await contracts.easeGovernance.getActions(PROPOSAL_ID);
  console.log(details);
  const state = await contracts.easeGovernance.state(PROPOSAL_ID);
  console.log(state);
  await contracts.easeGovernance.queue(PROPOSAL_ID);
  await forwardTime(BigNumber.from(UNITS_TO_FORWARD.time));
  await contracts.easeGovernance.execute(PROPOSAL_ID);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
