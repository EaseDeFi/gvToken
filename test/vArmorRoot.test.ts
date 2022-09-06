import { expect } from "chai";
import { getContractAddress, parseEther } from "ethers/lib/utils";
import hre, { ethers, upgrades } from "hardhat";
import { SNAPSHOT_BLOCK_NUMBER, VARMOR_EXCHANGE_RATE } from "../constants";
import {
  BribePot__factory,
  EaseToken__factory,
  ERC1967Proxy__factory,
  GvToken,
  GvToken__factory,
  IERC20,
  IVArmor,
  TokenSwap,
  TokenSwap__factory,
} from "../src/types";
import { BUFFER, MAINNET_ADDRESSES, RCA_CONTROLLER } from "../constants";
import { getPermitSignature } from "./helpers";
import BalanceTree from "./helpers/balance-tree";
import { Contracts, Signers } from "./types";
import { BalanceNode } from "../scraper/types";
import { getBalanceNodes } from "../scraper/helpers";
import { getTimestamp, resetBlockchain, TIME_IN_SECS } from "./utils";

// return random balance nodes of externally owned accounts
async function getRandomBalanceNodes(
  balanceNodes: BalanceNode[],
  count = 5
): Promise<BalanceNode[]> {
  const randomNodes: BalanceNode[] = [];
  let i = 0;
  while (i < count) {
    const randomNumber = Math.floor(Math.random() * balanceNodes.length);
    const node = balanceNodes[randomNumber];
    const isEOA = (await ethers.provider.getCode(node.account)) === "0x";
    if (isEOA) {
      randomNodes.push(node);
      i++;
    }
  }
  return randomNodes;
}

