import "@nomiclabs/hardhat-ethers";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { DEPLOYED_ADDRESSES } from "../../constants";
import { IERC20, IGovernable } from "../../src/types";
import { Contracts } from "../../test/types";
import {
  MAINNET_ADDRESSES,
  RCA_CONTROLLER,
  RCA_VAULT,
} from "../../test/constants";
import { getActiveRcaVaults } from "./helpers";
import { parseEther } from "ethers/lib/utils";

type ProposalArgs = {
  targets: string[];
  values: BigNumber[];
  signatures: string[];
  calldatas: string[];
  description: string;
};

async function main() {
  const contracts = {} as Contracts;

  contracts.armor = <IERC20>(
    await ethers.getContractAt("IERC20", MAINNET_ADDRESSES.armor)
  );

  const governable = <IGovernable>(
    await ethers.getContractAt("IGovernable", RCA_VAULT)
  );

  const firstProposalArgs: ProposalArgs = {
    calldatas: [],
    targets: [],
    signatures: [],
    values: [],
    description: "First proposal",
  };
  const secondProposalArgs: ProposalArgs = {
    calldatas: [],
    targets: [],
    signatures: [],
    values: [],
    description: "Second proposal",
  };

  const thirdProposalArgs: ProposalArgs = {
    calldatas: [],
    targets: [],
    signatures: [],
    values: [],
    description: "Third proposal",
  };

  //   1. Transfer 400MM tokens to easeTimelock
  const transferArmorCallData = contracts.armor.interface.encodeFunctionData(
    "transfer",
    [DEPLOYED_ADDRESSES.timelock, parseEther("400000000")]
  );

  //   2. Transfer ownership of RCAController to easeDAO
  //   3. Transfer ownership of arNXMVault to easeDAO
  //   4. Transfer ownership of rcas to easeDAO
  const transferOwnershipCallData = governable.interface.encodeFunctionData(
    "transferOwnership",
    [DEPLOYED_ADDRESSES.timelock]
  );

  let targets = [
    MAINNET_ADDRESSES.armor,
    RCA_CONTROLLER,
    MAINNET_ADDRESSES.arNXMVault,
  ];

  const activeVaults = getActiveRcaVaults();
  targets = [...targets, ...activeVaults];

  // Proposal arguments for first proposal
  for (let i = 0; i < 10; i++) {
    firstProposalArgs.targets.push(targets[i]);
    firstProposalArgs.values.push(BigNumber.from(0));
    firstProposalArgs.signatures.push("");
    if (i === 0) {
      // add tranferCallData
      firstProposalArgs.calldatas.push(transferArmorCallData);
    } else {
      // add transferOwnershipCallData
      firstProposalArgs.calldatas.push(transferOwnershipCallData);
    }
  }

  // Proposal arguments for second proposal
  for (let i = 10; i < 20; i++) {
    secondProposalArgs.targets.push(targets[i]);
    secondProposalArgs.values.push(BigNumber.from(0));
    secondProposalArgs.signatures.push("");
    // add transferOwnershipCallData
    secondProposalArgs.calldatas.push(transferOwnershipCallData);
  }

  // Proposal arguments for third proposal
  for (let i = 20; i < targets.length; i++) {
    thirdProposalArgs.targets.push(targets[i]);
    thirdProposalArgs.values.push(BigNumber.from(0));
    thirdProposalArgs.signatures.push("");
    // add transferOwnershipCallData
    thirdProposalArgs.calldatas.push(transferOwnershipCallData);
  }

  console.log({ firstProposalArgs });
  console.log({ secondProposalArgs });
  console.log({ thirdProposalArgs });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
