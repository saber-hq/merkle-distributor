import { utils } from "@project-serum/anchor";
import type { u64 } from "@saberhq/token-utils";
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
  index: u64,
  distributor: PublicKey
): Promise<[PublicKey, number]> => {
  return await PublicKey.findProgramAddress(
    [
      utils.bytes.utf8.encode("ClaimStatus"),
      index.toArrayLike(Buffer, "le", 8),
      distributor.toBytes(),
    ],
    PROGRAM_ID
  );
};
