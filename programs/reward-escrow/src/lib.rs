//! Fixed-amount SPL-token escrow with a prior, recipient-bound owner commitment.
//! Persistent receipts prevent reuse. No administration or privileged withdrawal path.

use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_option::COption,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_sdk_ids::system_program;
use solana_system_interface::instruction as system_instruction;
use spl_token::state::{Account as TokenAccount, AccountState, Mint};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const RECEIPT_LEN: usize = 224;
pub const MAX_DURATION: i64 = 365 * 24 * 60 * 60;
const MAGIC: &[u8; 8] = b"SKREWRD2";
const ATA_PROGRAM: Pubkey = solana_program::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    InvalidInstruction = 0,
    InvalidAccounts,
    InvalidAuthority,
    InvalidAddress,
    InvalidMint,
    InvalidTokenAccount,
    InvalidAmount,
    InvalidExpiry,
    AlreadyInitialized,
    InvalidReceipt,
    AlreadySettled,
    Expired,
    NotExpired,
    InsufficientVaultBalance,
    InvalidReference,
    CommitmentActive,
    CommitmentRequired,
    StaleClaim,
    ClaimOverflow,
}
impl From<Error> for ProgramError {
    fn from(value: Error) -> Self {
        ProgramError::Custom(value as u32)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Receipt {
    pub status: u8,
    pub reward_bump: u8,
    pub vault_bump: u8,
    pub decimals: u8,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub reward_id: [u8; 32],
    pub amount: u64,
    pub expires_at: i64,
    pub recipient: Pubkey,
    pub report_ref: [u8; 32],
    pub created_at: i64,
    pub settled_at: i64,
    pub claim_seq: u64,
    pub committed_at: i64,
}

fn array<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N], ProgramError> {
    data.get(offset..offset + N)
        .and_then(|v| v.try_into().ok())
        .ok_or(Error::InvalidInstruction.into())
}
impl Receipt {
    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() != RECEIPT_LEN
            || &data[..8] != MAGIC
            || data[8] != 2
            || !(1..=4).contains(&data[9])
            || data[12] > 18
            || data[13..16] != [0; 3]
        {
            return Err(Error::InvalidReceipt.into());
        }
        let state = Self {
            status: data[9],
            reward_bump: data[10],
            vault_bump: data[11],
            decimals: data[12],
            owner: Pubkey::new_from_array(array(data, 16)?),
            mint: Pubkey::new_from_array(array(data, 48)?),
            reward_id: array(data, 80)?,
            amount: u64::from_le_bytes(array(data, 112)?),
            expires_at: i64::from_le_bytes(array(data, 120)?),
            recipient: Pubkey::new_from_array(array(data, 128)?),
            report_ref: array(data, 160)?,
            created_at: i64::from_le_bytes(array(data, 192)?),
            settled_at: i64::from_le_bytes(array(data, 200)?),
            claim_seq: u64::from_le_bytes(array(data, 208)?),
            committed_at: i64::from_le_bytes(array(data, 216)?),
        };
        let has_claim = state.status == 2 || state.status == 4;
        if state.amount == 0
            || state.created_at < 0
            || state.expires_at <= state.created_at
            || (has_claim
                && (state.claim_seq == 0
                    || state.recipient == Pubkey::default()
                    || state.report_ref == [0; 32]
                    || state.committed_at < state.created_at
                    || state.committed_at >= state.expires_at))
            || (!has_claim
                && (state.recipient != Pubkey::default()
                    || state.report_ref != [0; 32]
                    || state.committed_at != 0))
            || ((state.status == 1 || state.status == 4) && state.settled_at != 0)
            || (state.status == 2 && state.settled_at < state.committed_at)
            || (state.status == 3 && state.settled_at < state.expires_at)
        {
            return Err(Error::InvalidReceipt.into());
        }
        Ok(state)
    }
    pub fn pack(&self, data: &mut [u8]) -> ProgramResult {
        if data.len() != RECEIPT_LEN {
            return Err(Error::InvalidReceipt.into());
        }
        data.fill(0);
        data[..8].copy_from_slice(MAGIC);
        data[8] = 2;
        data[9] = self.status;
        data[10] = self.reward_bump;
        data[11] = self.vault_bump;
        data[12] = self.decimals;
        data[16..48].copy_from_slice(self.owner.as_ref());
        data[48..80].copy_from_slice(self.mint.as_ref());
        data[80..112].copy_from_slice(&self.reward_id);
        data[112..120].copy_from_slice(&self.amount.to_le_bytes());
        data[120..128].copy_from_slice(&self.expires_at.to_le_bytes());
        data[128..160].copy_from_slice(self.recipient.as_ref());
        data[160..192].copy_from_slice(&self.report_ref);
        data[192..200].copy_from_slice(&self.created_at.to_le_bytes());
        data[200..208].copy_from_slice(&self.settled_at.to_le_bytes());
        data[208..216].copy_from_slice(&self.claim_seq.to_le_bytes());
        data[216..224].copy_from_slice(&self.committed_at.to_le_bytes());
        Ok(())
    }

