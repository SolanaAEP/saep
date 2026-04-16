use anchor_lang::prelude::*;

use crate::errors::AgentRegistryError;

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
    require!(!guard.active, AgentRegistryError::GuardAlreadyActive);
    guard.active = true;
    guard.entered_by = caller;
    guard.entered_at_slot = slot;
    Ok(())
}

pub fn exit(guard: &mut ReentrancyGuard) {
    guard.active = false;
    guard.entered_by = Pubkey::default();
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
        AgentRegistryError::CpiDepthExceeded
    );
    require!(
        allowed.programs.iter().any(|p| p == caller_program),
        AgentRegistryError::UnauthorizedCaller
    );
    require!(caller_guard_active, AgentRegistryError::CallerGuardNotActive);
    require!(!self_guard.active, AgentRegistryError::ReentrancyDetected);
    Ok(())
}

pub fn assert_reset_timelock(guard: &ReentrancyGuard, now: i64) -> Result<()> {
    require!(
        guard.reset_proposed_at != 0,
        AgentRegistryError::AdminResetNotTimelocked
    );
    let elapsed = now.saturating_sub(guard.reset_proposed_at);
    require!(
        elapsed >= ADMIN_RESET_TIMELOCK_SECS,
        AgentRegistryError::AdminResetNotTimelocked
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
        AllowedCallers {
            programs: ps.to_vec(),
            bump: 0,
        }
    }

    #[test]
    fn enter_flips_active() {
        let mut g = new_guard();
        let caller = Pubkey::new_unique();
        try_enter(&mut g, caller, 42).unwrap();
        assert!(g.active);
        assert_eq!(g.entered_by, caller);
        assert_eq!(g.entered_at_slot, 42);
    }

    #[test]
    fn double_enter_rejected() {
        let mut g = new_guard();
        try_enter(&mut g, Pubkey::default(), 1).unwrap();
        assert!(try_enter(&mut g, Pubkey::default(), 2).is_err());
    }

    #[test]
    fn exit_clears_state() {
        let mut g = new_guard();
        try_enter(&mut g, Pubkey::new_unique(), 10).unwrap();
        exit(&mut g);
        assert!(!g.active);
        assert_eq!(g.entered_by, Pubkey::default());
    }

    #[test]
    fn callee_rejects_unauthorized_caller() {
        let self_g = new_guard();
        let allowed = new_allowed(&[Pubkey::new_from_array([1u8; 32])]);
        let intruder = Pubkey::new_from_array([9u8; 32]);
        assert!(
            check_callee_preconditions(&self_g, true, &intruder, &allowed, 2).is_err()
        );
    }

    #[test]
    fn callee_rejects_inactive_caller_guard() {
        let self_g = new_guard();
        let p = Pubkey::new_from_array([1u8; 32]);
        let allowed = new_allowed(&[p]);
        assert!(check_callee_preconditions(&self_g, false, &p, &allowed, 2).is_err());
    }

    #[test]
    fn callee_rejects_active_self_guard() {
        let mut self_g = new_guard();
        try_enter(&mut self_g, Pubkey::default(), 1).unwrap();
        let p = Pubkey::new_from_array([1u8; 32]);
        let allowed = new_allowed(&[p]);
        assert!(check_callee_preconditions(&self_g, true, &p, &allowed, 2).is_err());
    }

    #[test]
    fn callee_rejects_stack_too_deep() {
        let self_g = new_guard();
        let p = Pubkey::new_from_array([1u8; 32]);
        let allowed = new_allowed(&[p]);
        assert!(
            check_callee_preconditions(&self_g, true, &p, &allowed, MAX_CPI_STACK_HEIGHT + 1)
                .is_err()
        );
    }

    #[test]
    fn callee_accepts_happy_path() {
        let self_g = new_guard();
        let p = Pubkey::new_from_array([1u8; 32]);
        let allowed = new_allowed(&[p]);
        assert!(
            check_callee_preconditions(&self_g, true, &p, &allowed, MAX_CPI_STACK_HEIGHT).is_ok()
        );
    }

    #[test]
    fn reset_timelock_rejects_unproposed() {
        let g = new_guard();
        assert!(assert_reset_timelock(&g, 1_000_000).is_err());
    }

    #[test]
    fn reset_timelock_rejects_too_soon() {
        let mut g = new_guard();
        g.reset_proposed_at = 1_000_000;
        assert!(assert_reset_timelock(&g, 1_000_000 + ADMIN_RESET_TIMELOCK_SECS - 1).is_err());
    }

    #[test]
    fn reset_timelock_accepts_elapsed() {
        let mut g = new_guard();
        g.reset_proposed_at = 1_000_000;
        assert!(assert_reset_timelock(&g, 1_000_000 + ADMIN_RESET_TIMELOCK_SECS).is_ok());
    }
}
