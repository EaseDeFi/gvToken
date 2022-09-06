import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "hardhat-abi-exporter";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";

import { resolve } from "path";

import { config as dotenvConfig } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import { NetworkUserConfig } from "hardhat/types";
import { getForkingBlockNumber } from "./env_helpers";

dotenvConfig({ path: resolve(__dirname, "./.env") });

// Ensure that we have all the environment variables we need.
const mnemonic: string | undefined = process.env.MNEMONIC;
if (!mnemonic) {
  throw new Error("Please set your MNEMONIC in a .env file");
}

const infuraApiKey: string | undefined = process.env.INFURA_API_KEY;
if (!infuraApiKey) {
  throw new Error("Please set your INFURA_API_KEY in a .env file");
}
const forkingURL: string | undefined = process.env.MAINNET_URL_ALCHEMY;
if (!forkingURL) {
  throw new Error("Please set your MAINNET_URL_ALCHEMY in a .env file");
}
const forking: string | undefined = process.env.FORKING;
if (!forking) {
  throw new Error("Please set your FORKING in a .env file");
}

const accounts: string[] = [];
function populateAccounts() {
  let i = 1;
  while (process.env[`PRIVATE_KEY${i}`] !== undefined) {
    accounts.push(`0x${process.env[`PRIVATE_KEY${i}`] as string}`);
    i++;
  }
}

// fill accounts array
populateAccounts();

const chainIds = {
  arbitrumOne: 42161,
  avalanche: 43114,
  bsc: 56,
  goerli: 5,
  hardhat: 31337,
  kovan: 42,
  mainnet: 1,
  optimism: 10,
  polygon: 137,
  rinkeby: 4,
  ropsten: 3,
};

function getChainConfig(network: keyof typeof chainIds): NetworkUserConfig {
  const url: string = "https://" + network + ".infura.io/v3/" + infuraApiKey;
  return {
    accounts,
    chainId: chainIds[network],
    url,
  };
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  etherscan: {
    apiKey: {
      arbitrumOne: process.env.ARBSCAN_API_KEY || "",
      goerli: process.env.ETHERSCAN_API_KEY || "",
      kovan: process.env.ETHERSCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISM_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      rinkeby: process.env.ETHERSCAN_API_KEY || "",
      ropsten: process.env.ETHERSCAN_API_KEY || "",
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    gasPrice: 100,
    excludeContracts: [],
    src: "./contracts",
  },
  abiExporter: {
    path: "./data/abi",
    runOnCompile: true,
    clear: true,
    flat: true,
    spacing: 2,
  },
  networks: {
    hardhat: {
      forking: {
        url: forkingURL ?? "",
        blockNumber: getForkingBlockNumber(),
        enabled: !!forking,
      },
      accounts: {
        mnemonic,
      },
      chainId: forking ? 1 : chainIds.hardhat,
    },
    arbitrumOne: getChainConfig("arbitrumOne"),
    mainnet: getChainConfig("mainnet"),
    optimism: getChainConfig("optimism"),
    rinkeby: getChainConfig("rinkeby"),
    goerli: getChainConfig("goerli"),
    tenderly: {
      url: process.env.TENDERLY_FORK || "",
      accounts: process.env.MAINNET_PRIVATE_KEY
        ? [`0x${process.env.MAINNET_PRIVATE_KEY}`]
        : [],
      chainId: 1,
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.11",
    settings: {
      metadata: {
        // Not including the metadata hash
        // https://github.com/paulrberg/solidity-template/issues/31
        bytecodeHash: "none",
      },
      // Disable the optimizer when debugging
      // https://hardhat.org/hardhat-network/#solidity-optimizer-support
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  typechain: {
    outDir: "src/types",
    target: "ethers-v5",
  },
  mocha: {
    timeout: 400_000,
  },
};

export default config;
