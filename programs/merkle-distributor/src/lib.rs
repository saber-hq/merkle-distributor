//! A program for distributing tokens efficiently via uploading a [Merkle root](https://en.wikipedia.org/wiki/Merkle_tree).
//!
//! This program is largely based off of [Uniswap's Merkle Distributor](https://github.com/Uniswap/merkle-distributor).
//!
//! # Rationale
//!
//! Although Solana has low fees for executing transactions, it requires staking tokens to pay for storage costs, also known as "rent". These rent costs can add up when sending tokens to thousands or tens of thousands of wallets, making it economically unreasonable to distribute tokens to everyone.
//!
//! The Merkle distributor, pioneered by [Uniswap](https://github.com/Uniswap/merkle-distributor), solves this issue by deriving a 256-bit "root hash" from a tree of balances. This puts the gas cost on the claimer. Solana has the additional advantage of being able to reclaim rent from closed token accounts, so the net cost to the user should be around `0.000010 SOL` (at the time of writing).
//!
//! The Merkle distributor is also significantly easier to manage from an operations perspective, since one does not need to send a transaction to each individual address that may be redeeming tokens.
//!
//! # License
//!
//! The Merkle distributor program and SDK is distributed under the GPL v3.0 license.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use program_bitmap::{program::ProgramBitmap, OwnedBitmap};
use vipers::prelude::*;

pub mod merkle_proof;

declare_id!("MRKGLMizK9XSTaD1d1jbVkdHZbQVCSnPpYiTw9aKQv8");

/// The [merkle_distributor] program.
#[program]
pub mod merkle_distributor {
    use super::*;

    /// Creates a new [MerkleDistributor].
    /// After creating this [MerkleDistributor], the account should be seeded with tokens via its ATA.
    pub fn new_distributor(
        ctx: Context<NewDistributor>,
        bump: u8,
        root: [u8; 32],
        max_total_claim: u64,
        max_num_nodes: u64,
    ) -> ProgramResult {
        let distributor = &mut ctx.accounts.distributor;
        let bitmap = &mut ctx.accounts.bitmap;

        distributor.base = ctx.accounts.base.key();
        distributor.bump = bump;

        distributor.root = root;
        distributor.mint = ctx.accounts.mint.key();
        distributor.bitmap = bitmap.key();

        distributor.max_total_claim = max_total_claim;
        distributor.max_num_nodes = max_num_nodes;
        distributor.total_amount_claimed = 0;
        distributor.num_nodes_claimed = 0;

        let seeds = [
            b"MerkleDistributor".as_ref(),
            &distributor.base.to_bytes(),
            &[ctx.accounts.distributor.bump],
        ];
        let cpi_seeds = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.bitmap_program.to_account_info(),
            program_bitmap::cpi::accounts::Initialize {
                ob: bitmap.to_account_info(),
                owner: ctx.accounts.distributor.to_account_info(),
            },
            cpi_seeds,
        );
        program_bitmap::cpi::initialize(cpi_ctx, max_num_nodes + 8)?;
        bitmap.reload()?;
        require!(bitmap.capacity() >= max_num_nodes, ErrorCode::InvalidBitmap);

        Ok(())
    }

    /// Claims tokens from the [MerkleDistributor].
    pub fn claim(
        ctx: Context<Claim>,
        index: u64,
        amount: u64,
        proof: Vec<[u8; 32]>,
    ) -> ProgramResult {
        let claimant_account = &ctx.accounts.claimant;
        let distributor = &ctx.accounts.distributor;
        require!(claimant_account.is_signer, Unauthorized);

        require!(!ctx.accounts.bitmap.is_set(index), DropAlreadyClaimed);

        // Verify the merkle proof.
        let node = anchor_lang::solana_program::keccak::hashv(&[
            &index.to_le_bytes(),
            &claimant_account.key().to_bytes(),
            &amount.to_le_bytes(),
        ]);
        require!(
            merkle_proof::verify(proof, distributor.root, node.0),
            InvalidProof
        );

        let seeds = [
            b"MerkleDistributor".as_ref(),
            &distributor.base.to_bytes(),
            &[ctx.accounts.distributor.bump],
        ];

        let bitmap_seeds = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.bitmap_program.to_account_info(),
            program_bitmap::cpi::accounts::Admin {
                ob: ctx.accounts.bitmap.to_account_info(),
                owner: ctx.accounts.distributor.to_account_info(),
            },
            bitmap_seeds,
        );
        program_bitmap::cpi::set(cpi_ctx, index)?;

        require!(
            ctx.accounts.to.owner == claimant_account.key(),
            OwnerMismatch
        );
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.from.to_account_info(),
                    to: ctx.accounts.to.to_account_info(),
                    authority: ctx.accounts.distributor.to_account_info(),
                },
            )
            .with_signer(&[&seeds[..]]),
            amount,
        )?;

        let distributor = &mut ctx.accounts.distributor;
        distributor.total_amount_claimed =
            unwrap_int!(distributor.total_amount_claimed.checked_add(amount));
        require!(
            distributor.total_amount_claimed <= distributor.max_total_claim,
            ExceededMaxClaim
        );
        distributor.num_nodes_claimed = unwrap_int!(distributor.num_nodes_claimed.checked_add(1));
        require!(
            distributor.num_nodes_claimed <= distributor.max_num_nodes,
            ExceededMaxNumNodes
        );

        emit!(ClaimedEvent {
            index,
            claimant: claimant_account.key(),
            amount
        });
        Ok(())
    }
}

