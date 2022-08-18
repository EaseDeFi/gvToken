import dotenv from "dotenv";
dotenv.config();

export function getForkingBlockNumber(): number {
  if (process.env.BLOCK_NUMBER === undefined) {
    throw new Error("Please set block number to your .env file");
  }
  return parseInt(process.env.BLOCK_NUMBER);
}
export function getMainnetUrl(): string {
  if (process.env.MAINNET_URL_ALCHEMY === undefined) {
    throw new Error("Please set mainnet url in your .env");
  }
  return process.env.MAINNET_URL_ALCHEMY as string;
}

export function isMainnetFork(): boolean {
  return !!process.env.FORKING;
}

export function getAlchemyApiKey(): string {
  if (process.env.ALCHEMY_API_KEY === undefined) {
    throw new Error("Please set tenderly api key in your .env");
  }
  return process.env.ALCHEMY_API_KEY as string;
}
export function getProviderRpc(): string {
  if (process.env.PROVIDER_RPC === undefined) {
    throw new Error("Please set PROVIDER_RPC in your .env");
  }
  return process.env.PROVIDER_RPC as string;
}
