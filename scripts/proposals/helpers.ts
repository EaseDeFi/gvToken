import path from "path";
import fs from "fs-extra";

type Vault = {
  address: string;
  enabled: boolean;
};

export function getActiveRcaVaults(): string[] {
  const balanceNodesPath = path.resolve(__dirname, "vaults.json");
  const vaultsData = fs.readFileSync(balanceNodesPath, "utf-8");
  const vaults = JSON.parse(vaultsData) as Vault[];

  const activeVaults: string[] = [];
  for (const vault of vaults) {
    if (vault.enabled) {
      activeVaults.push(vault.address);
    }
  }
  return activeVaults;
}
