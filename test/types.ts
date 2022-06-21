import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { EaseToken, TokenSwap, IERC20, IVArmor, GvToken } from "../src/types";
import { BribePot } from "../src/types/contracts/core/BribePot";
export type Contracts = {
  ease: EaseToken;
  armor: IERC20;
  tokenSwap: TokenSwap;
  vArmor: IVArmor;
  gvToken: GvToken;
  bribePot: BribePot;
};
export type Signers = {
  user: SignerWithAddress;
  alice: SignerWithAddress;
  bob: SignerWithAddress;
  gov: SignerWithAddress;
  guardian: SignerWithAddress;
  briber: SignerWithAddress;
  gvToken: SignerWithAddress;
  otherAccounts: SignerWithAddress[];
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