    fn require_funded(&self) -> ProgramResult {
        match self.status {
            1 => Ok(()),
            4 => Err(Error::CommitmentActive.into()),
            _ => Err(Error::AlreadySettled.into()),
        }
    }

    fn require_claim(&self, claim_seq: u64) -> ProgramResult {
        if self.status != 4 {
            return Err(if self.status == 1 {
                Error::CommitmentRequired
            } else {
                Error::AlreadySettled
            }
            .into());
        }
        if claim_seq == 0 || claim_seq != self.claim_seq {
            return Err(Error::StaleClaim.into());
        }
        Ok(())
    }

    fn commit(
        &mut self,
        now: i64,
        expected_seq: u64,
        recipient: Pubkey,
        report_ref: [u8; 32],
    ) -> ProgramResult {
        self.require_funded()?;
        if now < self.created_at {
            return Err(Error::InvalidExpiry.into());
        }
        if now >= self.expires_at {
            return Err(Error::Expired.into());
        }
        if expected_seq != self.claim_seq {
            return Err(Error::StaleClaim.into());
        }
        if recipient == Pubkey::default() || report_ref == [0; 32] {
            return Err(Error::InvalidReference.into());
        }
        let next = self.claim_seq.checked_add(1).ok_or(Error::ClaimOverflow)?;
        self.status = 4;
        self.claim_seq = next;
        self.recipient = recipient;
        self.report_ref = report_ref;
        self.committed_at = now;
        Ok(())
    }

    fn release(&mut self, now: i64, claim_seq: u64) -> ProgramResult {
        self.require_claim(claim_seq)?;
        if now < self.committed_at {
            return Err(Error::InvalidExpiry.into());
        }
        // An accepted commitment outlives the offer expiry. Time alone must not
        // give the owner a refund or cancellation path after a physical return.
        self.status = 2;
        self.settled_at = now;
        Ok(())
    }

    fn waive(&mut self, recipient: &Pubkey, claim_seq: u64) -> ProgramResult {
        self.require_claim(claim_seq)?;
        if *recipient != self.recipient {
            return Err(Error::InvalidAuthority.into());
        }
        self.status = 1;
        self.recipient = Pubkey::default();
        self.report_ref = [0; 32];
        self.committed_at = 0;
        // Keep claim_seq, amount and original offer expiry. Waiver itself moves
        // no funds and cannot be replayed against a subsequently accepted claim.
        Ok(())
    }
}

