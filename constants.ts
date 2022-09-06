import { BigNumber } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";

// TODO: update these constants for deployment
// wait 1 block before voting starts
export const VOTING_DELAY = BigNumber.from(1);
// voting period in blocks (1 week approx)
export const VOTING_PERIOD = BigNumber.from(5760);
export const PROPOSAL_THRESOLD = parseEther("100000");
export const TOKENSWAP_TRANSFER_AMT = parseEther("1000000");

// CONSTANTS FOR TESTS
export const BUFFER = BigNumber.from(10).pow(18);
export const MAINNET_ADDRESSES = {
  armor: "0x1337DEF16F9B486fAEd0293eb623Dc8395dFE46a",
  armorWhale: "0x66F6d639199342619CAF8617bf80eA738e5960A3",
  vArmor: "0x5afeDef11AA9CD7DaE4023807810d97C20791dEC",
  vArmorWhale: "0xD0e72c1B2eb87e3DC0445b7f689CaDcFc872b293",
};

export const RCA_CONTROLLER = "0xEA5edEF1A7106D9e2024240299DF3D00C7D94767";
export const RCA_VAULT = "0xEa5eDEF185427F1691C86eD2cF0742BBD35f9ecc";
export const RCA_VAULT_1 = "0xeA5eDEF17bdE66fA56Ea6EaC135ef83391D7e742";
export const RCA_VAULTS = {
  ezYvWETH: "0xeA5Edef1983B46F04696aB545473719F308b106f",
  ezYvUSDC: "0xea5eDeF155b0663BB7Cad73Df0BC06e24D9DdbDA",
  ezYvDAI: "0xEA5EDeF1BCDBbcc54D47f0fD28D676f9e5049734",
  ezYvCrvIronBank: "0xeA5EdEF1FcF717327440646e7302ca058dDE844F",
};

// CONSTANTS FOR SCRAPER

// Thu Apr 14 2022 00:00:00 GMT+0000
export const GENESIS = BigNumber.from(1649894400);

export const SNAPSHOT_BLOCK_NUMBER = 15481080;
// block number before vArm
export const VARMOR_BLOCK_CREATION_NUMBER = 13511162;
// Thu Apr 14 2022 00:00:00 GMT+0000
export const VARMOR_BONUS_START = BigNumber.from(1649894400);
// vArmor to armor exchange rate
export const VARMOR_EXCHANGE_RATE = parseUnits("1176860757679165373", 0);
export const SCALING_FACTOR = BigNumber.from(10).pow(18);
