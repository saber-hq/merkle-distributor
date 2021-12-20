import type { AnchorTypes } from "@saberhq/anchor-contrib";
import type { TransactionEnvelope } from "@saberhq/solana-contrib";
import type { u64 } from "@saberhq/token-utils";
import type { Keypair, PublicKey } from "@solana/web3.js";

import type { MerkleDistributorIDL } from "./idls/merkle_distributor";
import type { MerkleDistributorSDK } from "./sdk";

export type MerkleDistributorTypes = AnchorTypes<
  MerkleDistributorIDL,
  {
    claimStatus: ClaimStatus;
    merkleDistributor: DistributorData;
  }
>;

type Accounts = MerkleDistributorTypes["Accounts"];
export type DistributorData = Accounts["MerkleDistributor"];
export type ClaimStatus = Accounts["ClaimStatus"];

export type MerkleDistributorError = MerkleDistributorTypes["Error"];
export type MerkleDistributorEvents = MerkleDistributorTypes["Events"];
export type MerkleDistributorProgram = MerkleDistributorTypes["Program"];

export type CreateDistributorArgs = {
  sdk: MerkleDistributorSDK;
  root: Buffer;
  maxTotalClaim: u64;
  maxNumNodes: u64;
  tokenMint: PublicKey;
  base?: Keypair;
  authClaimantOwner: Boolean,
};

export type PendingDistributor = {
  bump: number;
  base: PublicKey;
  distributor: PublicKey;
  distributorATA: PublicKey;
  tx: TransactionEnvelope;
};

export type ClaimArgs = {
  index: u64;
  amount: u64;
  proof: Buffer[];
  claimant: PublicKey;
};
