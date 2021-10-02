import {
  SignerWallet,
  SingleConnectionBroadcaster,
  SolanaProvider,
} from "@saberhq/solana-contrib";
import { u64 } from "@saberhq/token-utils";
import { Connection, Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import invariant from "tiny-invariant";

import airdropDataRaw from "../data/airdrop-amounts.json";
import { MerkleDistributorSDK } from "../src/sdk";
import { parseBalanceMap } from "../src/utils/parse-balance-map";

const readKeyfile = (filePath: string): Keypair => {
  if (filePath[0] == "~") {
    filePath = path.join(process.env.HOME as string, filePath.slice(1));
  }

  return Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync(filePath, { encoding: "utf-8" }))
    )
  );
};

const main = async () => {
  const balanceMap: { [authority: string]: u64 } = {};
  airdropDataRaw.forEach(({ authority, amount }) => {
    const prevBalance = balanceMap[authority];
    if (prevBalance) {
      balanceMap[authority] = prevBalance.add(new u64(amount));
    } else {
      balanceMap[authority] = new u64(amount);
    }
  });

  const { claims, merkleRoot, tokenTotal } = parseBalanceMap(
    Object.entries(balanceMap).map(([authority, amount]) => ({
      address: authority,
      earnings: amount.toString(),
    }))
  );

  const rpcURL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcURL);
  const keypair = readKeyfile(
    process.env.PAYER_KEYFILE ?? "~/.config/solana/id.json"
  );

  const provider = new SolanaProvider(
    connection,
    new SingleConnectionBroadcaster(connection),
    new SignerWallet(keypair)
  );

  const sdk = MerkleDistributorSDK.load({ provider });
  invariant(process.env.MINT_KEYFILE, "mint keyfile not found");
  const mintKeypair = readKeyfile(process.env.MINT_KEYFILE);

  const pendingDistributor = await sdk.createDistributor({
    root: merkleRoot,
    maxTotalClaim: new u64(tokenTotal),
    maxNumNodes: new u64(Object.keys(claims).length),
    tokenMint: mintKeypair.publicKey,
  });

  const { tx, ...distributorInfo } = pendingDistributor;
  const pendingTx = await tx.send();
  const receipt = await pendingTx.wait();
  receipt.printLogs();

  console.log(
    JSON.stringify(
      {
        bump: distributorInfo.bump,
        distributor: distributorInfo.distributor.toString(),
        distribtuorATA: distributorInfo.distributorATA.toString(),
      },
      null,
      2
    )
  );
};

main()
  .then()
  .catch((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    } else {
      process.exit(0);
    }
  });
