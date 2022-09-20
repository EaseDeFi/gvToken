import path from "path";
import fs from "fs-extra";
import BalanceTree from "../test/helpers/balance-tree";
import { getEaseBalanceNodes, getVarmorBalanceNodes } from "./helpers";
type ProofDetail = {
  proof: string[];
  easeAmount: string;
  address: string;
  vArmorAmount: string;
  depositStart: string;
};

(function () {
  const proofDetails: ProofDetail[] = [];
  const vArmorBalanceNodes = getVarmorBalanceNodes();
  const balanceNodes = getEaseBalanceNodes();
  const tree = new BalanceTree(balanceNodes);
  // Check in case I mess things up
  if (balanceNodes.length != vArmorBalanceNodes.length) {
    throw new Error("Ease Balance node and vArmor Balance Nodes mismatch!");
  }

  for (let i = 0; i < balanceNodes.length; i++) {
    const node = balanceNodes[i];
    const proof = tree.getProof(node.account, node.amount, node.depositStart);
    const proofDetail: ProofDetail = {
      address: node.account,
      easeAmount: node.amount.toString(),
      depositStart: node.depositStart.toString(),
      vArmorAmount: vArmorBalanceNodes[i].amount.toString(),
      proof,
    };
    proofDetails.push(proofDetail);
  }

  const proofDetailsPath = path.resolve(
    __dirname,
    "formattedData",
    "proofDetails.json"
  );
  // make sure the file exists
  fs.ensureFileSync(proofDetailsPath);

  console.log("Writing proof details to a proofDetails.json");
  // store the data
  fs.writeFileSync(proofDetailsPath, JSON.stringify(proofDetails));
  console.log("Proof details stored successfully!");
})();
