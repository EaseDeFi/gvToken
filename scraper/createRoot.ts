import path from "path";
import fs from "fs-extra";
import { Balance, BalanceNode } from "./types";
import { BigNumber } from "ethers";
import BalanceTree from "../test/helpers/balance-tree";

(async function () {
  // TODO: Update this conversion rate
  const conversionRate = BigNumber.from(10).pow(18);
  const scalingFactor = BigNumber.from(10).pow(18);
  //   write all the details to a json file
  // fetch  balanceNodes
  const balanceNodesPath = path.resolve(
    __dirname,
    "formattedData",
    "balanceNodes.json"
  );
  const formattedBalNodesData = fs.readFileSync(balanceNodesPath, "utf-8");
  const storedBalNodes = JSON.parse(formattedBalNodesData) as Balance[];
  const balanceNodes: BalanceNode[] = [];
  for (const balNode of storedBalNodes) {
    const node: BalanceNode = {
      account: balNode.account,
      depositStart: BigNumber.from(balNode.depositStart),
      amount: BigNumber.from(balNode.amount),
    };
    node.amount = node.amount.mul(conversionRate).div(scalingFactor);
    balanceNodes.push(node);
  }
  // create tree
  const balanceTree = new BalanceTree(balanceNodes);
  console.log(`Hex root = ${balanceTree.getHexRoot()}`);
})();
