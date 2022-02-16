import { utils } from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";

import { PROGRAM_ID } from "./constants";

export const findDistributorKey = async (
  base: PublicKey
): Promise<[PublicKey, number]> => {
  return await PublicKey.findProgramAddress(
    [utils.bytes.utf8.encode("MerkleDistributor"), base.toBytes()],
    PROGRAM_ID
  );
};

export const findClaimStatusKey = async (
  claimant: PublicKey,
  distributor: PublicKey
): Promise<[PublicKey, number]> => {
  return await PublicKey.findProgramAddress(
    [
      utils.bytes.utf8.encode("ClaimStatus"),
      distributor.toBytes(),
      claimant.toBytes(),
    ],
    PROGRAM_ID
  );
};
