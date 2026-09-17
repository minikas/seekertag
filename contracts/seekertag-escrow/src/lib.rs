use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SolTransfer};
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

declare_id!("4vUZidqPqRNfVvagWxzZL4xBXeyJLrkuwKfKicVniQWB");
const DAY: i64 = 86_400;
const MAX_DAYS: u16 = 365;
const RESERVED: u8 = 1;
const RELEASED: u8 = 2;
const REFUNDED: u8 = 3;

#[program]
pub mod seekertag_escrow {
    use super::*;

    pub fn fund_sol(
        ctx: Context<FundSol>,
        reward_id: [u8; 32],
        amount: u64,
        days: u16,
        verifier: Pubkey,
    ) -> Result<()> {
        init(
            &mut ctx.accounts.escrow,
            ctx.accounts.owner.key(),
            verifier,
            Pubkey::default(),
            reward_id,
            amount,
            days,
            ctx.bumps.escrow,
        )?;
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                SolTransfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            amount,
        )
    }

    pub fn fund_token(
        ctx: Context<FundToken>,
        reward_id: [u8; 32],
        amount: u64,
        days: u16,
        verifier: Pubkey,
    ) -> Result<()> {
        init(
            &mut ctx.accounts.escrow,
            ctx.accounts.owner.key(),
            verifier,
            ctx.accounts.mint.key(),
            reward_id,
            amount,
            days,
            ctx.bumps.escrow,
        )?;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )
    }

    pub fn renew(ctx: Context<Manage>, days: u16) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        reserved(escrow)?;
        valid_days(days)?;
        let now = Clock::get()?.unix_timestamp;
        let end = escrow
            .refund_after
            .max(now)
            .checked_add(i64::from(days) * DAY)
            .ok_or(EscrowError::InvalidDuration)?;
        require!(
            end <= now + i64::from(MAX_DAYS) * DAY,
            EscrowError::InvalidDuration
        );
        escrow.refund_after = end;
        Ok(())
    }

    pub fn release_sol(ctx: Context<ReleaseSol>, report: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        release_allowed(escrow, ctx.accounts.recipient.key(), report)?;
        require_keys_eq!(escrow.mint, Pubkey::default(), EscrowError::WrongAsset);
        move_sol(
            &escrow.to_account_info(),
            &ctx.accounts.recipient.to_account_info(),
            escrow.amount,
        )?;
        escrow.status = RELEASED;
        escrow.recipient = ctx.accounts.recipient.key();
        escrow.report = report;
        return_surplus(
            &escrow.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
        )
    }

    pub fn refund_sol(ctx: Context<Manage>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        refund_allowed(escrow)?;
        require_keys_eq!(escrow.mint, Pubkey::default(), EscrowError::WrongAsset);
        escrow.status = REFUNDED;
        return_surplus(
            &escrow.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
        )
    }

    pub fn release_token(ctx: Context<ReleaseToken>, report: [u8; 32]) -> Result<()> {
        release_allowed(&ctx.accounts.escrow, ctx.accounts.recipient.key(), report)?;
        let escrow = &ctx.accounts.escrow;
        let seeds: &[&[u8]] = &[
            b"reward",
            escrow.owner.as_ref(),
            &escrow.reward_id,
            &[escrow.bump],
        ];
        let signer = &[seeds];
        transfer_tokens(
            &ctx.accounts.token_program,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
            &ctx.accounts.destination,
            &escrow.to_account_info(),
            signer,
            escrow.amount,
        )?;
        // Donations cannot prevent settlement or strand the original deposit.
        let surplus = ctx
            .accounts
            .vault
            .amount
            .checked_sub(escrow.amount)
            .ok_or(EscrowError::InsufficientVault)?;
        if surplus > 0 {
            transfer_tokens(
                &ctx.accounts.token_program,
                &ctx.accounts.mint,
                &ctx.accounts.vault,
                &ctx.accounts.refund_destination,
                &escrow.to_account_info(),
                signer,
                surplus,
            )?;
        }
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.owner.to_account_info(),
                authority: escrow.to_account_info(),
            },
            signer,
        ))?;
        let escrow = &mut ctx.accounts.escrow;
        escrow.status = RELEASED;
        escrow.recipient = ctx.accounts.recipient.key();
        escrow.report = report;
        return_surplus(
            &escrow.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
        )
    }

    pub fn refund_token(ctx: Context<RefundToken>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        refund_allowed(escrow)?;
        require!(
            ctx.accounts.vault.amount >= escrow.amount,
            EscrowError::InsufficientVault
        );
        let seeds: &[&[u8]] = &[
            b"reward",
            escrow.owner.as_ref(),
            &escrow.reward_id,
            &[escrow.bump],
        ];
        let signer = &[seeds];
        transfer_tokens(
            &ctx.accounts.token_program,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
            &ctx.accounts.destination,
            &escrow.to_account_info(),
            signer,
            ctx.accounts.vault.amount,
        )?;
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.owner.to_account_info(),
                authority: escrow.to_account_info(),
            },
            signer,
        ))?;
        ctx.accounts.escrow.status = REFUNDED;
        return_surplus(
            &ctx.accounts.escrow.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
        )
    }
}

