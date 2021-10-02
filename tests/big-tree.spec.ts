import { chaiSolana } from "@saberhq/chai-solana";
import { u64 } from "@saberhq/token-utils";
import type { PublicKey } from "@solana/web3.js";
import chai, { expect } from "chai";

import { BalanceTree } from "../src/utils";
import type { MerkleDistributorWrapper } from "../src/wrapper";
import { createAndSeedDistributor, makeSDK } from "./testutils";

chai.use(chaiSolana);

describe("big tree", () => {
  const NUM_LEAVES = 100_000;
  const NUM_SAMPLES = 25;

  const sdk = makeSDK();
  const { provider } = sdk;
  const elements: { account: PublicKey; amount: u64 }[] = [];

  for (let i = 0; i < NUM_LEAVES; i++) {
    const node = { account: provider.wallet.publicKey, amount: new u64(100) };
    elements.push(node);
  }
  const tree = new BalanceTree(elements);

  it("proof verification works", () => {
    const account = provider.wallet.publicKey;
    const root = tree.getRoot();

    for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
      const proof = tree.getProof(i, account, new u64(100));
      const validProof = BalanceTree.verifyProof(
        i,
        account,
        new u64(100),
        proof,
        root
      );
      expect(validProof).to.be.true;
    }
  });

  describe("check compute budget on claims", () => {
    let distributorWrapper: MerkleDistributorWrapper;

    before(async () => {
      const { distributor } = await createAndSeedDistributor(
        sdk,
        new u64(100 * NUM_LEAVES),
        new u64(NUM_LEAVES),
        tree.getRoot()
      );

      distributorWrapper = await sdk.loadDistributor(distributor);
    });

    it("claim deep node", async () => {
      const amount = new u64(100);
      const index = new u64(90000);
      const claimant = provider.wallet.publicKey;
      const tx = await distributorWrapper.claim({
        index,
        amount,
        proof: tree.getProof(
          index.toNumber(),
          provider.wallet.publicKey,
          amount
        ),
        claimant,
      });
      const pendingTx = await tx.send();
      const receipt = await pendingTx.wait();
      expect(receipt.computeUnits).to.be.lte(200000);
    });

    it("claims random distribution", async () => {
      for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
        const proof = tree.getProof(i, provider.wallet.publicKey, new u64(100));
        const tx = await distributorWrapper.claim({
          index: new u64(i),
          amount: new u64(100),
          proof,
          claimant: provider.wallet.publicKey,
        });
        const pendingTx = await tx.send();
        const receipt = await pendingTx.wait();
        expect(receipt.computeUnits).to.be.lte(200000);
      }
    });
  });
});
