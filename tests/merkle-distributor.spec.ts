import { chaiSolana, expectTX } from "@saberhq/chai-solana";
import {
  getATAAddress,
  getTokenAccount,
  u64,
  ZERO,
} from "@saberhq/token-utils";
import type { SendTransactionError } from "@solana/web3.js";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import chai, { expect } from "chai";

import { MerkleDistributorErrors } from "../src/idls/merkle_distributor";
import { findClaimStatusKey } from "../src/pda";
import { BalanceTree } from "../src/utils";
import {
  createAndSeedDistributor,
  createKeypairWithSOL,
  makeSDK,
} from "./testutils";

chai.use(chaiSolana);

const MAX_NUM_NODES = new u64(3);
const MAX_TOTAL_CLAIM = new u64(1_000_000_000_000);
const ZERO_BYTES32 = Buffer.alloc(32);

describe("merkle-distributor", () => {
  const sdk = makeSDK();
  const { provider } = sdk;

  it("Is initialized!", async () => {
    const { pendingDistributor, mint } = await createAndSeedDistributor(
      sdk,
      MAX_TOTAL_CLAIM,
      MAX_NUM_NODES,
      ZERO_BYTES32
    );
    const { distributor, base, bump } = pendingDistributor;
    const distributorW = await sdk.loadDistributor(distributor);

    const { data } = distributorW;
    expect(data.bump).to.equal(bump);
    expect(data.maxNumNodes.toString()).to.equal(MAX_NUM_NODES.toString());
    expect(data.maxTotalClaim.toString()).to.equal(MAX_TOTAL_CLAIM.toString());
    expect(data.base).to.eqAddress(base);
    expect(data.mint).to.eqAddress(mint);
    expect(data.numNodesClaimed.toString()).to.equal(ZERO.toString());
    expect(data.root).to.deep.equal(Array.from(new Uint8Array(ZERO_BYTES32)));
    expect(data.totalAmountClaimed.toString()).to.equal(ZERO.toString());

    const tokenAccountInfo = await getTokenAccount(
      provider,
      distributorW.distributorATA
    );
    expect(tokenAccountInfo.mint).to.eqAddress(mint);
    expect(tokenAccountInfo.amount.toString()).to.equal(
      MAX_TOTAL_CLAIM.toString()
    );
  });

  context("claim", () => {
    it("fails for empty proof", async () => {
      const { distributor } = await createAndSeedDistributor(
        sdk,
        MAX_TOTAL_CLAIM,
        MAX_NUM_NODES,
        ZERO_BYTES32
      );
      const distributorW = await sdk.loadDistributor(distributor);

      const claimantKP = Keypair.generate();
      const tx = await distributorW.claim({
        index: new u64(0),
        amount: new u64(10_000_000),
        proof: [],
        claimant: claimantKP.publicKey,
      });
      tx.addSigners(claimantKP);

      try {
        await tx.confirm();
      } catch (e) {
        const err = e as Error;
        expect(err.message).to.include(
          `0x${MerkleDistributorErrors.InvalidProof.code.toString(16)}`
        );
      }
    });

    it("success on three account tree", async () => {
      const kpOne = Keypair.generate();
      const kpTwo = Keypair.generate();
      const kpThree = Keypair.generate();
      const allKps = [kpOne, kpTwo, kpThree];
      await Promise.all(
        allKps.map(async (kp) => {
          await provider.connection.requestAirdrop(
            kp.publicKey,
            LAMPORTS_PER_SOL
          );
        })
      );

      const claimAmountOne = new u64(100);
      const claimAmountTwo = new u64(101);
      const claimAmountThree = new u64(102);
      const tree = new BalanceTree([
        { account: kpOne.publicKey, amount: claimAmountOne },
        { account: kpTwo.publicKey, amount: claimAmountTwo },
        { account: kpThree.publicKey, amount: claimAmountThree },
      ]);
      const { distributor } = await createAndSeedDistributor(
        sdk,
        MAX_TOTAL_CLAIM,
        MAX_NUM_NODES,
        tree.getRoot()
      );

      const distributorW = await sdk.loadDistributor(distributor);
      await Promise.all(
        allKps.map(async (kp, index) => {
          const amount = new u64(100 + index);
          const proof = tree.getProof(index, kp.publicKey, amount);

          const tx = await distributorW.claim({
            index: new u64(index),
            amount,
            proof,
            claimant: kp.publicKey,
          });
          tx.addSigners(kp);
          await expectTX(tx, `claim tokens; index ${index}`).to.be.fulfilled;

          const tokenAccountInfo = await getTokenAccount(
            provider,
            await getATAAddress({
              mint: distributorW.data.mint,
              owner: kp.publicKey,
            })
          );
          expect(tokenAccountInfo.amount.toString()).to.equal(
            amount.toString()
          );

          const claimStatus = await distributorW.getClaimStatus(new u64(index));
          expect(claimStatus.isClaimed).to.be.true;
          expect(claimStatus.claimant).to.eqAddress(kp.publicKey);
          expect(claimStatus.amount.toString()).to.equal(amount.toString());
        })
      );

      const expectedTotalClaimed = claimAmountOne
        .add(claimAmountTwo)
        .add(claimAmountThree);
      const tokenAccountInfo = await getTokenAccount(
        provider,
        distributorW.distributorATA
      );
      expect(tokenAccountInfo.amount.toString()).to.equal(
        MAX_TOTAL_CLAIM.sub(expectedTotalClaimed).toString()
      );

      await distributorW.reload();
      const { data } = distributorW;
      expect(data.numNodesClaimed.toNumber()).to.equal(allKps.length);
      expect(data.totalAmountClaimed.toString()).to.equal(
        expectedTotalClaimed.toString()
      );
    });

    it("cannot allow two claims", async () => {
      const userKP = await createKeypairWithSOL(provider);

      const claimAmount = new u64(1_000_000);
      const tree = new BalanceTree([
        { account: userKP.publicKey, amount: claimAmount },
      ]);
      const { distributor } = await createAndSeedDistributor(
        sdk,
        MAX_TOTAL_CLAIM,
        MAX_NUM_NODES,
        tree.getRoot()
      );
      const distributorW = await sdk.loadDistributor(distributor);

      const claim1 = await distributorW.claim({
        index: new u64(0),
        amount: claimAmount,
        proof: tree.getProof(0, userKP.publicKey, claimAmount),
        claimant: userKP.publicKey,
      });
      claim1.addSigners(userKP);
      await expectTX(claim1, "claim tokens").to.be.fulfilled;

      const claim2 = await distributorW.claim({
        index: new u64(0),
        amount: claimAmount,
        proof: tree.getProof(0, userKP.publicKey, claimAmount),
        claimant: userKP.publicKey,
      });
      claim2.addSigners(userKP);

      const [claimKey] = await findClaimStatusKey(new u64(0), distributorW.key);
      try {
        await claim2.confirm();
      } catch (e) {
        const err = e as SendTransactionError;
        expect(err.logs?.join(" ")).to.have.string(
          `Allocate: account Address { address: ${claimKey.toString()}, base: None } already in use`
        );
      }
    });

    it("cannot claim more than proof", async () => {
      const userKP = await createKeypairWithSOL(provider);

      const claimAmount = new u64(1_000_000);
      const tree = new BalanceTree([
        { account: userKP.publicKey, amount: new u64(1_000_000) },
      ]);
      const { distributor } = await createAndSeedDistributor(
        sdk,
        MAX_TOTAL_CLAIM,
        MAX_NUM_NODES,
        tree.getRoot()
      );
      const distributorW = await sdk.loadDistributor(distributor);

      const tx = await distributorW.claim({
        index: new u64(0),
        amount: new u64(2_000_000),
        proof: tree.getProof(0, userKP.publicKey, claimAmount),
        claimant: userKP.publicKey,
      });
      tx.addSigners(userKP);

      try {
        await tx.confirm();
      } catch (e) {
        const err = e as Error;
        expect(err.message).to.include(
          `0x${MerkleDistributorErrors.InvalidProof.code.toString(16)}`
        );
      }
    });

    it("cannot claim for address other than proof", async () => {
      const claimant = Keypair.generate().publicKey;
      const rogueKP = await createKeypairWithSOL(provider);

      const claimAmount = new u64(1_000_000);
      const tree = new BalanceTree([
        { account: claimant, amount: claimAmount },
      ]);
      const { distributor } = await createAndSeedDistributor(
        sdk,
        MAX_TOTAL_CLAIM,
        MAX_NUM_NODES,
        tree.getRoot()
      );
      const distributorW = await sdk.loadDistributor(distributor);

      const tx = await distributorW.claim({
        index: new u64(0),
        amount: new u64(2_000_000),
        proof: tree.getProof(0, claimant, claimAmount),
        claimant,
      });
      tx.addSigners(rogueKP);

      try {
        await tx.confirm();
      } catch (e) {
        const err = e as Error;
        expect(err.message).to.equal(
          `unknown signer: ${rogueKP.publicKey.toString()}`
        );
      }
    });
  });
});
