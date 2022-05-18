import { AnchorProvider, setProvider } from "@project-serum/anchor";
import { expectTX } from "@saberhq/chai-solana";
import type { Provider } from "@saberhq/solana-contrib";
import { SolanaProvider, TransactionEnvelope } from "@saberhq/solana-contrib";
import type { u64 } from "@saberhq/token-utils";
import { createMint, SPLToken, TOKEN_PROGRAM_ID } from "@saberhq/token-utils";
import type { PublicKey } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

import { MerkleDistributorSDK } from "../src/sdk";
import type { PendingDistributor } from "../src/types";

export const DEFAULT_TOKEN_DECIMALS = 6;

export const makeSDK = (): MerkleDistributorSDK => {
  const anchorProvider = AnchorProvider.env();
  // if the program isn't loaded, load the default
  // Configure the client to use the provider.
  setProvider(anchorProvider);

  const provider = SolanaProvider.init({
    connection: anchorProvider.connection,
    wallet: anchorProvider.wallet,
    opts: anchorProvider.opts,
  });

  return MerkleDistributorSDK.load({ provider });
};

export const createKeypairWithSOL = async (
  provider: Provider
): Promise<Keypair> => {
  const kp = Keypair.generate();
  await provider.connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
  return kp;
};

export const createAndSeedDistributor = async (
  sdk: MerkleDistributorSDK,
  maxTotalClaim: u64,
  maxNumNodes: u64,
  root: Buffer
): Promise<{
  mint: PublicKey;
  distributor: PublicKey;
  pendingDistributor: PendingDistributor;
}> => {
  const { provider } = sdk;
  const mint = await createMint(
    provider,
    provider.wallet.publicKey,
    DEFAULT_TOKEN_DECIMALS
  );

  const pendingDistributor = await sdk.createDistributor({
    root,
    maxTotalClaim,
    maxNumNodes,
    tokenMint: mint,
  });
  await expectTX(pendingDistributor.tx, "create merkle distributor").to.be
    .fulfilled;

  // Seed merkle distributor with tokens
  const ix = SPLToken.createMintToInstruction(
    TOKEN_PROGRAM_ID,
    mint,
    pendingDistributor.distributorATA,
    provider.wallet.publicKey,
    [],
    maxTotalClaim
  );
  const tx = new TransactionEnvelope(provider, [ix]);
  await expectTX(tx, "seed merkle distributor with tokens").to.be.fulfilled;

  return {
    mint,
    distributor: pendingDistributor.distributor,
    pendingDistributor,
  };
};
