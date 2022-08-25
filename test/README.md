# Notes on tests:

1. There can be chance that some tests may fail if tested individually (i.e using `only`) because we need to know contract address of undeployed contracts and we use deployer's nonce to calculate address. But the hardhat-upgrades `deployProxy` seems to create two transactions at first deploy inside `beforeEach` and just one transaction after that. I didn't bothered enough to debug that. That issue may arise everywhere I am using `deployProxy` in my tests.

`NOTE: The reason for the above issue is that as we deploy new contracts every time we run a test the deployPorxy looks for implementation contract with same bytecode if that's the case implementation address will be set to the one having identical bytecode. That's what happeing with the deployProxy function call`
