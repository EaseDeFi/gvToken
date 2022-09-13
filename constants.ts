import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";

// TODO: update these constants for deployment
// wait 1 block before voting starts
export const VOTING_DELAY = BigNumber.from(1);
// voting period in blocks (1 week approx)
export const VOTING_PERIOD = BigNumber.from(5760);
export const PROPOSAL_THRESOLD = parseEther("100000");
export const TOKENSWAP_TRANSFER_AMT = parseEther("1000000");

// Thu Apr 14 2022 00:00:00 GMT+0000
export const GENESIS = BigNumber.from(1649894400);

export const DEPLOYED_ADDRESSES = {
  tokenSwap: "0xEA5edef17986EAbb7333bacdC9E2F574C7Fe6935",
  easeToken: "0xEa5eDef1287AfDF9Eb8A46f9773AbFc10820c61c",
  bribePot: "0xEA5EdeF17C9be57228389962ba50b98397f1E28C",
  gvToken: "0xEa5edeF1eDB2f47B9637c029A6aC3b80a7ae1550",
  gvTokenImpl: "0xeA5EdeF175880b5C9F55457b5621DfeB1b19A32E",
  bribePotImpl: "0xCaF28264d8228ee86d83383831427FcD011ab7c4",
  timelock: "0xEA5edEf1401e8C312c797c27a9842e03Eb0e557a",
  governance: "0xEA5eDeF17c4FCE9C120790F3c54D6E04823dE587",
};
