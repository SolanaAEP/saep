use anchor_lang::prelude::*;

use crate::errors::DisputeArbitrationError;
use crate::state::{ReentrancyGuard, AllowedCallers, MAX_CPI_STACK_HEIGHT, ADMIN_RESET_TIMELOCK_SECS};

pub fn try_enter(guard: &mut ReentrancyGuard, caller: Pubkey, slot: u64) -> Result<()> {
    require!(!guard.active, DisputeArbitrationError::GuardAlreadyActive);
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
        DisputeArbitrationError::CpiDepthExceeded
    );
    require!(
        allowed.programs.iter().any(|p| p == caller_program),
        DisputeArbitrationError::UnauthorizedCaller
    );
    require!(
        caller_guard_active,
        DisputeArbitrationError::CallerGuardNotActive
    );
    require!(
        !self_guard.active,
        DisputeArbitrationError::ReentrancyDetected
    );
    Ok(())
}

pub fn assert_reset_timelock(guard: &ReentrancyGuard, now: i64) -> Result<()> {
    require!(
        guard.reset_proposed_at != 0,
        DisputeArbitrationError::AdminResetNotTimelocked
    );
    let elapsed = now.saturating_sub(guard.reset_proposed_at);
    require!(
        elapsed >= ADMIN_RESET_TIMELOCK_SECS,
        DisputeArbitrationError::AdminResetNotTimelocked
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

    fn allowed(ps: &[Pubkey]) -> AllowedCallers {
        AllowedCallers { programs: ps.to_vec(), bump: 0 }
    }

    #[test]
    fn enter_exit() {
        let mut g = new_guard();
        try_enter(&mut g, Pubkey::default(), 1).unwrap();
        assert!(g.active);
        exit(&mut g);
        assert!(!g.active);
    }

    #[test]
    fn double_enter_rejected() {
        let mut g = new_guard();
        try_enter(&mut g, Pubkey::default(), 1).unwrap();
        assert!(try_enter(&mut g, Pubkey::default(), 2).is_err());
    }

    #[test]
    fn callee_rejects_random_program() {
        let g = new_guard();
        let a = allowed(&[Pubkey::new_from_array([1u8; 32])]);
        let bad = Pubkey::new_from_array([7u8; 32]);
        assert!(check_callee_preconditions(&g, true, &bad, &a, 2).is_err());
    }

    #[test]
    fn callee_rejects_deep_stack() {
        let g = new_guard();
        let p = Pubkey::new_from_array([1u8; 32]);
        let a = allowed(&[p]);
        assert!(check_callee_preconditions(&g, true, &p, &a, 4).is_err());
    }

    #[test]
    fn callee_rejects_inactive_caller_guard() {
        let g = new_guard();
        let p = Pubkey::new_from_array([1u8; 32]);
        let a = allowed(&[p]);
        assert!(check_callee_preconditions(&g, false, &p, &a, 2).is_err());
    }

    #[test]
    fn timelock_enforced() {
        let mut g = new_guard();
        assert!(assert_reset_timelock(&g, 100).is_err());
        g.reset_proposed_at = 1_000;
        assert!(assert_reset_timelock(&g, 1_000 + ADMIN_RESET_TIMELOCK_SECS).is_ok());
    }
}
