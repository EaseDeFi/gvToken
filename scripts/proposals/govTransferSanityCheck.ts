import "@nomiclabs/hardhat-ethers";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { DEPLOYED_ADDRESSES } from "../../constants";
import { GovernorBravoDelegate, IERC20, Timelock } from "../../src/types";
import { MAINNET_ADDRESSES, RCA_CONTROLLER } from "../../test/constants";
import { Contracts } from "../../test/types";
import { getActiveRcaVaults } from "./helpers";
import { config } from "dotenv";
import axios from "axios";

config();

async function main() {
  //********************** UTILITY FUNCTIONS *******************
  const forwardTime = async (time: BigNumber) => {
    await ethers.provider.send("evm_increaseTime", [
      ethers.utils.hexValue(time),
    ]);
  };
  const forwardBlock = async (blockCount: BigNumber) => {
    await ethers.provider.send("evm_increaseBlocks", [
      ethers.utils.hexValue(blockCount),
    ]);
  };

  //********************** CHECK ENV VARIABLES *******************
  const {
    TENDERLY_FORK,
    TENDERLY_USERNAME,
    TENDERLY_PROJECT,
    TENDERLY_ACCESS_KEY,
  } = process.env;
  if (
    [
      TENDERLY_ACCESS_KEY,
      TENDERLY_USERNAME,
      TENDERLY_FORK,
      TENDERLY_PROJECT,
    ].includes(undefined)
  ) {
    throw new Error("Please set the env variables correctly!");
  }
  const SIMULATE_API = `https://api.tenderly.co/api/v1/account/${TENDERLY_USERNAME}/project/${TENDERLY_PROJECT}/simulate`;

  //********************** INITIATE CONTRACTS *******************
  const contracts = {} as Contracts;
  // connect armor gov
  contracts.easeGovernance = <GovernorBravoDelegate>(
    await ethers.getContractAt(
      "GovernorBravoDelegate",
      MAINNET_ADDRESSES.armorGov
    )
  );

  contracts.armor = <IERC20>(
    await ethers.getContractAt("IERC20", MAINNET_ADDRESSES.armor)
  );
  // connect armor timelock
  contracts.timelock = <Timelock>(
    await ethers.getContractAt("Timelock", MAINNET_ADDRESSES.armorTimelock)
  );

  // ********************** INITIATE SIGNER AND FUND WALLET *******************
  const signer = (await ethers.getSigners())[0];
  const WALLETS = [signer.address];

  await ethers.provider.send("tenderly_addBalance", [
    WALLETS,
    ethers.utils.hexValue(ethers.utils.parseUnits("10", "ether").toHexString()),
  ]);

  // ********************** CHECK PENDING GOV *******************
  console.log("Checking if pending gov is empty!");
  const PENDING_OWNER_LOCATION = 6;
  const activeRcaVaults = getActiveRcaVaults();
  const targets = [MAINNET_ADDRESSES.armor, RCA_CONTROLLER, ...activeRcaVaults];

  for (let i = 1; i < targets.length; i++) {
    let pendingOwnerStorageLocation = PENDING_OWNER_LOCATION;
    const target = targets[i];
    if (i === 1) {
      pendingOwnerStorageLocation = 1;
    }
    const pendingOwner = await ethers.provider.getStorageAt(
      target,
      pendingOwnerStorageLocation
    );
    if (pendingOwner !== ethers.constants.HashZero) {
      throw new Error("Pending gov storage not empty!");
    }
  }

  const proposalId = 5;
  // const vArmorWhales = [
  //   "0xa3805113e2a86a9bf7888aba1d78e526ca680ac3",
  //   "0xa673edcb35edee169362454a53ae98a7bda55c1a",
  //   "0xa0f75491720835b36edc92d06ddc468d201e9b73",
  //   "0x4e6a82ac98e87c5acf7738fa57b5fd9ea14af932",
  // ];

  // const castVotesTxData = [
  //   contracts.easeGovernance.interface.encodeFunctionData("castVote", [
  //     proposalId,
  //     1,
  //   ]),
  //   contracts.easeGovernance.interface.encodeFunctionData("castVote", [
  //     proposalId + 1,
  //     1,
  //   ]),
  //   contracts.easeGovernance.interface.encodeFunctionData("castVote", [
  //     proposalId + 2,
  //     1,
  //   ]),
  // ];

  // const opts = {
  //   headers: {
  //     "X-Access-Key": TENDERLY_ACCESS_KEY as string,
  //   },
  // };

  // CAST VOTE
  // let block = await ethers.provider.getBlockNumber();
  // for (const whale of vArmorWhales) {
  //   const tx1 = {
  //     network_id: "1",
  //     from: whale,
  //     input: castVotesTxData[0],
  //     to: contracts.easeGovernance.address,
  //     save: true,
  //     block: block++,
  //   };
  //   await axios.post(SIMULATE_API, tx1, opts);

  //   const tx2 = {
  //     network_id: "1",
  //     from: whale,
  //     input: castVotesTxData[1],
  //     to: contracts.easeGovernance.address,
  //     save: true,
  //     block: block++,
  //   };
  //   await axios.post(SIMULATE_API, tx2, opts);

  //   const tx3 = {
  //     network_id: "1",
  //     from: whale,
  //     input: castVotesTxData[1],
  //     to: contracts.easeGovernance.address,
  //     save: true,
  //     block: block++,
  //   };

  //   await axios.post(SIMULATE_API, tx3, opts);
  // }

  const votingPeriod = await contracts.easeGovernance.votingPeriod();
  //   Wait for vote delay
  await forwardTime(votingPeriod.mul(15).add(100));
  await forwardBlock(votingPeriod.add(2));

  // queue it
  console.log("Queue proposal for governance transfer......");
  await contracts.easeGovernance.connect(signer).queue(proposalId);
  await contracts.easeGovernance.connect(signer).queue(proposalId + 1);
  await contracts.easeGovernance.connect(signer).queue(proposalId + 2);

  const timelockDelay = await contracts.timelock.delay();
  await forwardTime(timelockDelay.add(100));
  await forwardBlock(timelockDelay.div(15).add(2));

  // execute proposals
  console.log("Executing all proposals......");
  await contracts.easeGovernance.connect(signer).execute(proposalId);
  await contracts.easeGovernance.connect(signer).execute(proposalId + 1);
  await contracts.easeGovernance.connect(signer).execute(proposalId + 2);
  // VERIFY
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (i > 0) {
      // check pending governor
      const pendingOwner = await ethers.provider.getStorageAt(target, 6);
      // TODO:
      if (pendingOwner !== DEPLOYED_ADDRESSES.timelock) {
        console.log("Pending owner not updated!");
      }
    } else {
      // check balance
      const expectedBalance = parseEther("400000000");
      const timelockArmorBalance = await contracts.armor.balanceOf(
        DEPLOYED_ADDRESSES.timelock
      );
      if (!expectedBalance.eq(timelockArmorBalance)) {
        console.log("proposal did not execute correctly");
      }
    }
  }
  if (contracts.easeGovernance !== undefined) {
    console.log("Votes executed and updated successfully!");
  } else {
    console.log("!!!!!! Update Failed !!!!!!");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
