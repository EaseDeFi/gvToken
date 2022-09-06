import { BalanceNode } from "./types";
import BalanceTree from "../test/helpers/balance-tree";
import { getBalanceNodes } from "./helpers";

export async function getVArmorHoldersTree(): Promise<BalanceTree> {
  const balanceNodes: BalanceNode[] = getBalanceNodes();
  // create tree
  return new BalanceTree(balanceNodes);
}

(async function () {
  if (typeof require !== "undefined" && require.main === module) {
    const balanceTree = await getVArmorHoldersTree();
    console.log(`Hex root = ${balanceTree.getHexRoot()}`);
  }
})();
