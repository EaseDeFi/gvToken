import type { BigNumber } from "ethers";
import { TransferEvent } from "../src/types/contracts/core/EaseToken";

export type HolderDetailCSV = {
  HolderAddress: string;
  Balance: string;
  PendingBalanceUpdate: string;
};

export type HolderDetail = {
  account: string;
  depositStart: BigNumber;
  balance: BigNumber;
  balanceStored: string;
};

export type AccountEventDetail = {
  account: string;
  sendEvents: TransferEvent[];
  recieveEvents: TransferEvent[];
};

export type BalanceNode = {
  account: string;
  amount: BigNumber;
  depositStart: BigNumber;
};

// balance to store to the database
export type Balance = {
  account: string;
  amount: string;
  depositStart: string;
};
