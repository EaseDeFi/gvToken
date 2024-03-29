import MerkleTree from "./merkle-tree";
import { BigNumber, utils } from "ethers";

export default class BalanceTree {
  private readonly tree: MerkleTree;
  constructor(
    balances: { account: string; amount: BigNumber; depositStart: BigNumber }[]
  ) {
    this.tree = new MerkleTree(
      balances.map(({ account, amount, depositStart }) => {
        return BalanceTree.toNode(account, amount, depositStart);
      })
    );
  }

  public static verifyProof(
    account: string,
    amount: BigNumber,
    depositStart: BigNumber,
    proof: Buffer[],
    root: Buffer
  ): boolean {
    let pair = BalanceTree.toNode(account, amount, depositStart);
    for (const item of proof) {
      pair = MerkleTree.combinedHash(pair, item);
    }

    return pair.equals(root);
  }

  // keccak256(abi.encode(account, amount))
  public static toNode(
    account: string,
    amount: BigNumber,
    depositStart: BigNumber
  ): Buffer {
    return Buffer.from(
      utils
        .solidityKeccak256(
          ["address", "uint256", "uint256"],
          [account, amount, depositStart]
        )
        .slice(2),
      "hex"
    );
  }

  public getHexRoot(): string {
    return this.tree.getHexRoot();
  }

  // returns the hex bytes32 values of the proof
  public getProof(
    account: string,
    amount: BigNumber,
    depositStart: BigNumber
  ): string[] {
    return this.tree.getHexProof(
      BalanceTree.toNode(account, amount, depositStart)
    );
  }
}
