//! Program for distributing tokens efficiently via uploading a Merkle root.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use vipers::{assert_ata, assert_owner, unwrap_int};

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
        auth_claimant_owner: bool,
    ) -> ProgramResult {
        let distributor = &mut ctx.accounts.distributor;

        distributor.base = ctx.accounts.base.key();
        distributor.bump = bump;

        distributor.root = root;
        distributor.mint = ctx.accounts.mint.key();

        distributor.max_total_claim = max_total_claim;
        distributor.max_num_nodes = max_num_nodes;
        distributor.total_amount_claimed = 0;
        distributor.num_nodes_claimed = 0;
        distributor.auth_claimant_owner = auth_claimant_owner;

        Ok(())
    }

    /// Claims tokens from the [MerkleDistributor].
    pub fn claim(
        ctx: Context<Claim>,
        _bump: u8,
        index: u64,
        amount: u64,
        proof: Vec<[u8; 32]>,
    ) -> ProgramResult {
        let claim_status = &mut ctx.accounts.claim_status;
        assert_owner!(claim_status.to_account_info(), ID);
        require!(
            // This check is redundant, we should not be able to initialize a claim status account at the same key.
            !claim_status.is_claimed && claim_status.claimed_at == 0,
            DropAlreadyClaimed
        );

        let maybe_claimant = &ctx.accounts.maybe_claimant;
        let distributor = &ctx.accounts.distributor;
        assert_ata!(
            ctx.accounts.from,
            ctx.accounts.distributor,
            distributor.mint
        );

        let claimant = ctx.accounts.to.owner;
        if distributor.auth_claimant_owner {
            require!(claimant == maybe_claimant.key(), OwnerMismatch);
        }

        // Verify the merkle proof.
        let node = anchor_lang::solana_program::keccak::hashv(&[
            &index.to_le_bytes(),
            &claimant.to_bytes(),
            &amount.to_le_bytes(),
        ]);
        require!(
            merkle_proof::verify(proof, distributor.root, node.0),
            InvalidProof
        );

        // Mark it claimed and send the tokens.
        claim_status.amount = amount;
        claim_status.is_claimed = true;
        let clock = Clock::get()?;
        claim_status.claimed_at = clock.unix_timestamp;
        claim_status.claimant = claimant;

        let seeds = [
            b"MerkleDistributor".as_ref(),
            &distributor.base.to_bytes(),
            &[ctx.accounts.distributor.bump],
        ];

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
            claimant,
            claimed_by: maybe_claimant.key(),
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

    /// The mint to distribute.
    pub mint: Account<'info, Mint>,

    /// Payer to create the distributor.
    pub payer: Signer<'info>,

    /// The [System] program.
    pub system_program: Program<'info, System>,
}

/// [merkle_distributor::claim] accounts.
#[derive(Accounts)]
#[instruction(_bump: u8, index: u64)]
pub struct Claim<'info> {
    /// The [MerkleDistributor].
    #[account(mut)]
    pub distributor: Account<'info, MerkleDistributor>,

    /// Status of the claim.
    #[account(
        init,
        seeds = [
            b"ClaimStatus".as_ref(),
            index.to_le_bytes().as_ref(),
            distributor.key().to_bytes().as_ref()
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
    pub maybe_claimant: Signer<'info>,

    /// Payer of the claim.
    pub payer: Signer<'info>,

    /// The [System] program.
    pub system_program: Program<'info, System>,

    /// SPL [Token] program.
    pub token_program: Program<'info, Token>,
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
    /// Maximum number of tokens that can ever be claimed from this [MerkleDistributor].
    pub max_total_claim: u64,
    /// Maximum number of nodes that can ever be claimed from this [MerkleDistributor].
    pub max_num_nodes: u64,
    /// Total amount of tokens that have been claimed.
    pub total_amount_claimed: u64,
    /// Number of nodes that have been claimed.
    pub num_nodes_claimed: u64,
    /// Indicates whether to check the owner of the `to` account is also the tx signer.
    pub auth_claimant_owner: bool,
}

#[account]
#[derive(Default)]
pub struct ClaimStatus {
    /// If true, the tokens have been claimed.
    pub is_claimed: bool,
    /// Authority that claimed the tokens.
    pub claimant: Pubkey,
    /// When the tokens were claimed.
    pub claimed_at: i64,
    /// Amount of tokens claimed.
    pub amount: u64,
}

/// Emitted when tokens are claimed.
#[event]
pub struct ClaimedEvent {
    /// Index of the claim.
    pub index: u64,
    /// User that claimed.
    pub claimant: Pubkey,
    /// User that signed tx. Can be the same as claimant.
    pub claimed_by: Pubkey,
    /// Amount of tokens to distribute.
    pub amount: u64,
}

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
}
