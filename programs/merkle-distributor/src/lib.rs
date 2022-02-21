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
use vipers::prelude::*;

pub mod merkle_proof;

declare_id!("PMRKTWvK9f1cPkQuXvvyDPmyCSoq8FdedCimXrXJp8M");

/// The [merkle_distributor] program.
#[program]
pub mod merkle_distributor {
    #[allow(deprecated)]
    use vipers::assert_ata;

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

        distributor.base = ctx.accounts.base.key();
        distributor.admin_auth = ctx.accounts.admin_auth.key();

        distributor.bump = bump;

        distributor.root = root;
        distributor.mint = ctx.accounts.mint.key();

        distributor.max_total_claim = max_total_claim;
        distributor.max_num_nodes = max_num_nodes;
        distributor.total_amount_claimed = 0;
        distributor.num_nodes_claimed = 0;

        Ok(())
    }

    pub fn update_distributor(
        ctx: Context<UpdateDistributor>,
        root: [u8; 32],
        max_total_claim: u64,
        max_num_nodes: u64,
    ) -> ProgramResult {
        let distributor = &mut ctx.accounts.distributor;

        distributor.root = root;
        distributor.max_total_claim = max_total_claim;
        distributor.max_num_nodes = max_num_nodes;
        distributor.num_nodes_claimed = 0;

        Ok(())
    }

    /// Claims tokens from the [MerkleDistributor].
    #[allow(deprecated)]
    pub fn claim(
        ctx: Context<Claim>,
        _bump: u8,
        index: u64,
        amount: u64,
        proof: Vec<[u8; 32]>,
    ) -> ProgramResult {
        let claim_status = &mut ctx.accounts.claim_status;
        require!(claim_status.claimed_amount < amount, NoClaimableAmount);

        let claimant_account = &ctx.accounts.claimant;
        let distributor = &ctx.accounts.distributor;

        // Check whether payer is the admin or the claimant
        if (ctx.accounts.payer.key() != claimant_account.key())
            && (ctx.accounts.payer.key() != distributor.admin_auth)
        {
            return Err(ErrorCode::Unauthorized)?;
        }

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

        let claim_amount = amount.checked_sub(claim_status.claimed_amount).unwrap();

        // Mark it claimed and send the tokens.
        claim_status.claimed_amount = amount;
        let clock = Clock::get()?;
        claim_status.claimed_at = clock.unix_timestamp;
        claim_status.claimant = claimant_account.key();

        let seeds = [
            b"MerkleDistributor".as_ref(),
            &distributor.base.to_bytes(),
            &[ctx.accounts.distributor.bump],
        ];

        assert_ata!(
            ctx.accounts.from,
            ctx.accounts.distributor,
            distributor.mint
        );
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
            claim_amount,
        )?;

        let distributor = &mut ctx.accounts.distributor;
        distributor.total_amount_claimed =
            unwrap_int!(distributor.total_amount_claimed.checked_add(claim_amount));
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
            root: distributor.root,
            index,
            claimant: claimant_account.key(),
            claim_amount: claim_amount,
        });
        Ok(())
    }

    pub fn update_admin_auth(ctx: Context<UpdateAdminAuth>) -> ProgramResult {
        let distributor = &mut ctx.accounts.distributor;
        distributor.admin_auth = ctx.accounts.new_admin_auth.key();

        Ok(())
    }
}

/// Accounts for [merkle_distributor::new_distributor].
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct NewDistributor<'info> {
    /// Base key of the distributor.
    pub base: Signer<'info>,
    /// Admin key of the distributor.
    pub admin_auth: Signer<'info>,

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

    /// The mint to distribute.
    pub mint: Account<'info, Mint>,

    /// Payer to create the distributor.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The [System] program.
    pub system_program: Program<'info, System>,
}

/// Accounts for [merkle_distributor::update_distributor].
#[derive(Accounts)]
pub struct UpdateDistributor<'info> {
    /// Admin key of the distributor.
    pub admin_auth: Signer<'info>,

    #[account(mut, has_one = admin_auth @ ErrorCode::DistributorAdminMismatch)]
    pub distributor: Account<'info, MerkleDistributor>,
}

/// [merkle_distributor::claim] accounts.
#[derive(Accounts)]
#[instruction(_bump: u8)]
pub struct Claim<'info> {
    /// The [MerkleDistributor].
    #[account(mut)]
    pub distributor: Account<'info, MerkleDistributor>,

    /// Status of the claim.
    #[account(
    init_if_needed,
    seeds = [
    b"ClaimStatus".as_ref(),
    distributor.key().to_bytes().as_ref(),
    claimant.key().to_bytes().as_ref()
    ],
    bump = _bump,
    payer = payer
    )]
    pub claim_status: Account<'info, ClaimStatus>,

    /// Distributor ATA containing the tokens to distribute.
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,

    /// Account to send the claimed tokens to.
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,

    /// Who is claiming the tokens.
    pub claimant: UncheckedAccount<'info>,

    /// Payer of the claim.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The [System] program.
    pub system_program: Program<'info, System>,

    /// SPL [Token] program.
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateAdminAuth<'info> {
    pub new_admin_auth: Signer<'info>,

    pub admin_auth: Signer<'info>,

    #[account(mut, has_one = admin_auth @ ErrorCode::DistributorAdminMismatch)]
    pub distributor: Account<'info, MerkleDistributor>,
}

/// State for the account which distributes tokens.
#[account]
#[derive(Default)]
pub struct MerkleDistributor {
    /// Base key used to generate the PDA.
    pub base: Pubkey,
    /// Admin key used to generate the PDA.
    pub admin_auth: Pubkey,
    /// Bump seed.
    pub bump: u8,

    /// The 256-bit merkle root.
    pub root: [u8; 32],

    /// [Mint] of the token to be distributed.
    pub mint: Pubkey,
    /// Maximum number of tokens that can ever be claimed from this [MerkleDistributor].
    pub max_total_claim: u64,
    /// Maximum number of nodes that can ever be claimed from this [MerkleDistributor].
    pub max_num_nodes: u64,
    /// Total amount of tokens that have been claimed.
    pub total_amount_claimed: u64,
    /// Number of nodes that have been claimed.
    pub num_nodes_claimed: u64,
}

/// Holds whether or not a claimant has claimed tokens.
///
/// TODO: this is probably better stored as the node that was verified.
#[account]
#[derive(Default)]
pub struct ClaimStatus {
    /// Authority that claimed the tokens.
    pub claimant: Pubkey,
    /// When the tokens were claimed.
    pub claimed_at: i64,
    /// Amount of tokens claimed.
    pub claimed_amount: u64,
}

/// Emitted when tokens are claimed.
#[event]
pub struct ClaimedEvent {
    pub root: [u8; 32],
    /// Index of the claim.
    pub index: u64,
    /// User that claimed.
    pub claimant: Pubkey,
    /// Amount of tokens to distribute.
    pub claim_amount: u64,
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
    #[msg("Admin account not match distributor creator")]
    DistributorAdminMismatch,
    #[msg("no claimable amount")]
    NoClaimableAmount,
}
