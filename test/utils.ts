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

export async function fastForward(seconds: number) {
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

export async function getBlockNumber(): Promise<BigNumber> {
  const signers = await ethers.getSigners();
  const signer = signers[0];
  const res = await (signer.provider as providers.JsonRpcProvider).send(
    "eth_getBlockByNumber",
    ["latest", false]
  );
  return BigNumber.from(res.number);
}

export async function mineNBlocks(n: number) {
  const signers = await ethers.getSigners();
  const signer = signers[0];
  await (signer.provider as providers.JsonRpcProvider).send("hardhat_mine", [
    ethers.utils.hexlify(n),
  ]);
}

export async function mine() {
  const signers = await ethers.getSigners();
  const signer = signers[0];
  await (signer.provider as providers.JsonRpcProvider).send("evm_mine", []);
}

export async function resetBlockchain(blockNumber = 0) {
  const signer = (await ethers.getSigners())[0];
  const provider = signer.provider as providers.JsonRpcProvider;

  if (isMainnetFork()) {
    await provider.send("hardhat_reset", [
      {
        forking: {
          blockNumber: blockNumber || getForkingBlockNumber(),
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

export const TIME_IN_SECS = {
  day: 60 * 60 * 24,
  week: 60 * 60 * 24 * 7,
  month: 60 * 60 * 24 * 30,
  year: 60 * 60 * 24 * 7 * 52,
};