fn valid_days(days: u16) -> Result<()> {
    require!((1..=MAX_DAYS).contains(&days), EscrowError::InvalidDuration);
    Ok(())
}
fn init(
    escrow: &mut Account<Escrow>,
    owner: Pubkey,
    verifier: Pubkey,
    mint: Pubkey,
    reward_id: [u8; 32],
    amount: u64,
    days: u16,
    bump: u8,
) -> Result<()> {
    require!(
        amount > 0 && reward_id != [0; 32],
        EscrowError::InvalidAmount
    );
    require!(
        verifier != Pubkey::default() && verifier != owner,
        EscrowError::InvalidVerifier
    );
    valid_days(days)?;
    let now = Clock::get()?.unix_timestamp;
    escrow.set_inner(Escrow {
        owner,
        verifier,
        mint,
        reward_id,
        amount,
        deposited_at: now,
        refund_after: now + i64::from(days) * DAY,
        status: RESERVED,
        recipient: Pubkey::default(),
        report: [0; 32],
        bump,
    });
    Ok(())
}
fn reserved(escrow: &Escrow) -> Result<()> {
    require!(escrow.status == RESERVED, EscrowError::AlreadySettled);
    Ok(())
}
fn release_allowed(escrow: &Escrow, recipient: Pubkey, report: [u8; 32]) -> Result<()> {
    reserved(escrow)?;
    require!(
        recipient != escrow.owner && recipient != Pubkey::default() && report != [0; 32],
        EscrowError::InvalidRecipient
    );
    Ok(())
}
fn refund_allowed(escrow: &Escrow) -> Result<()> {
    reserved(escrow)?;
    require!(
        Clock::get()?.unix_timestamp >= escrow.refund_after,
        EscrowError::StillLocked
    );
    Ok(())
}
fn move_sol(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    from.sub_lamports(amount)?;
    to.add_lamports(amount)?;
    Ok(())
}
fn return_surplus(escrow: &AccountInfo, owner: &AccountInfo) -> Result<()> {
    let rent = Rent::get()?.minimum_balance(Escrow::SPACE);
    let surplus = escrow
        .lamports()
        .checked_sub(rent)
        .ok_or(EscrowError::InsufficientVault)?;
    move_sol(escrow, owner, surplus)
}
fn transfer_tokens<'info>(
    program: &Program<'info, Token>,
    mint: &Account<'info, Mint>,
    source: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    signer: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    token::transfer_checked(
        CpiContext::new_with_signer(
            program.to_account_info(),
            TransferChecked {
                from: source.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: authority.clone(),
            },
            signer,
        ),
        amount,
        mint.decimals,
    )
}

#[derive(Accounts)]
#[instruction(reward_id: [u8; 32])]
pub struct FundSol<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = Escrow::SPACE, seeds = [b"reward", owner.key().as_ref(), &reward_id], bump)]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(reward_id: [u8; 32])]
pub struct FundToken<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = Escrow::SPACE, seeds = [b"reward", owner.key().as_ref(), &reward_id], bump)]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub source: Account<'info, TokenAccount>,
    #[account(init, payer = owner, seeds = [b"vault", escrow.key().as_ref()], bump, token::mint = mint, token::authority = escrow)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Manage<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner, seeds = [b"reward", owner.key().as_ref(), &escrow.reward_id], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
}
#[derive(Accounts)]
pub struct ReleaseSol<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub verifier: Signer<'info>,
    #[account(mut, has_one = owner, has_one = verifier, seeds = [b"reward", owner.key().as_ref(), &escrow.reward_id], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
}
#[derive(Accounts)]
pub struct ReleaseToken<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub verifier: Signer<'info>,
    #[account(mut, has_one = owner, has_one = verifier, has_one = mint, seeds = [b"reward", owner.key().as_ref(), &escrow.reward_id], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    pub recipient: SystemAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", escrow.key().as_ref()], bump, token::mint = mint, token::authority = escrow)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = recipient)]
    pub destination: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub refund_destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct RefundToken<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner, has_one = mint, seeds = [b"reward", owner.key().as_ref(), &escrow.reward_id], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", escrow.key().as_ref()], bump, token::mint = mint, token::authority = escrow)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// A permanent receipt prevents reinitialization/replay and lets the API reconcile
// after a crash without relying on an RPC provider retaining transaction history.
#[account]
pub struct Escrow {
    pub owner: Pubkey,
    pub verifier: Pubkey,
    pub mint: Pubkey,
    pub reward_id: [u8; 32],
    pub amount: u64,
    pub deposited_at: i64,
    pub refund_after: i64,
    pub status: u8,
    pub recipient: Pubkey,
    pub report: [u8; 32],
    pub bump: u8,
}
impl Escrow {
    pub const SPACE: usize = 8 + 32 * 6 + 8 * 3 + 2;
}

#[error_code]
pub enum EscrowError {
    #[msg("Amount and reward ID must be nonzero")]
    InvalidAmount,
    #[msg("Choose 1 to 365 days; renewal cannot exceed 365 days from now")]
    InvalidDuration,
    #[msg("The reservation has already been settled")]
    AlreadySettled,
    #[msg("The reservation has not expired")]
    StillLocked,
    #[msg("Invalid recipient or report")]
    InvalidRecipient,
    #[msg("The verifier must be distinct from the depositor")]
    InvalidVerifier,
    #[msg("Wrong asset for this instruction")]
    WrongAsset,
    #[msg("Insufficient vault balance")]
    InsufficientVault,
}
