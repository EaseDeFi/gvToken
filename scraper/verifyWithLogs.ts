import dayjs from "dayjs";
import fs from "fs-extra";
import { formatEther } from "ethers/lib/utils";
import path from "path";
import {
  getBalance,
  getNormalizedStartTime,
  getVarmorHolders,
} from "./helpers";
import { AccountEventDetail } from "./types";

export async function consoleBalanceAndStartTime() {
  // read holdersEvents.json
  const holdersEventsPath = path.resolve(
    __dirname,
    "scrapedData",
    "holdersEvents.json"
  );
  const holdersEventsData = fs.readFileSync(holdersEventsPath, "utf-8");
  const holdersEventsDetails = JSON.parse(
    holdersEventsData
  ) as AccountEventDetail[];
  const holders = await getVarmorHolders();
  // used for getting index of holders data stored
  // from etherscan so that we can verify balance
  // calculated and balance stored
  let i = 0;
  for (const holderDetail of holdersEventsDetails) {
    const balance = getBalance(
      holderDetail.recieveEvents,
      holderDetail.sendEvents
    );
    const normalizedStartTime = await getNormalizedStartTime(
      holderDetail.recieveEvents
    );
    const startTime = dayjs.unix(normalizedStartTime.toNumber());
    const now = dayjs();
    const days = now.diff(startTime, "days");

    console.log(
      `Balance Calc: ${formatEther(balance)}, Bal Stored: ${
        holders[i].balanceStored
      }, Start Time: ${days} days before, account: ${holders[i].account}`
    );
    i++;
  }
}

(async function () {
  await consoleBalanceAndStartTime();
})();
