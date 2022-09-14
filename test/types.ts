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
  arNXMVault: string;
  armorGov: string;
  armorTimelock: string;
};

export type PermitSigArgs = {
  signer: SignerWithAddress;
  token: EaseToken;
  spender: string;
  value: BigNumber;
  deadline: BigNumber;
};
