import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { EaseToken, TokenSwap, IERC20, IVArmor } from "../src/types";
export type Contracts = {
  ease: EaseToken;
  armor: IERC20;
  tokenSwap: TokenSwap;
  vArmor: IVArmor;
};
export type Signers = {
  user: SignerWithAddress;
  gov: SignerWithAddress;
  guardian: SignerWithAddress;
  otherAccounts: SignerWithAddress[];
};

export type MainnetAddresses = {
  armor: string;
  armorWhale: string;
  vArmor: string;
  vArmorWhale: string;
};
