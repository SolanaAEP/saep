use anchor_lang::prelude::*;

#[error_code]
pub enum TemplateRegistryError {
    #[msg("Program is paused")]
    Paused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Royalty bps exceeds cap")]
    RoyaltyExceedsCap,
    #[msg("Template not in valid state for this operation")]
    InvalidStatus,
    #[msg("Lineage depth exceeds maximum")]
    LineageDepthExceeded,
    #[msg("Capability mask includes bits not present in parent")]
    CapabilityMaskMismatch,
    #[msg("Rental is disabled for this template")]
    RentalDisabled,
    #[msg("Rental duration out of bounds")]
    RentalDurationOutOfBounds,
    #[msg("Rental not yet ended")]
    RentalNotEnded,
    #[msg("Rental already closed")]
    RentalAlreadyClosed,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Invalid CPI caller")]
    InvalidCpiCaller,
    #[msg("Fee split exceeds 100%")]
    FeeSplitExceeds100,
}
