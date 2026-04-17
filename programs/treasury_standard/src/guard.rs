use anchor_lang::prelude::*;

use crate::errors::TreasuryError;

pub const SEED_GUARD: &[u8] = b"guard";
pub const SEED_ALLOWED_CALLERS: &[u8] = b"allowed_callers";
pub const MAX_ALLOWED_CALLERS: usize = 8;
pub const MAX_CPI_STACK_HEIGHT: usize = 3;
pub const ADMIN_RESET_TIMELOCK_SECS: i64 = 24 * 60 * 60;

#[account]
#[derive(InitSpace)]
pub struct ReentrancyGuard {
    pub active: bool,
    pub entered_by: Pubkey,
    pub entered_at_slot: u64,
    pub reset_proposed_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AllowedCallers {
    #[max_len(MAX_ALLOWED_CALLERS)]
    pub programs: Vec<Pubkey>,
    pub bump: u8,
}

pub fn try_enter(
    guard: &mut ReentrancyGuard,
    caller: Pubkey,
    slot: u64,
) -> Result<()> {
    require!(!guard.active, TreasuryError::GuardAlreadyActive);
    guard.active = true;
    guard.entered_by = caller;
    guard.entered_at_slot = slot;
    Ok(())
}

pub fn exit(guard: &mut ReentrancyGuard) {
    guard.active = false;
    guard.entered_by = Pubkey::default();
}

pub fn reset_guard(g: &mut ReentrancyGuard) {
    g.active = false;
    g.entered_by = Pubkey::default();
    g.entered_at_slot = 0;
    g.reset_proposed_at = 0;
}

pub fn check_callee_preconditions(
    self_guard: &ReentrancyGuard,
    caller_guard_active: bool,
    caller_program: &Pubkey,
    allowed: &AllowedCallers,
    stack_height: usize,
) -> Result<()> {
    require!(
        stack_height <= MAX_CPI_STACK_HEIGHT,
        TreasuryError::CpiDepthExceeded
    );
    require!(
        allowed.programs.iter().any(|p| p == caller_program),
        TreasuryError::UnauthorizedCaller
    );
    require!(caller_guard_active, TreasuryError::CallerGuardNotActive);
    require!(!self_guard.active, TreasuryError::ReentrancyDetected);
    Ok(())
}

pub fn assert_reset_timelock(guard: &ReentrancyGuard, now: i64) -> Result<()> {
    require!(
        guard.reset_proposed_at != 0,
        TreasuryError::AdminResetNotTimelocked
    );
    let elapsed = now.saturating_sub(guard.reset_proposed_at);
    require!(
        elapsed >= ADMIN_RESET_TIMELOCK_SECS,
        TreasuryError::AdminResetNotTimelocked
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_guard() -> ReentrancyGuard {
        ReentrancyGuard {
            active: false,
            entered_by: Pubkey::default(),
            entered_at_slot: 0,
            reset_proposed_at: 0,
            bump: 0,
        }
    }

    fn new_allowed(ps: &[Pubkey]) -> AllowedCallers {
        AllowedCallers { programs: ps.to_vec(), bump: 0 }
    }

    #[test]
    fn caller_guard_not_active_rejected() {
        let self_g = new_guard();
        let p = Pubkey::new_from_array([1u8; 32]);
        let allowed = new_allowed(&[p]);
        assert!(check_callee_preconditions(&self_g, false, &p, &allowed, 2).is_err());
    }

    #[test]
    fn caller_guard_active_accepted() {
        let self_g = new_guard();
        let p = Pubkey::new_from_array([1u8; 32]);
        let allowed = new_allowed(&[p]);
        assert!(check_callee_preconditions(&self_g, true, &p, &allowed, 2).is_ok());
    }

    #[test]
    fn self_guard_active_rejects_reentry() {
        let mut self_g = new_guard();
        try_enter(&mut self_g, Pubkey::default(), 5).unwrap();
        let p = Pubkey::new_from_array([1u8; 32]);
        let allowed = new_allowed(&[p]);
        assert!(check_callee_preconditions(&self_g, true, &p, &allowed, 2).is_err());
    }

    #[test]
    fn stack_depth_exceeded_rejected() {
        let self_g = new_guard();
        let p = Pubkey::new_from_array([1u8; 32]);
        let allowed = new_allowed(&[p]);
        assert!(
            check_callee_preconditions(&self_g, true, &p, &allowed, MAX_CPI_STACK_HEIGHT + 1)
                .is_err()
        );
    }

    #[test]
    fn enter_twice_rejected() {
        let mut g = new_guard();
        try_enter(&mut g, Pubkey::default(), 1).unwrap();
        assert!(try_enter(&mut g, Pubkey::default(), 2).is_err());
    }

    #[test]
    fn exit_clears() {
        let mut g = new_guard();
        try_enter(&mut g, Pubkey::new_unique(), 1).unwrap();
        exit(&mut g);
        assert!(!g.active);
    }

    #[test]
    fn reset_timelock_enforced() {
        let mut g = new_guard();
        assert!(assert_reset_timelock(&g, 100).is_err());
        g.reset_proposed_at = 100;
        assert!(assert_reset_timelock(&g, 100 + ADMIN_RESET_TIMELOCK_SECS - 1).is_err());
        assert!(assert_reset_timelock(&g, 100 + ADMIN_RESET_TIMELOCK_SECS).is_ok());
    }
}
