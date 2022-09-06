import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import {
  EaseToken,
  TokenSwap,
  IERC20,
  IVArmor,
  GvToken,
  GovernorBravoDelegate,
  Timelock,
  BribePot,
  GvTokenV2,
} from "../src/types";
import { TransferEvent } from "../src/types/contracts/core/EaseToken";

export type Contracts = {
  ease: EaseToken;
  armor: IERC20;
  tokenSwap: TokenSwap;
  vArmor: IVArmor;
  gvToken: GvToken;
  bribePot: BribePot;
  gvTokenV2: GvTokenV2;
  easeGovernance: GovernorBravoDelegate;
  timelock: Timelock;
};

export type Signers = {
  easeDeployer: SignerWithAddress;
  vArmorHolder: SignerWithAddress;
  user: SignerWithAddress;
  deployer: SignerWithAddress;
  alice: SignerWithAddress;
  bob: SignerWithAddress;
  gov: SignerWithAddress;
  guardian: SignerWithAddress;
  admin: SignerWithAddress;
  briber: SignerWithAddress;
  gvToken: SignerWithAddress;
  otherAccounts: SignerWithAddress[];
};
export type Deployers = {
  tokenSwapDeployer: SignerWithAddress;
  easeDeployer: SignerWithAddress;
  bribePotDeployer: SignerWithAddress;
  gvTokenImplDeployer: SignerWithAddress;
  gvTokenProxyDeployer: SignerWithAddress;
  timelockDeployer: SignerWithAddress;
  govDelegateDeployer: SignerWithAddress;
  govDelegatorDeployer: SignerWithAddress;
};

export type MainnetAddresses = {
  armor: string;
  armorWhale: string;
  vArmor: string;
  vArmorWhale: string;
};

export type PermitSigArgs = {
  signer: SignerWithAddress;
  token: EaseToken;
  spender: string;
  value: BigNumber;
  deadline: BigNumber;
};

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
