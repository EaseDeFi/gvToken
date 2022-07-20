import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, ethers, Signature } from "ethers";
import { BribePot, EaseToken } from "../../src/types";
import { RCA_VAULT } from "../constants";
import { PermitSigArgs } from "../types";
import { getTimestamp } from "../utils";

export async function getPermitSignature({
  signer,
  token,
  spender,
  value,
  deadline,
}: PermitSigArgs): Promise<Signature> {
  const [nonce, name, version, chainId] = await Promise.all([
    token.nonces(signer.address),
    token.name(),
    "1",
    signer.getChainId(),
  ]);

  return ethers.utils.splitSignature(
    await signer._signTypedData(
      {
        name,
        version,
        chainId,
        verifyingContract: token.address,
      },
      {
        Permit: [
          {
            name: "owner",
            type: "address",
          },
          {
            name: "spender",
            type: "address",
          },
          {
            name: "value",
            type: "uint256",
          },
          {
            name: "nonce",
            type: "uint256",
          },
          {
            name: "deadline",
            type: "uint256",
          },
        ],
      },
      {
        owner: signer.address,
        spender,
        value,
        nonce,
        deadline,
      }
    )
  );
}

export async function bribeFor(
  briber: SignerWithAddress,
  bribePerWeek: BigNumber,
  bribePot: BribePot,
  token: EaseToken,
  numOfWeeks: number
) {
  // add bribe to bribe pot
  const rcaVaultAddress = RCA_VAULT;
  const totalBribeAmt = bribePerWeek.mul(numOfWeeks);
  const spender = bribePot.address;
  const deadline = (await getTimestamp()).add(1000);
  const { v, r, s } = await getPermitSignature({
    signer: briber,
    token,
    value: totalBribeAmt,
    deadline,
    spender,
  });
  // add bribe amount to pot
  await bribePot
    .connect(briber)
    .bribe(bribePerWeek, rcaVaultAddress, numOfWeeks, {
      deadline,
      v,
      r,
      s,
    });
}