fn writable(accounts: &[&AccountInfo]) -> ProgramResult {
    if accounts.iter().any(|a| !a.is_writable) {
        return Err(Error::InvalidAccounts.into());
    }
    Ok(())
}
fn token_program(account: &AccountInfo) -> ProgramResult {
    if *account.key != spl_token::id() || !account.executable {
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}
fn mint(account: &AccountInfo) -> Result<Mint, ProgramError> {
    if *account.owner != spl_token::id() || *account.key == spl_token::native_mint::id() {
        return Err(Error::InvalidMint.into());
    }
    let state = Mint::unpack(&account.try_borrow_data()?).map_err(|_| Error::InvalidMint)?;
    if state.decimals > 18 || state.freeze_authority != COption::None {
        return Err(Error::InvalidMint.into());
    }
    Ok(state)
}
fn token(
    account: &AccountInfo,
    expected_mint: &Pubkey,
    authority: &Pubkey,
) -> Result<TokenAccount, ProgramError> {
    if *account.owner != spl_token::id() {
        return Err(Error::InvalidTokenAccount.into());
    }
    let state = TokenAccount::unpack(&account.try_borrow_data()?)
        .map_err(|_| Error::InvalidTokenAccount)?;
    if state.mint != *expected_mint
        || state.owner != *authority
        || state.state != AccountState::Initialized
        || state.is_native != COption::None
    {
        return Err(Error::InvalidTokenAccount.into());
    }
    Ok(state)
}
fn ata(
    account: &AccountInfo,
    expected_mint: &Pubkey,
    authority: &Pubkey,
) -> Result<TokenAccount, ProgramError> {
    let address = Pubkey::find_program_address(
        &[
            authority.as_ref(),
            spl_token::id().as_ref(),
            expected_mint.as_ref(),
        ],
        &ATA_PROGRAM,
    )
    .0;
    if *account.key != address {
        return Err(Error::InvalidAddress.into());
    }
    token(account, expected_mint, authority)
}
fn valid_expiry(now: i64, previous: Option<i64>, expires: i64) -> ProgramResult {
    let maximum = now.checked_add(MAX_DURATION).ok_or(Error::InvalidExpiry)?;
    if now < 0 || expires <= now || expires > maximum || previous.is_some_and(|old| expires <= old)
    {
        return Err(Error::InvalidExpiry.into());
    }
    Ok(())
}
fn receipt(program_id: &Pubkey, reward: &AccountInfo) -> Result<Receipt, ProgramError> {
    writable(&[reward])?;
    if reward.owner != program_id || reward.executable {
        return Err(Error::InvalidReceipt.into());
    }
    let state = Receipt::unpack(&reward.try_borrow_data()?)?;
    let (address, bump) = Pubkey::find_program_address(
        &[b"reward", state.owner.as_ref(), &state.reward_id],
        program_id,
    );
    if address != *reward.key || bump != state.reward_bump {
        return Err(Error::InvalidAddress.into());
    }
    Ok(state)
}

fn owner_receipt(
    program_id: &Pubkey,
    owner: &AccountInfo,
    reward: &AccountInfo,
) -> Result<Receipt, ProgramError> {
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let state = receipt(program_id, reward)?;
    if state.owner != *owner.key {
        return Err(Error::InvalidAuthority.into());
    }
    Ok(state)
}

fn funded(
    program_id: &Pubkey,
    owner: &AccountInfo,
    reward: &AccountInfo,
) -> Result<Receipt, ProgramError> {
    let state = owner_receipt(program_id, owner, reward)?;
    state.require_funded()?;
    Ok(state)
}

/// Supports a system-owned, zero-data address that has received unsolicited SOL.
fn allocate_pda<'a>(
    payer: &AccountInfo<'a>,
    account: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    owner: &Pubkey,
    len: usize,
    seeds: &[&[u8]],
) -> ProgramResult {
    if *account.owner != system_program::id() || !account.data_is_empty() || account.executable {
        return Err(Error::AlreadyInitialized.into());
    }
    let minimum = Rent::get()?.minimum_balance(len).max(1);
    let needed = minimum.saturating_sub(account.lamports());
    if needed > 0 {
        invoke(
            &system_instruction::transfer(payer.key, account.key, needed),
            &[payer.clone(), account.clone(), system.clone()],
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(account.key, len as u64),
        &[account.clone(), system.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(account.key, owner),
        &[account.clone(), system.clone()],
        &[seeds],
    )
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    match data.first() {
        Some(0) if data.len() == 49 => create(program_id, accounts, data),
        Some(1) if data.len() == 9 => settle(
            program_id,
            accounts,
            Some(u64::from_le_bytes(array(data, 1)?)),
        ),
        Some(2) if data.len() == 1 => settle(program_id, accounts, None),
        Some(3) if data.len() == 9 => {
            renew(program_id, accounts, i64::from_le_bytes(array(data, 1)?))
        }
        Some(4) if data.len() == 73 => commit(
            program_id,
            accounts,
            u64::from_le_bytes(array(data, 1)?),
            Pubkey::new_from_array(array(data, 9)?),
            array(data, 41)?,
        ),
        Some(5) if data.len() == 9 => {
            waive(program_id, accounts, u64::from_le_bytes(array(data, 1)?))
        }
        _ => Err(Error::InvalidInstruction.into()),
    }
}

fn create(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [owner, reward, vault, mint_account, source, system, tokens] = accounts else {
        return Err(Error::InvalidAccounts.into());
    };
    if !owner.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    writable(&[owner, reward, vault, source])?;
    token_program(tokens)?;
    if *system.key != system_program::id() || !system.executable {
        return Err(ProgramError::IncorrectProgramId);
    }
    let reward_id: [u8; 32] = array(data, 1)?;
    let amount = u64::from_le_bytes(array(data, 33)?);
    if amount == 0 {
        return Err(Error::InvalidAmount.into());
    }
    let expires_at = i64::from_le_bytes(array(data, 41)?);
    let now = Clock::get()?.unix_timestamp;
    valid_expiry(now, None, expires_at)?;
    let mint_state = mint(mint_account)?;
    let source_state = ata(source, mint_account.key, owner.key)?;
    if source_state.amount < amount {
        return Err(Error::InvalidAmount.into());
    }
    let (reward_address, reward_bump) =
        Pubkey::find_program_address(&[b"reward", owner.key.as_ref(), &reward_id], program_id);
    let (vault_address, vault_bump) =
        Pubkey::find_program_address(&[b"vault", reward_address.as_ref()], program_id);
    if reward_address != *reward.key || vault_address != *vault.key {
        return Err(Error::InvalidAddress.into());
    }
    let reward_bump_seed = [reward_bump];
    let vault_bump_seed = [vault_bump];
    let reward_seeds: &[&[u8]] = &[b"reward", owner.key.as_ref(), &reward_id, &reward_bump_seed];
    let vault_seeds: &[&[u8]] = &[b"vault", reward.key.as_ref(), &vault_bump_seed];
    allocate_pda(owner, reward, system, program_id, RECEIPT_LEN, reward_seeds)?;
    allocate_pda(
        owner,
        vault,
        system,
        &spl_token::id(),
        TokenAccount::LEN,
        vault_seeds,
    )?;
    invoke(
        &spl_token::instruction::initialize_account3(
            &spl_token::id(),
            vault.key,
            mint_account.key,
            reward.key,
        )?,
        &[vault.clone(), mint_account.clone(), tokens.clone()],
    )?;
    invoke(
        &spl_token::instruction::transfer_checked(
            &spl_token::id(),
            source.key,
            mint_account.key,
            vault.key,
            owner.key,
            &[],
            amount,
            mint_state.decimals,
        )?,
        &[
            source.clone(),
            mint_account.clone(),
            vault.clone(),
            owner.clone(),
            tokens.clone(),
        ],
    )?;
    Receipt {
        status: 1,
        reward_bump,
        vault_bump,
        decimals: mint_state.decimals,
        owner: *owner.key,
        mint: *mint_account.key,
        reward_id,
        amount,
        expires_at,
        recipient: Pubkey::default(),
        report_ref: [0; 32],
        created_at: now,
        settled_at: 0,
        claim_seq: 0,
        committed_at: 0,
    }
    .pack(&mut reward.try_borrow_mut_data()?)
}

fn settle(program_id: &Pubkey, accounts: &[AccountInfo], payment: Option<u64>) -> ProgramResult {
    let [owner, reward, vault, mint_account, destination, tokens] = accounts else {
        return Err(Error::InvalidAccounts.into());
    };
    let mut state = owner_receipt(program_id, owner, reward)?;
    if let Some(claim_seq) = payment {
        state.require_claim(claim_seq)?;
    } else {
        state.require_funded()?;
    }
    writable(&[vault, destination])?;
    token_program(tokens)?;
    if *mint_account.key != state.mint {
        return Err(Error::InvalidMint.into());
    }
    let mint_state = mint(mint_account)?;
    if mint_state.decimals != state.decimals {
        return Err(Error::InvalidMint.into());
    }
    let (vault_address, vault_bump) =
        Pubkey::find_program_address(&[b"vault", reward.key.as_ref()], program_id);
    if *vault.key != vault_address || vault_bump != state.vault_bump {
        return Err(Error::InvalidAddress.into());
    }
    let vault_state = token(vault, &state.mint, reward.key)?;
    if vault_state.delegate != COption::None || vault_state.close_authority != COption::None {
        return Err(Error::InvalidTokenAccount.into());
    }
    if vault_state.amount < state.amount {
        return Err(Error::InsufficientVaultBalance.into());
    }
    let now = Clock::get()?.unix_timestamp;
    if now < state.created_at {
        return Err(Error::InvalidExpiry.into());
    }
    let recipient = if let Some(claim_seq) = payment {
        state.release(now, claim_seq)?;
        state.recipient
    } else {
        if now < state.expires_at {
            return Err(Error::NotExpired.into());
        }
        state.status = 3;
        state.owner
    };
    ata(destination, &state.mint, &recipient)?;
    let bump = [state.reward_bump];
    let seeds: &[&[u8]] = &[b"reward", state.owner.as_ref(), &state.reward_id, &bump];
    invoke_signed(
        &spl_token::instruction::transfer_checked(
            &spl_token::id(),
            vault.key,
            mint_account.key,
            destination.key,
            reward.key,
            &[],
            state.amount,
            state.decimals,
        )?,
        &[
            vault.clone(),
            mint_account.clone(),
            destination.clone(),
            reward.clone(),
            tokens.clone(),
        ],
        &[seeds],
    )?;
    state.settled_at = now;
    state.pack(&mut reward.try_borrow_mut_data()?)
}

fn renew(program_id: &Pubkey, accounts: &[AccountInfo], expires_at: i64) -> ProgramResult {
    let [owner, reward] = accounts else {
        return Err(Error::InvalidAccounts.into());
    };
    let mut state = funded(program_id, owner, reward)?;
    valid_expiry(
        Clock::get()?.unix_timestamp,
        Some(state.expires_at),
        expires_at,
    )?;
    state.expires_at = expires_at;
    state.pack(&mut reward.try_borrow_mut_data()?)
}

fn commit(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    expected_seq: u64,
    recipient: Pubkey,
    report_ref: [u8; 32],
) -> ProgramResult {
    let [owner, reward] = accounts else {
        return Err(Error::InvalidAccounts.into());
    };
    let mut state = funded(program_id, owner, reward)?;
    state.commit(
        Clock::get()?.unix_timestamp,
        expected_seq,
        recipient,
        report_ref,
    )?;
    state.pack(&mut reward.try_borrow_mut_data()?)
}

fn waive(program_id: &Pubkey, accounts: &[AccountInfo], claim_seq: u64) -> ProgramResult {
    let [recipient, reward] = accounts else {
        return Err(Error::InvalidAccounts.into());
    };
    if !recipient.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut state = receipt(program_id, reward)?;
    state.waive(recipient.key, claim_seq)?;
    state.pack(&mut reward.try_borrow_mut_data()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Receipt {
        Receipt {
            status: 1,
            reward_bump: 254,
            vault_bump: 253,
            decimals: 6,
            owner: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            reward_id: [7; 32],
            amount: u64::MAX,
            expires_at: 200,
            recipient: Pubkey::default(),
            report_ref: [0; 32],
            created_at: 100,
            settled_at: 0,
            claim_seq: 0,
            committed_at: 0,
        }
    }
    #[test]
    fn receipt_roundtrip_and_bounds() {
        let state = fixture();
        let mut data = [0; RECEIPT_LEN];
        state.pack(&mut data).unwrap();
        assert_eq!(Receipt::unpack(&data).unwrap(), state);
        for offset in [0, 8, 9, 13, 14, 15] {
            let mut corrupt = data;
            corrupt[offset] = 99;
            assert!(Receipt::unpack(&corrupt).is_err());
        }
        assert!(Receipt::unpack(&data[..208]).is_err());
        let mut invalid = state.clone();
        invalid.amount = 0;
        invalid.pack(&mut data).unwrap();
        assert!(Receipt::unpack(&data).is_err());
    }
    #[test]
    fn commitment_and_terminal_receipts_are_consistent() {
        let mut state = fixture();
        let mut data = [0; RECEIPT_LEN];
        state.commit(150, 0, Pubkey::new_unique(), [9; 32]).unwrap();
        state.pack(&mut data).unwrap();
        assert_eq!(Receipt::unpack(&data).unwrap(), state);
        for offset in [128, 160, 208] {
            let mut corrupt = data;
            let len = if offset == 208 { 8 } else { 32 };
            corrupt[offset..offset + len].fill(0);
            assert!(Receipt::unpack(&corrupt).is_err());
        }
        for committed_at in [99_i64, 200] {
            let mut corrupt = data;
            corrupt[216..224].copy_from_slice(&committed_at.to_le_bytes());
            assert!(Receipt::unpack(&corrupt).is_err());
        }
        state.release(300, 1).unwrap();
        state.pack(&mut data).unwrap();
        assert_eq!(Receipt::unpack(&data).unwrap(), state);
        state.settled_at = 149;
        state.pack(&mut data).unwrap();
        assert!(Receipt::unpack(&data).is_err());
        state.status = 3;
        state.recipient = Pubkey::default();
        state.report_ref = [0; 32];
        state.committed_at = 0;
        state.settled_at = 200;
        state.pack(&mut data).unwrap();
        assert!(Receipt::unpack(&data).is_ok());
        state.settled_at = 199;
        state.pack(&mut data).unwrap();
        assert!(Receipt::unpack(&data).is_err());
    }
    #[test]
    fn payment_requires_commitment_and_remains_valid_after_expiry() {
        let mut state = fixture();
        let finder = Pubkey::new_unique();
        assert_eq!(state.release(150, 1), Err(Error::CommitmentRequired.into()));
        state.commit(150, 0, finder, [9; 32]).unwrap();
        assert_eq!(state.status, 4);
        assert_eq!(state.claim_seq, 1);
        assert_eq!(state.require_funded(), Err(Error::CommitmentActive.into()));
        assert_eq!(
            state.commit(151, 1, state.owner, [8; 32]),
            Err(Error::CommitmentActive.into())
        );
        assert_eq!(state.release(149, 1), Err(Error::InvalidExpiry.into()));
        state.release(300, 1).unwrap();
        assert_eq!(state.recipient, finder);
        assert_eq!(state.report_ref, [9; 32]);
        assert_eq!(state.settled_at, 300);
        assert_eq!(state.release(301, 1), Err(Error::AlreadySettled.into()));
        assert_eq!(state.waive(&finder, 1), Err(Error::AlreadySettled.into()));
    }
    #[test]
    fn waiver_requires_finder_and_recommit_rejects_old_authorizations() {
        let mut state = fixture();
        let finder = Pubkey::new_unique();
        state.commit(150, 0, finder, [9; 32]).unwrap();
        let committed = state.clone();
        let owner = state.owner;
        assert_eq!(
            state.waive(&owner, 1),
            Err(Error::InvalidAuthority.into())
        );
        assert_eq!(state, committed);
        assert_eq!(state.waive(&finder, 0), Err(Error::StaleClaim.into()));
        state.waive(&finder, 1).unwrap();
        assert_eq!(
            (
                state.status,
                state.claim_seq,
                state.expires_at,
                state.amount
            ),
            (1, 1, 200, u64::MAX)
        );
        assert_eq!(state.recipient, Pubkey::default());
        assert_eq!(state.report_ref, [0; 32]);
        assert_eq!(state.committed_at, 0);
        let mut data = [0; RECEIPT_LEN];
        state.pack(&mut data).unwrap();
        assert_eq!(Receipt::unpack(&data).unwrap(), state);
        assert_eq!(
            state.commit(160, 0, finder, [9; 32]),
            Err(Error::StaleClaim.into())
        );
        state.commit(160, 1, finder, [9; 32]).unwrap();
        assert_eq!(state.claim_seq, 2);
        assert_eq!(state.release(170, 1), Err(Error::StaleClaim.into()));
        assert_eq!(state.waive(&finder, 1), Err(Error::StaleClaim.into()));
        state.release(170, 2).unwrap();
    }
    #[test]
    fn invalid_commitments_and_counter_overflow_leave_state_unchanged() {
        let mut state = fixture();
        let finder = Pubkey::new_unique();
        let initial = state.clone();
        for (now, seq, recipient, reference, error) in [
            (99, 0, finder, [9; 32], Error::InvalidExpiry),
            (200, 0, finder, [9; 32], Error::Expired),
            (150, 1, finder, [9; 32], Error::StaleClaim),
            (150, 0, Pubkey::default(), [9; 32], Error::InvalidReference),
            (150, 0, finder, [0; 32], Error::InvalidReference),
        ] {
            assert_eq!(
                state.commit(now, seq, recipient, reference),
                Err(error.into())
            );
            assert_eq!(state, initial);
        }
        state.claim_seq = u64::MAX;
        let maximum = state.clone();
        assert_eq!(
            state.commit(150, u64::MAX, finder, [9; 32]),
            Err(Error::ClaimOverflow.into())
        );
        assert_eq!(state, maximum);
        state.status = 3;
        state.settled_at = 200;
        assert_eq!(
            state.commit(150, u64::MAX, finder, [9; 32]),
            Err(Error::AlreadySettled.into())
        );
        assert_eq!(
            state.release(300, u64::MAX),
            Err(Error::AlreadySettled.into())
        );
        assert_eq!(
            state.waive(&finder, u64::MAX),
            Err(Error::AlreadySettled.into())
        );
    }
    #[test]
    fn renewal_only_extends_and_has_bounded_horizon() {
        assert!(valid_expiry(100, None, 101).is_ok());
        assert!(valid_expiry(100, None, 100).is_err());
        assert!(valid_expiry(100, Some(200), 200).is_err());
        assert!(valid_expiry(100, Some(200), 199).is_err());
        assert!(valid_expiry(100, Some(200), 201).is_ok());
        assert!(valid_expiry(300, Some(200), 301).is_ok());
        assert!(valid_expiry(100, None, 100 + MAX_DURATION).is_ok());
        assert!(valid_expiry(100, None, 101 + MAX_DURATION).is_err());
        assert!(valid_expiry(i64::MAX - 1, None, i64::MAX).is_err());
        assert!(valid_expiry(-1, None, 10).is_err());
    }
    #[test]
    fn malformed_instructions_never_panic() {
        let id = Pubkey::new_unique();
        for len in 0..100 {
            for opcode in 0..8 {
                let data = vec![opcode; len];
                assert!(process_instruction(&id, &[], &data).is_err());
            }
        }
    }
}
