import { Program, Provider as AnchorProvider } from "@project-serum/anchor";
import type { Provider } from "@saberhq/solana-contrib";
import { SignerWallet, SolanaProvider } from "@saberhq/solana-contrib";
import type { PublicKey, Signer } from "@solana/web3.js";

import { PROGRAM_ID } from "./constants";
import { MerkleDistributorJSON } from "./idls/merkle_distributor";
import type {
  CreateDistributorArgs,
  MerkleDistributorProgram,
  PendingDistributor,
} from "./types";
import { MerkleDistributorWrapper } from "./wrapper";

export class MerkleDistributorSDK {
  constructor(
    public readonly provider: Provider,
    public readonly program: MerkleDistributorProgram
  ) {}

  withSigner(signer: Signer): MerkleDistributorSDK {
    return MerkleDistributorSDK.load({
      provider: new SolanaProvider(
        this.provider.connection,
        this.provider.broadcaster,
        new SignerWallet(signer),
        this.provider.opts
      ),
    });
  }

  /**
   * Loads the SDK.
   * @returns {MerkleDistributorSDK}
   */
  public static load({
    provider,
  }: {
    // Provider
    provider: Provider;
  }): MerkleDistributorSDK {
    const anchorProvider = new AnchorProvider(
      provider.connection,
      provider.wallet,
      provider.opts
    );
    return new MerkleDistributorSDK(
      provider,
      new Program(
        MerkleDistributorJSON,
        PROGRAM_ID,
        anchorProvider
      ) as unknown as MerkleDistributorProgram
    );
  }

  /**
   * Load an existing merkle distributor.
   * @returns {MerkleDistributorWrapper}
   */
  public async loadDistributor(
    key: PublicKey
  ): Promise<MerkleDistributorWrapper> {
    return await MerkleDistributorWrapper.load(this, key);
  }

  /**
   * Create a merkle distributor.
   * @returns {PendingDistributor}
   */
  public async createDistributor(
    args: Omit<CreateDistributorArgs, "sdk">
  ): Promise<PendingDistributor> {
    return await MerkleDistributorWrapper.createDistributor({
      sdk: this,
      ...args,
    });
  }
}
