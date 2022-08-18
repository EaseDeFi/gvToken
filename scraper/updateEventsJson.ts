import path from "path";
import fs from "fs-extra";
import { AccountEventDetail } from "./types";
import { getTransferEvents, getVarmorHolders } from "./helpers";

// fetches all the recent events of vArmor holders and updates
// data/holdersEvents.json so that we don't have to deal with
// slowness of these alchemy/infura providers

(async function () {
  const holders = await getVarmorHolders();
  const holdersEventDetails: AccountEventDetail[] = [];
  let holderEventDetail: AccountEventDetail;
  for (const holder of holders) {
    console.log(`Fetching events of ${holder.account}`);
    const { sendEvents, recieveEvents } = await getTransferEvents(
      holder.account
    );
    holderEventDetail = {
      account: holder.account,
      sendEvents,
      recieveEvents,
    };
    holdersEventDetails.push(holderEventDetail);
  }
  //   write all the details to a json file
  const holdersEventsPath = path.resolve(
    __dirname,
    "scrapedData",
    "holdersEvents.json"
  );

  console.log("Updating holdersEvents.json file");
  //   finally update the data
  fs.writeFileSync(holdersEventsPath, JSON.stringify(holdersEventDetails));
  console.log("Updated holder events successfully!");
})();
