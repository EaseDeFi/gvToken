import path from "path";
import fs from "fs-extra";
import { getFormattedBalanceNodes } from "./helpers";
import { Balance } from "./types";

(async function () {
  //   write all the details to a json file
  console.log("Fetching formatted balance nodes");
  const balanceNodes = await getFormattedBalanceNodes();

  const storableBalances: Balance[] = [];
  for (const node of balanceNodes) {
    const balance: Balance = {
      account: node.account,
      depositStart: node.depositStart.toString(),
      amount: node.amount.toString(),
    };
    storableBalances.push(balance);
  }
  console.log(`Fetched required data`);
  const rootDetailsPath = path.resolve(
    __dirname,
    "formattedData",
    "balanceNodes.json"
  );
  // make sure the file exists
  fs.ensureFileSync(rootDetailsPath);

  console.log("Writing data to a balanceNodes.json");
  // store the data
  fs.writeFileSync(rootDetailsPath, JSON.stringify(storableBalances));
  console.log("Balance Nodes stored successfully!");
})();
