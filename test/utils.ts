import { ethers } from "hardhat";
import { providers, BigNumber } from "ethers";

import {
  isMainnetFork,
  getForkingBlockNumber,
  getMainnetUrl,
} from "../env_helpers";

export function hexSized(str: string, length: number): string {
  const raw = Buffer.from(str).toString("hex");
  const pad = "0".repeat(length * 2 - raw.length);
  return "0x" + raw + pad;
}

export function hex(str: string): string {
  return "0x" + Buffer.from(str).toString("hex");
}

export function sleep(ms: number) {
  new Promise((resolve) => setTimeout(resolve, ms));
}

export async function increase(seconds: number) {
  const signers = await ethers.getSigners();
  const signer = signers[0];
  await (signer.provider as providers.JsonRpcProvider).send(
    "evm_increaseTime",
    [seconds]
  );
}

export async function getTimestamp(): Promise<BigNumber> {
  const signers = await ethers.getSigners();
  const signer = signers[0];
  const res = await (signer.provider as providers.JsonRpcProvider).send(
    "eth_getBlockByNumber",
    ["latest", false]
  );
  return BigNumber.from(res.timestamp);
}

export function ether(amount: string): BigNumber {
  return ethers.utils.parseEther(amount);
}

export async function mine() {
  const signers = await ethers.getSigners();
  const signer = signers[0];
  await (signer.provider as providers.JsonRpcProvider).send("evm_mine", []);
}

export async function resetBlockchain() {
  const signer = (await ethers.getSigners())[0];
  const provider = signer.provider as providers.JsonRpcProvider;

  if (isMainnetFork()) {
    await provider.send("hardhat_reset", [
      {
        forking: {
          blockNumber: getForkingBlockNumber(),
          jsonRpcUrl: getMainnetUrl(),
        },
      },
    ]);
  } else {
    await (signer.provider as providers.JsonRpcProvider).send(
      "hardhat_reset",
      []
    );
  }
}
