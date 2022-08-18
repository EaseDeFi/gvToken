# Varmor root creator

## Steps for creating merkle root
1. Run `ts-node scraper/createRoot.ts` 

## Steps to update scrapeData and formatted data
1. Add PROVIDER_RPC to your env file
2. Download csv of vArmor holders from [etherscan](https://etherscan.io/exportData?type=tokenholders&contract=0x5afeDef11AA9CD7DaE4023807810d97C20791dEC&decimal=18) and save it to `"scrapers/scrapedData/vArmorHolders.csv"`
3. Run `ts-node scraper/updateEventsJson.ts` (Note: this should scrape all the latest transfer events of vArmor token for all holders and update it to `scraper/scrapedData/holdersEvents.json`)
3. Run `ts-node scraper/storeRootNodes.ts` (Note: this will update `"scraper/formattedData/balanceNodes.json"` which can be directly stored to database by parsing it.)

4. Follow steps for creating merkle root