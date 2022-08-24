import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";

// TODO: update these constants for deployment
// wait 1 block before voting starts
export const VOTING_DELAY = BigNumber.from(1);
// voting period in blocks (1 week approx)
export const VOTING_PERIOD = BigNumber.from(5760);
export const PROPOSAL_THRESOLD = parseEther("1000");
export const TOKENSWAP_TRANSFER_AMT = parseEther("1000000");

// Thu Apr 14 2022 00:00:00 GMT+0000
export const GENESIS = BigNumber.from(1649894400);
