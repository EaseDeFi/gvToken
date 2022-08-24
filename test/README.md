# Notes on tests:

1. There can be chance that some tests may fail if tested individually (i.e using `only`) because we need to know contract address of undeployed contracts and we use deployer's nonce to calculate address. But the hardhat-upgrades `deployProxy` seems to create two transactions at first deploy inside `beforeEach` and just one transaction after that. I didn't bothered enough to debug that. That issue may arise everywhere I am using `deployProxy` in my tests.
