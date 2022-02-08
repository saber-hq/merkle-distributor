import { newProgram } from "@saberhq/anchor-contrib";
import type { AugmentedProvider, Provider } from "@saberhq/solana-contrib";
import { SolanaAugmentedProvider } from "@saberhq/solana-contrib";
import type { PublicKey, Signer } from "@solana/web3.js";

import { BITMAP_PROGRAM_ID, PROGRAM_ID } from "./constants";
import { MerkleDistributorJSON } from "./idls/merkle_distributor";
import { ProgramBitmapJSON } from "./idls/program_bitmap";
import type {
  BitmapProgram,
  CreateDistributorArgs,
  MerkleDistributorProgram,
  PendingDistributor,
} from "./types";
import { MerkleDistributorWrapper } from "./wrapper";

export class MerkleDistributorSDK {
  constructor(
    readonly provider: AugmentedProvider,
    readonly program: MerkleDistributorProgram,
    readonly bitmapProgram: BitmapProgram
  ) {}

  withSigner(signer: Signer): MerkleDistributorSDK {
    return MerkleDistributorSDK.load({
      provider: this.provider.withSigner(signer),
    });
  }

  /**
   * Loads the SDK.
   * @returns {MerkleDistributorSDK}
   */
  static load({
    provider,
  }: {
    // Provider
    provider: Provider;
  }): MerkleDistributorSDK {
    const aug = new SolanaAugmentedProvider(provider);
    return new MerkleDistributorSDK(
      aug,
      newProgram<MerkleDistributorProgram>(
        MerkleDistributorJSON,
        PROGRAM_ID,
        aug
      ),
      newProgram<BitmapProgram>(ProgramBitmapJSON, BITMAP_PROGRAM_ID, aug)
    );
  }

  /**
   * Load an existing merkle distributor.
   * @returns {MerkleDistributorWrapper}
   */
  async loadDistributor(key: PublicKey): Promise<MerkleDistributorWrapper> {
    return await MerkleDistributorWrapper.load(this, key);
  }

  /**
   * Create a merkle distributor.
   * @returns {PendingDistributor}
   */
  async createDistributor(
    args: Omit<CreateDistributorArgs, "sdk">
  ): Promise<PendingDistributor> {
    return await MerkleDistributorWrapper.createDistributor({
      sdk: this,
      ...args,
    });
  }
}
