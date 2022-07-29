import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, ethers, Signature } from "ethers";
import { BribePot, EaseToken, GvToken } from "../../src/types";
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
  numOfWeeks: number,
  rcaVaultAddress = RCA_VAULT
) {
  // add bribe to bribe pot
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

export async function depositFor(
  user: SignerWithAddress,
  value: BigNumber,
  gvToken: GvToken,
  ease: EaseToken
) {
  const deadline = (await getTimestamp()).add(1000);
  const spender = gvToken.address;
  const { v, r, s } = await getPermitSignature({
    signer: user,
    token: ease,
    value,
    deadline,
    spender,
  });
  await gvToken
    .connect(user)
    ["deposit(uint256,(uint256,uint8,bytes32,bytes32))"](value, {
      deadline,
      v,
      r,
      s,
    });
}
