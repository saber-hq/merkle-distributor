import type {Program} from "@project-serum/anchor";
import {BN, workspace} from "@project-serum/anchor";
import {createAssociatedTokenAccount, getAssociatedTokenAddress,} from "@project-serum/associated-token";
import {createMintInstructions, getTokenAccount,} from "@project-serum/common";
import {mintTo, TOKEN_PROGRAM_ID} from "@project-serum/serum/lib/token-instructions";
import {Keypair, PublicKey, SystemProgram, Transaction,} from "@solana/web3.js";
import {BalanceTree, toBytes32Array} from "../src/utils";
import assert from "assert";

const program: Program = workspace.PngMerkleDistributor;
const [provider, payer] = [program.provider, program.provider.wallet.publicKey];

const MAX_NUM_NODES = new BN(3);
const MAX_TOTAL_CLAIM = new BN(1_000_000_000_000);
const airDropMintKeypair = Keypair.generate();
const creatorKeypair = Keypair.generate();
const creatorKeypair2 = Keypair.generate();
const airDropMint = airDropMintKeypair.publicKey;
const airDropMintDecimals = 6;
const maxNumNodes = MAX_NUM_NODES;
const maxTotalClaim = MAX_TOTAL_CLAIM;
let bump: number;
let distributor, distributorHolder: PublicKey;

