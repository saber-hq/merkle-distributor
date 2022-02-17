import { TransactionEnvelope } from "@saberhq/solana-contrib";
import {
  getATAAddress,
  getOrCreateATA,
  TOKEN_PROGRAM_ID,
} from "@saberhq/token-utils";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Keypair, SystemProgram } from "@solana/web3.js";

import { findClaimStatusKey, findDistributorKey } from "./pda";
import type { MerkleDistributorSDK } from "./sdk";
import type {
  ClaimArgs,
  ClaimStatus,
  CreateDistributorArgs,
  DistributorData,
  MerkleDistributorProgram,
  PendingDistributor,
} from "./types";
import { toBytes32Array } from "./utils";

export class MerkleDistributorWrapper {
  readonly program: MerkleDistributorProgram;
  readonly key: PublicKey;
  readonly distributorATA: PublicKey;
  data: DistributorData;

  constructor(
    readonly sdk: MerkleDistributorSDK,
    key: PublicKey,
    distributorATA: PublicKey,
    data: DistributorData
  ) {
    this.program = sdk.program;
    this.key = key;
    this.distributorATA = distributorATA;
    this.data = data;
  }

  static async load(
    sdk: MerkleDistributorSDK,
    key: PublicKey
  ): Promise<MerkleDistributorWrapper> {
    const data = await sdk.program.account.merkleDistributor.fetch(key);
    return new MerkleDistributorWrapper(
      sdk,
      key,
      await getATAAddress({ mint: data.mint, owner: key }),
      data
    );
  }

  static async createDistributor(
    args: CreateDistributorArgs
  ): Promise<PendingDistributor> {
    const { root, tokenMint } = args;

    const { sdk } = args;
    const { provider } = sdk;

    const baseKey = args.base ?? Keypair.generate();
    const adminAuth = args.adminAuth ?? Keypair.generate();
    const [distributor, bump] = await findDistributorKey(baseKey.publicKey);

    const ixs: TransactionInstruction[] = [];
    ixs.push(
      sdk.program.instruction.newDistributor(
        bump,
        toBytes32Array(root),
        args.maxTotalClaim,
        args.maxNumNodes,
        {
          accounts: {
            base: baseKey.publicKey,
            adminAuth: adminAuth.publicKey,
            distributor,
            mint: tokenMint,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          },
        }
      )
    );

    const { address, instruction } = await getOrCreateATA({
      provider,
      mint: tokenMint,
      owner: distributor,
    });
    if (instruction) {
      ixs.push(instruction);
    }

    return {
      base: baseKey.publicKey,
      bump,
      distributor,
      distributorATA: address,
      tx: new TransactionEnvelope(provider, ixs, [baseKey, adminAuth]),
    };
  }

  async claimIX(
    args: ClaimArgs,
    payer: PublicKey
  ): Promise<TransactionInstruction> {
    const { amount, claimant, index, proof } = args;
    const [claimStatus, bump] = await findClaimStatusKey(claimant, this.key);

    return this.program.instruction.claim(
      args.rootVersion,
      bump,
      index,
      amount,
      proof.map((p) => toBytes32Array(p)),
      {
        accounts: {
          distributor: this.key,
          claimStatus,
          from: this.distributorATA,
          to: await getATAAddress({ mint: this.data.mint, owner: claimant }),
          claimant,
          payer,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      }
    );
  }

  async claim(args: ClaimArgs): Promise<TransactionEnvelope> {
    const { provider } = this.sdk;
    const tx = new TransactionEnvelope(provider, [
      await this.claimIX(args, provider.wallet.publicKey),
    ]);
    const { instruction } = await getOrCreateATA({
      provider,
      mint: this.data.mint,
      owner: args.claimant,
    });
    if (instruction) {
      tx.instructions.unshift(instruction);
    }
    return tx;
  }

  async getClaimStatus(claimant: PublicKey): Promise<ClaimStatus> {
    const [key] = await findClaimStatusKey(claimant, this.key);
    return this.program.account.claimStatus.fetch(key);
  }

  async reload(): Promise<void> {
    this.data = await this.program.account.merkleDistributor.fetch(this.key);
  }
}