/// Accounts for [merkle_distributor::new_distributor].
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct NewDistributor<'info> {
    /// Base key of the distributor.
    pub base: Signer<'info>,

    /// [MerkleDistributor].
    #[account(
        init,
        seeds = [
            b"MerkleDistributor".as_ref(),
            base.key().to_bytes().as_ref()
        ],
        bump = bump,
        payer = payer
    )]
    pub distributor: Account<'info, MerkleDistributor>,

    #[account(zero)]
    pub bitmap: Account<'info, OwnedBitmap>,
    /// The mint to distribute.
    pub mint: Account<'info, Mint>,

    /// Payer to create the distributor.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The [System] program.
    pub system_program: Program<'info, System>,
    pub bitmap_program: Program<'info, ProgramBitmap>,
}

/// [merkle_distributor::claim] accounts.
#[derive(Accounts)]
pub struct Claim<'info> {
    /// The [MerkleDistributor].
    #[account(mut, has_one = bitmap)]
    pub distributor: Account<'info, MerkleDistributor>,

    #[account(mut)]
    pub bitmap: Account<'info, OwnedBitmap>,

    /// Distributor ATA containing the tokens to distribute.
    #[account(mut, associated_token::mint = distributor.mint, associated_token::authority = distributor)]
    pub from: Account<'info, TokenAccount>,

    /// Account to send the claimed tokens to.
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,

    /// Who is claiming the tokens.
    pub claimant: Signer<'info>,

    /// Payer of the claim.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The [System] program.
    pub system_program: Program<'info, System>,

    /// SPL [Token] program.
    pub token_program: Program<'info, Token>,

    pub bitmap_program: Program<'info, ProgramBitmap>,
}

/// State for the account which distributes tokens.
#[account]
#[derive(Default)]
pub struct MerkleDistributor {
    /// Base key used to generate the PDA.
    pub base: Pubkey,
    /// Bump seed.
    pub bump: u8,

    /// The 256-bit merkle root.
    pub root: [u8; 32],

    /// [Mint] of the token to be distributed.
    pub mint: Pubkey,
    pub bitmap: Pubkey,
    /// Maximum number of tokens that can ever be claimed from this [MerkleDistributor].
    pub max_total_claim: u64,
    /// Maximum number of nodes that can ever be claimed from this [MerkleDistributor].
    pub max_num_nodes: u64,
    /// Total amount of tokens that have been claimed.
    pub total_amount_claimed: u64,
    /// Number of nodes that have been claimed.
    pub num_nodes_claimed: u64,
}

/// Emitted when tokens are claimed.
#[event]
pub struct ClaimedEvent {
    /// Index of the claim.
    pub index: u64,
    /// User that claimed.
    pub claimant: Pubkey,
    /// Amount of tokens to distribute.
    pub amount: u64,
}

/// Error codes.
#[error]
pub enum ErrorCode {
    #[msg("Invalid Merkle proof.")]
    InvalidProof,
    #[msg("Drop already claimed.")]
    DropAlreadyClaimed,
    #[msg("Exceeded maximum claim amount.")]
    ExceededMaxClaim,
    #[msg("Exceeded maximum number of claimed nodes.")]
    ExceededMaxNumNodes,
    #[msg("Account is not authorized to execute this instruction")]
    Unauthorized,
    #[msg("Token account owner did not match intended owner")]
    OwnerMismatch,
    #[msg("Invalid bitmap")]
    InvalidBitmap,
}