describe("png-merkle-distributor", () => {
    const kpOne = Keypair.generate();
    const kpTwo = Keypair.generate();
    const kpThree = Keypair.generate();
    const allKps = [kpOne, kpTwo, kpThree];

    let claimAmountOne = new BN(100);
    let claimAmountTwo = new BN(101);
    let claimAmountThree = new BN(102);
    let tree = new BalanceTree([
        {account: kpOne.publicKey, amount: claimAmountOne},
        {account: kpTwo.publicKey, amount: claimAmountTwo},
        {account: kpThree.publicKey, amount: claimAmountThree},
    ]);
    let root = tree.getRoot();

    it("init mint and airdrop account", async () => {

        await Promise.all(
            allKps.map(async (kp) => {
                await provider.connection.requestAirdrop(kp.publicKey, 10e9);
            })
        );

        await provider.send(
            new Transaction().add(
                ...(await createMintInstructions(
                    provider,
                    payer,
                    airDropMint,
                    airDropMintDecimals
                )),
                await createAssociatedTokenAccount(
                    payer,
                    payer,
                    airDropMint
                ),
            ),
            [airDropMintKeypair]
        );
    })

    it("new distributor and found distributor holder", async () => {
        [distributor, bump] = await PublicKey.findProgramAddress(
            [Buffer.from("MerkleDistributor"), creatorKeypair.publicKey.toBuffer()],
            program.programId
        );

        await program.rpc.newDistributor(
            new BN(bump),
            toBytes32Array(root),
            new BN(maxTotalClaim),
            new BN(maxNumNodes),
            {
                accounts: {
                    base: creatorKeypair.publicKey,
                    adminAuth: creatorKeypair.publicKey,
                    distributor: distributor,
                    mint: airDropMint,
                    payer: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                },
                signers: [creatorKeypair],
            }
        );
        const distributorAcc = await program.account.merkleDistributor.fetch(distributor);
        assert(distributorAcc.maxTotalClaim.eq(maxTotalClaim));
        assert(distributorAcc.maxNumNodes.eq(maxNumNodes));

        distributorHolder = await getAssociatedTokenAddress(distributor, airDropMint)
        await provider.send(
            new Transaction().add(
                await createAssociatedTokenAccount(
                    payer,
                    distributor,
                    airDropMint
                ),
                mintTo({
                    mint: airDropMint,
                    mintAuthority: payer,
                    destination: distributorHolder,
                    amount: maxTotalClaim,
                }),
            )
        );

        const rewardsHolderAccAfter = await getTokenAccount(
            provider,
            distributorHolder,
        );
        assert(
            rewardsHolderAccAfter.amount
                .eq(maxTotalClaim),
        );
    })

    it("success on first claim", async () => {
        await Promise.all(
            allKps.map(async (kp, index) => {
                const amount = new BN(100 + index);
                const proof = tree.getProof(index, kp.publicKey, amount);
                let [claimStatus, claimNonce] = await PublicKey.findProgramAddress(
                    [Buffer.from("ClaimStatus"), distributor.toBuffer(), kp.publicKey.toBuffer()],
                    program.programId
                );
                await provider.send(
                    new Transaction().add(
                        await createAssociatedTokenAccount(
                            payer,
                            kp.publicKey,
                            airDropMint
                        )
                    )
                )
                const kpHolder = await getAssociatedTokenAddress(kp.publicKey, airDropMint)
                await program.rpc.claim(
                    new BN(claimNonce),
                    new BN(index),
                    amount,
                    proof.map((p) => toBytes32Array(p)),
                    {
                        accounts: {
                            distributor,
                            claimStatus,
                            from: distributorHolder,
                            to: kpHolder,
                            claimant: kp.publicKey,
                            payer,
                            systemProgram: SystemProgram.programId,
                            tokenProgram: TOKEN_PROGRAM_ID,
                        },
                        signers: [kp],
                    }
                );

                const kpHolderAfter = await getTokenAccount(
                    provider,
                    kpHolder,
                );
                const claimStatusAcc = await program.account.claimStatus.fetch(claimStatus);
                assert(kpHolderAfter.amount.eq(amount));
                assert(claimStatusAcc.claimedAmount.eq(amount));
            })
        );

    });

    it("transfer admin auth", async () => {
        await program.rpc.updateAdminAuth(
            {
                accounts: {
                    newAdminAuth: creatorKeypair2.publicKey,
                    adminAuth: creatorKeypair.publicKey,
                    distributor: distributor,
                    payer: provider.wallet.publicKey,
                },
                signers: [creatorKeypair, creatorKeypair2],
            }
        );
        const distributorAcc = await program.account.merkleDistributor.fetch(distributor);
        assert.equal(distributorAcc.adminAuth.toString(), creatorKeypair2.publicKey.toString());
    })

    it("10 additional airdrops and update root", async () => {
        claimAmountOne = claimAmountOne.add(new BN(10));
        claimAmountTwo = claimAmountTwo.add(new BN(10));
        claimAmountThree = claimAmountThree.add(new BN(10));
        tree = new BalanceTree([
            {account: kpOne.publicKey, amount: claimAmountOne},
            {account: kpTwo.publicKey, amount: claimAmountTwo},
            {account: kpThree.publicKey, amount: claimAmountThree},
        ]);
        root = tree.getRoot()
        await program.rpc.updateDistributor(
            toBytes32Array(root),
            new BN(maxTotalClaim),
            new BN(maxNumNodes),
            {
                accounts: {
                    adminAuth: creatorKeypair2.publicKey,
                    distributor: distributor,
                    payer: provider.wallet.publicKey,
                },
                signers: [creatorKeypair2],
            }
        );
        const distributorAcc = await program.account.merkleDistributor.fetch(distributor);
        assert.equal(distributorAcc.root.toString(), toBytes32Array(root).toString());
        assert.equal(distributorAcc.numNodesClaimed, 0);
    })

    it("claim2 ,after should equal before add 10", async () => {
        await Promise.all(
            allKps.map(async (kp, index) => {
                const amount = new BN(110 + index);
                const proof = tree.getProof(index, kp.publicKey, amount);
                const [claimStatus, claimNonce] = await PublicKey.findProgramAddress(
                    [Buffer.from("ClaimStatus"), distributor.toBuffer(), kp.publicKey.toBuffer()],
                    program.programId
                );

                const kpHolder = await getAssociatedTokenAddress(kp.publicKey, airDropMint)
                const kpHolderBefore = await getTokenAccount(
                    provider,
                    kpHolder,
                );
                await program.rpc.claim(
                    new BN(claimNonce),
                    new BN(index),
                    amount,
                    proof.map((p) => toBytes32Array(p)),
                    {
                        accounts: {
                            distributor,
                            claimStatus,
                            from: distributorHolder,
                            to: kpHolder,
                            claimant: kp.publicKey,
                            payer,
                            systemProgram: SystemProgram.programId,
                            tokenProgram: TOKEN_PROGRAM_ID,
                        },
                        signers: [kp],
                    }
                );
                const kpHolderAfter = await getTokenAccount(
                    provider,
                    kpHolder,
                );
                assert(kpHolderAfter.amount.eq(amount));
                assert(kpHolderAfter.amount.sub(kpHolderBefore.amount).eq(new BN(10)));
            })
        );
    })
});
