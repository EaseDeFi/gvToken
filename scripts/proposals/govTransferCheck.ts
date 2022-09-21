import { parseEther } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { DEPLOYED_ADDRESSES } from "../../constants";
import { IERC20 } from "../../src/types";
import { MAINNET_ADDRESSES, RCA_CONTROLLER } from "../../test/constants";
import { Contracts } from "../../test/types";
import { getActiveRcaVaults } from "./helpers";
(async function main() {
  //********************** INITIATE CONTRACTS *******************
  const contracts = {} as Contracts;

  contracts.armor = <IERC20>(
    await ethers.getContractAt("IERC20", MAINNET_ADDRESSES.armor)
  );

  const PENDING_OWNER_LOCATION = 6;
  const activeRcaVaults = getActiveRcaVaults();
  const targets = [MAINNET_ADDRESSES.armor, RCA_CONTROLLER, ...activeRcaVaults];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];

    if (i > 0) {
      // check for pending gov update
      let pendingOwnerStorageLocation = PENDING_OWNER_LOCATION;
      if (i === 1) {
        pendingOwnerStorageLocation = 1;
      }
      const _pendingOwner = await ethers.provider.getStorageAt(
        target,
        pendingOwnerStorageLocation
      );

      const pendingOwner = "0x" + _pendingOwner.slice(26);

      if (pendingOwner != DEPLOYED_ADDRESSES.timelock.toLowerCase()) {
        console.log(`Pending owner of ${target} not updated!!`);
      } else {
        if (i === 1) {
          console.log("Rca Controller pending gov updated successfully!");
        } else {
          console.log(`RCA Vault ${target} pending gov updated successfully!`);
        }
      }
    } else {
      // check balance
      console.log("Testing ease timelock balance....");
      const expectedBalance = parseEther("400000000");
      const timelockArmorBalance = await contracts.armor.balanceOf(
        DEPLOYED_ADDRESSES.timelock
      );
      if (!timelockArmorBalance.gte(expectedBalance)) {
        console.log("proposal did not update easeTimelock balance");
      } else {
        console.log("Ease timelock armor balance updated successfully");
      }
    }
  }
})();
