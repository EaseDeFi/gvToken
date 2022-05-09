import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { EaseToken, TokenSwap, IERC20 } from "../src/types";
export type Contracts = {
  easeToken: EaseToken;
  armorToken: IERC20;
  tokenSwap: TokenSwap;
};
export type Signers = {
  user: SignerWithAddress;
  gov: SignerWithAddress;
  guardian: SignerWithAddress;
  otherAccounts: SignerWithAddress[];
};

export type MainnetAddresses = {
  armorToken: string;
  armorWhale: string;
};
