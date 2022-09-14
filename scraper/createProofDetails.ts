import path from "path";
import fs from "fs-extra";
import BalanceTree from "../test/helpers/balance-tree";
import { getBalanceNodes } from "./helpers";
type ProofDetail = {
  proof: string[];
  amount: string;
  address: string;
};

(function () {
  const proofDetails: ProofDetail[] = [];
  const balanceNodes = getBalanceNodes();
  const tree = new BalanceTree(balanceNodes);
  for (const node of balanceNodes) {
    const proof = tree.getProof(node.account, node.amount, node.depositStart);
    const proofDetail: ProofDetail = {
      address: node.account,
      amount: node.amount.toString(),
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