describe("VArmorRoot", function () {
  const contracts = {} as Contracts;
  const signers = {} as Signers;
  let vArmorBalanceNodes: BalanceNode[];
  before(async function () {
    // RESET TO SNAPSHOT BLOCK NUMBER
    await resetBlockchain(SNAPSHOT_BLOCK_NUMBER);

    const accounts = await ethers.getSigners();
    signers.user = accounts[0];
    signers.gov = accounts[1];
    signers.easeDeployer = accounts[3];
    signers.otherAccounts = accounts.slice(4);
    // fill in address

    vArmorBalanceNodes = getBalanceNodes();
  });
  beforeEach(async function () {
    const EaseTokenFactory = <EaseToken__factory>(
      await ethers.getContractFactory("EaseToken")
    );
    const TOKEN_SWAP_FACTORY = <TokenSwap__factory>(
      await ethers.getContractFactory("TokenSwap")
    );

    const GvTokenFactory = <GvToken__factory>(
      await ethers.getContractFactory("GvToken")
    );
    const ERC1977ProxyFactory = <ERC1967Proxy__factory>(
      await ethers.getContractFactory("ERC1967Proxy")
    );
    const BribePotFactory = <BribePot__factory>(
      await ethers.getContractFactory("BribePot")
    );

    const userNonce = await signers.user.getTransactionCount();
    const bribePotAddress = getContractAddress({
      from: signers.user.address,
      nonce: userNonce,
    });
    const gvTokenAddress = getContractAddress({
      from: signers.user.address,
      nonce: userNonce + 2,
    });

    const tokenSwapAddress = getContractAddress({
      from: signers.user.address,
      nonce: userNonce + 3,
    });
    const GENESIS = (await getTimestamp()).sub(TIME_IN_SECS.year);
    contracts.ease = await EaseTokenFactory.connect(
      signers.easeDeployer
    ).deploy(signers.gov.address);
    const easeAddress = contracts.ease.address;

    contracts.bribePot = await BribePotFactory.deploy(
      gvTokenAddress,
      easeAddress,
      RCA_CONTROLLER
    );

    // Deploy gvToken
    // Validate GvToken Implementation for upgradability
    await upgrades.validateImplementation(GvTokenFactory);

    // Setting gvToken as implementation initially and we will
    // update it to proxy address later
    contracts.gvToken = await GvTokenFactory.deploy();
    const callData = contracts.gvToken.interface.encodeFunctionData(
      "initialize",
      [bribePotAddress, easeAddress, RCA_CONTROLLER, tokenSwapAddress, GENESIS]
    );
    const proxy = await ERC1977ProxyFactory.deploy(
      contracts.gvToken.address,
      callData
    );

    await proxy.deployed();

    // update gvToken to proxy
    contracts.gvToken = <GvToken>(
      await ethers.getContractAt("GvToken", proxy.address)
    );

    contracts.tokenSwap = <TokenSwap>(
      await TOKEN_SWAP_FACTORY.connect(signers.user).deploy(
        contracts.ease.address,
        MAINNET_ADDRESSES.armor,
        MAINNET_ADDRESSES.vArmor
      )
    );

    contracts.vArmor = <IVArmor>(
      await ethers.getContractAt("IVArmor", MAINNET_ADDRESSES.vArmor)
    );
    contracts.armor = <IERC20>(
      await ethers.getContractAt("IERC20", MAINNET_ADDRESSES.armor)
    );

    // set delay to 1 week
    await contracts.gvToken.setDelay(TIME_IN_SECS.day * 7);
    // fund tokenSwap address with all EASE tokens
    await contracts.ease
      .connect(signers.easeDeployer)
      .transfer(
        contracts.tokenSwap.address,
        await contracts.ease.balanceOf(signers.easeDeployer.address)
      );
  });

  describe("#balanceNode", function () {
    it("growth start should not be before 14th April 2022", async function () {
      // genesis here is 14th april
      const growthStart = await contracts.gvToken.genesis();
      console.log(`This test may take long time......`);
      for (let i = 0; i < vArmorBalanceNodes.length; i++) {
        const node = vArmorBalanceNodes[i];
        expect(node.depositStart).gte(growthStart);
        const vArmorBalance = await contracts.vArmor.balanceOf(node.account);
        const expectedEaseSwapAmount = vArmorBalance
          .mul(VARMOR_EXCHANGE_RATE)
          .div(BUFFER);
        expect(expectedEaseSwapAmount).to.equal(node.amount);
      }
    });
  });

  describe("#deposit", function () {
    describe("depositWithVArmor()", function () {
      let merkleTree: BalanceTree;
      let randomBalanceEOANodes: BalanceNode[];
      const testCount = 3;
      this.beforeEach(async function () {
        // get random balance nodes
        randomBalanceEOANodes = await getRandomBalanceNodes(
          vArmorBalanceNodes,
          5
        );
        // just test using 3 accounts
        for (let i = 0; i < testCount; i++) {
          const vArmorHolderAddress = randomBalanceEOANodes[i].account;

          // update randomBalance account to signer with private key and keep
          // rest unchanged
          randomBalanceEOANodes[i].account = signers.otherAccounts[i].address;
          // impersonate that account and send all vArmor to the signer
          await hre.network.provider.send("hardhat_impersonateAccount", [
            vArmorHolderAddress,
          ]);
          const vArmorHolder = await ethers.getSigner(vArmorHolderAddress);
          // fund vArmor holder
          signers.user.sendTransaction({
            value: parseEther("1"),
            to: vArmorHolderAddress,
          });
          const vArmorBalance = await contracts.vArmor.balanceOf(
            vArmorHolderAddress
          );
          // send all vArmor holder balance to signer with private key
          await contracts.vArmor
            .connect(vArmorHolder)
            .transfer(signers.otherAccounts[i].address, vArmorBalance);
        }
        merkleTree = new BalanceTree(randomBalanceEOANodes);

        await contracts.gvToken.setPower(merkleTree.getHexRoot());
      });

      it("should allow vArmor hodler to directly get gvEase with valid proof", async function () {
        for (let currentIndex = 0; currentIndex < testCount; currentIndex++) {
          const balanceNode = randomBalanceEOANodes[currentIndex];
          const vArmorHolderAddress = balanceNode.account;

          // update vArmor holder
          const vArmorHolder = signers.otherAccounts[currentIndex];

          const vArmorAmount = await contracts.vArmor.balanceOf(
            vArmorHolderAddress
          );

          // Approve to tokenswap address
          await contracts.vArmor
            .connect(vArmorHolder)
            .approve(contracts.tokenSwap.address, vArmorAmount);

          const deadline = (await getTimestamp()).add(1000);
          const spender = contracts.gvToken.address;

          const vArmorHolderProof = merkleTree.getProof(
            vArmorHolder.address,
            balanceNode.amount,
            balanceNode.depositStart
          );

          // THIS FAILS because it's impossible to sign a message
          // with impersonated account
          const { v, r, s } = await getPermitSignature({
            deadline,
            token: contracts.ease,
            value: balanceNode.amount,
            signer: vArmorHolder,
            spender,
          });

          const vArmorHolderEaseBalBefore = await contracts.ease.balanceOf(
            vArmorHolderAddress
          );

          const vArmorHolderDepositValueBefore =
            await contracts.gvToken.totalDeposit(vArmorHolderAddress);
          const gvTokenEaseBalBefore = await contracts.ease.balanceOf(
            contracts.gvToken.address
          );

          await contracts.gvToken
            .connect(vArmorHolder)
            .depositWithVArmor(
              balanceNode.amount,
              vArmorAmount,
              balanceNode.depositStart,
              vArmorHolderProof,
              { v, r, s, deadline }
            );
          const gvTokenEaseBalAfter = await contracts.ease.balanceOf(
            contracts.gvToken.address
          );

          const vArmorHolderEaseBalAfter = await contracts.ease.balanceOf(
            vArmorHolderAddress
          );
          const vArmorHolderDepositValueAfter =
            await contracts.gvToken.totalDeposit(vArmorHolderAddress);

          // gvToken's ease balance should increase by expected ease deposit amount
          expect(gvTokenEaseBalAfter.sub(gvTokenEaseBalBefore)).to.equal(
            balanceNode.amount
          );
          // vArmor holders ease balance should remain the same
          expect(vArmorHolderEaseBalAfter).to.equal(vArmorHolderEaseBalBefore);

          // vArmor holders last deposit start should be equal to balance node
          // deposit start
          const deposits = await contracts.gvToken.getUserDeposits(
            vArmorHolderAddress
          );

          expect(deposits[deposits.length - 1].start).to.equal(
            balanceNode.depositStart
          );

          // depsoit value of vArmor holder should increase by the amount
          // of ease that can recieve head start.
          expect(
            vArmorHolderDepositValueAfter.sub(vArmorHolderDepositValueBefore)
          ).to.equal(balanceNode.amount);
        }
      });
    });
  });
});
