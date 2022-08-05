# Growing Vote Tokenomics
### [Documentation](https://docs.google.com/document/d/1U4gdkx_Qen8iApCc0C5zSi3PrDfbn_yoBM9RWaeaqTw/edit)

## Tests and Deployment
1. Clone this repo `git@github.com:EaseDeFi/gvToken.git`
2. Install dependencies `cd gvToken` && `npm install`
3. Change `.env.example` to `.env` and update the variables
4. Compile contracts - `npm run compile`
5. Run tests - `npm test`
6. Deploy contracts:-
	* Forked Mainnet Hardhat: `npx hardhat run scripts/deploy.ts`
	* Locally Forked Node: `npx hardhat node` && `npx hardhat run scripts/deploy.ts --network localhost`
	* Tenderly Fork - (*Note: make sure account MAINNET_PRIVATE_KEY in .env has at least 20K armor and 1 eth on that tenderly fork*) `npx hardhat run scripts/deploy.ts --network tenderly`