import { chaiSolana, expectTX } from "@saberhq/chai-solana";
import { u64 } from "@saberhq/token-utils";
import type { PublicKey, SendTransactionError } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import chai, { expect } from "chai";
import invariant from "tiny-invariant";

import { findClaimStatusKey } from "../src/pda";
import { parseBalanceMap } from "../src/utils";
import { createAndSeedDistributor, makeSDK } from "./testutils";

chai.use(chaiSolana);

describe("parse BalanceMap", () => {
  const sdk = makeSDK();
  const { provider } = sdk;

  const keypairs: Keypair[] = [
    Keypair.fromSeed(Uint8Array.from(Array(32).fill(0))),
    Keypair.fromSeed(Uint8Array.from(Array(32).fill(2))),
    Keypair.fromSeed(Uint8Array.from(Array(32).fill(1))),
  ];

  let distributor: PublicKey;
  let claims: {
    [account: string]: {
      index: number;
      amount: u64;
      proof: Buffer[];
    };
  };

  before(async () => {
    await Promise.all(
      keypairs.map(async (kp) => {
        await provider.connection.requestAirdrop(
          kp.publicKey,
          LAMPORTS_PER_SOL
        );
      })
    );

    const {
      claims: innerClaims,
      merkleRoot,
      tokenTotal,
    } = parseBalanceMap(
      keypairs.map((kp, i) => ({
        address: kp.publicKey.toString(),
        earnings: new u64("1000000").mul(new u64(i + 1)).toString(),
      }))
    );
    expect(tokenTotal).to.equal("6000000");

    const { pendingDistributor } = await createAndSeedDistributor(
      sdk,
      new u64(tokenTotal),
      new u64(keypairs.length),
      merkleRoot
    );

    claims = innerClaims;
    distributor = pendingDistributor.distributor;
  });

  it("check the proofs is as expected", () => {
    invariant(keypairs[0], "keypair must exist");
    invariant(keypairs[1], "keypair must exist");
    invariant(keypairs[2], "keypair must exist");

    expect(claims).to.deep.eq({
      [keypairs[0].publicKey.toString()]: {
        index: 0,
        amount: new u64("1000000"),
        proof: [
          Buffer.from(
            "607e67765bcf4177e16fccd6149a4cfcd05d291ab664d24b8f7455d08aa121af",
            "hex"
          ),
        ],
      },
      [keypairs[1].publicKey.toString()]: {
        index: 1,
        amount: new u64("2000000"),
        proof: [
          Buffer.from(
            "0e21270c3d6d0301cce89f02f6b1c0728836b240263eb18026a7e8f0888d1cb3",
            "hex"
          ),
          Buffer.from(
            "57a5e990a9233980bbf1b2bb45484b8f6d374116fb20de4044f4d57fc0ab512b",
            "hex"
          ),
        ],
      },
      [keypairs[2].publicKey.toString()]: {
        index: 2,
        amount: new u64("3000000"),
        proof: [
          Buffer.from(
            "064d3da266f8756627ec7afda54dbfa8ac806030d2092b193840dfc392486468",
            "hex"
          ),
          Buffer.from(
            "57a5e990a9233980bbf1b2bb45484b8f6d374116fb20de4044f4d57fc0ab512b",
            "hex"
          ),
        ],
      },
    });
  });

  it("all claims work exactly once", async () => {
    const distributorW = await sdk.loadDistributor(distributor);

    await Promise.all(
      keypairs.map(async (claimantKP) => {
        const claimant = claimantKP.publicKey;
        const claim = claims[claimant.toString()];
        invariant(claim, "claim must exist");
        const index = new u64(claim.index);

        const tx = await distributorW.claim({
          index,
          amount: claim.amount,
          proof: claim.proof,
          claimant: claimant,
        });
        tx.addSigners(claimantKP);

        await expectTX(tx, `claim tokens; index: ${claim.index}`).to.be
          .fulfilled;

        const badTx = await distributorW.claim({
          index,
          amount: claim.amount,
          proof: claim.proof,
          claimant,
        });
        badTx.addSigners(claimantKP);

        const [claimKey] = await findClaimStatusKey(index, distributorW.key);

        try {
          await badTx.confirm();
        } catch (e) {
          const err = e as SendTransactionError;
          expect(err.logs?.join(" ")).to.have.string(
            `Allocate: account Address { address: ${claimKey.toString()}, base: None } already in use`
          );
        }
      })
    );
  });
});
