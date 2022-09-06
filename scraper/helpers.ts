import { BigNumber, ethers, providers } from "ethers";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

import * as path from "path";
import fs from "fs-extra";
import csv from "csvtojson";
import { getProviderRpc } from "../env_helpers";
import { MAINNET_ADDRESSES } from "../test/constants";
import erc20Artifact from "../artifacts/contracts/interfaces/IERC20.sol/IERC20Permit.json";
import { EaseToken } from "../src/types";
import { TransferEvent } from "../src/types/contracts/core/EaseToken";
import {
  VARMOR_BONUS_START,
  VARMOR_BLOCK_CREATION_NUMBER,
  SCALING_FACTOR,
  VARMOR_EXCHANGE_RATE,
} from "./constants";

dayjs.extend(relativeTime);

import type {
  AccountEventDetail,
  Balance,
  BalanceNode,
  HolderDetail,
  HolderDetailCSV,
} from "./types";

const { JsonRpcProvider } = providers;

export async function getVarmorHolders(): Promise<HolderDetail[]> {
  const csvFilePath = path.resolve(
    __dirname,
    "scrapedData",
    "vArmorHolders.csv"
  );
  const data = (await csv().fromFile(csvFilePath)) as HolderDetailCSV[];
  const holders: HolderDetail[] = [];
  for (const item of data) {
    // ignore wallets with balance in decimals
    if (!item.Balance.includes("E-")) {
      const balanceDetail = {} as HolderDetail;
      balanceDetail.account = item.HolderAddress;
      balanceDetail.balanceStored = item.Balance;
      holders.push(balanceDetail);
    }
  }
  return holders;
}

export async function getProvider() {
  return new JsonRpcProvider(getProviderRpc());
}

export async function getVarmorContract() {
  const provider = await getProvider();

  return new ethers.Contract(
    MAINNET_ADDRESSES.vArmor,
    erc20Artifact.abi,
    provider
  ) as EaseToken;
}

export async function getTransferEvents(
  address: string,
  toBlock: number | string = "latest"
) {
  const fromBlock = VARMOR_BLOCK_CREATION_NUMBER;

  const token = await getVarmorContract();
  const transferFilter = token.filters.Transfer(address);
  const recieveFilter = token.filters.Transfer(null, address);

  const sendEvents = await token.queryFilter(
    transferFilter,
    fromBlock, // Contract creation block
    toBlock
  );
  const recieveEvents = await token.queryFilter(
    recieveFilter,
    fromBlock,
    toBlock
  );
  return { sendEvents, recieveEvents };
}

export async function getNormalizedStartTime(
  recieveEvents: TransferEvent[],
  startAddress = ethers.constants.AddressZero
): Promise<BigNumber> {
  const provider = await getProvider();
  let numerator: BigNumber = BigNumber.from(0);
  let denominator: BigNumber = BigNumber.from(0);
  for (const event of recieveEvents) {
    const [from, to, amount] = event.args;

    const block = await provider.getBlock(event.blockNumber);
    const timestamp = BigNumber.from(block.timestamp);
    if (from === ethers.constants.AddressZero) {
      // get timestamp of that event
      numerator = numerator.add(timestamp.mul(amount));
      denominator = denominator.add(amount);
    } else {
      // get the normalized time of vArmor transferrer at current block
      // and use it as timestamp for the wallet recieving vArmror
      // if we are inside this conditional we need to get
      // the normalized start time of vArmor sender at
      // this block and multiply it with transferAmount

      // this condidtional avoids us from getting into
      // infinite loop if there's back and forth transaction
      // between two wallets
      if (startAddress !== to) {
        const _startAddress =
          startAddress === ethers.constants.AddressZero ? to : startAddress;
        const { recieveEvents } = await getTransferEvents(from);
        const normalizedTimeOfSender = await getNormalizedStartTime(
          recieveEvents,
          _startAddress
        );
        numerator = numerator.add(normalizedTimeOfSender.mul(amount));
        denominator = denominator.add(amount);
      }
    }
  }

  return numerator.div(denominator);
}

export function getBalance(
  recieveEvents: TransferEvent[],
  sendEvents: TransferEvent[]
): BigNumber {
  let balance = BigNumber.from(0);
  // include recieve events
  for (const event of recieveEvents) {
    balance = balance.add(event.args[2]);
  }
  for (const event of sendEvents) {
    balance = balance.sub(event.args[2]);
  }
  return balance;
}

export async function getFormattedBalanceNodes(): Promise<BalanceNode[]> {
  // read holdersEvents.json
  const holdersEventsPath = path.resolve(
    __dirname,
    "scrapedData",
    "holdersEvents.json"
  );
  const holdersEventsData = fs.readFileSync(holdersEventsPath, "utf-8");
  const holdersEventsDetails = JSON.parse(
    holdersEventsData
  ) as AccountEventDetail[];
  const balances: BalanceNode[] = [];
  for (const holderDetail of holdersEventsDetails) {
    console.log(`Creating Balance node for: ${holderDetail.account}`);
    const balance = getBalance(
      holderDetail.recieveEvents,
      holderDetail.sendEvents
    );
    const normalizedStartTime = await getNormalizedStartTime(
      holderDetail.recieveEvents
    );

    // check if normalized time is before april 14th 2022
    // if true use april 14th instead
    const depositStart = normalizedStartTime.lt(VARMOR_BONUS_START)
      ? VARMOR_BONUS_START
      : normalizedStartTime;
    const userBalance: BalanceNode = {
      account: holderDetail.account,
      depositStart,
      amount: balance,
    };
    balances.push(userBalance);
  }
  return balances;
}

export function getBalanceNodes(): BalanceNode[] {
  //   write all the details to a json file
  // fetch  balanceNodes
  const balanceNodesPath = path.resolve(
    __dirname,
    "formattedData",
    "balanceNodes.json"
  );
  const formattedBalNodesData = fs.readFileSync(balanceNodesPath, "utf-8");
  const storedBalNodes = JSON.parse(formattedBalNodesData) as Balance[];
  const balanceNodes: BalanceNode[] = [];
  for (const balNode of storedBalNodes) {
    const node: BalanceNode = {
      account: balNode.account,
      depositStart: BigNumber.from(balNode.depositStart),
      amount: BigNumber.from(balNode.amount),
    };
    node.amount = node.amount.mul(VARMOR_EXCHANGE_RATE).div(SCALING_FACTOR);
    balanceNodes.push(node);
  }
  return balanceNodes;
}
