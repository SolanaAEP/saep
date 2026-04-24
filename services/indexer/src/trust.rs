use serde::Serialize;

const FULL_CONFIDENCE_JOBS: i64 = 20;
const THIN_HISTORY_JOBS: i64 = 8;
const LOW_CONFIDENCE_BPS: i32 = 6_000;
const WATCH_AVAILABILITY_BPS: i32 = 7_000;
const CAUTION_AVAILABILITY_BPS: i32 = 4_500;
const CAUTION_CONFIDENCE_BPS: i32 = 3_000;
const WATCH_DISPUTE_RATE_BPS: i32 = 1_000;
const CAUTION_DISPUTE_RATE_BPS: i32 = 2_000;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrustState {
    Strong,
    Watch,
    Caution,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TrustSignals {
    pub confidence_bps: i32,
    pub dispute_rate_bps: i32,
    pub low_history: bool,
    pub low_confidence: bool,
    pub availability_warning: bool,
    pub dispute_warning: bool,
    pub trust_state: TrustState,
    pub low_history_penalty_bps: i32,
    pub dispute_penalty_bps: i32,
    pub availability_penalty_bps: i32,
}

#[derive(Debug, Clone, Copy)]
pub struct MatchScoreInputs {
    pub coverage_bps: i32,
    pub capability_reputation_bps: i32,
    pub availability_bps: i32,
    pub cost_efficiency_bps: i32,
    pub honesty_bps: i32,
    pub jobs_completed: i64,
    pub jobs_disputed: i64,
}

#[derive(Debug, Clone, Copy)]
pub struct LeaderboardScoreInputs {
    pub reputation_bps: i32,
    pub availability_bps: i32,
    pub honesty_bps: i32,
    pub jobs_completed: i64,
    pub jobs_disputed: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MatchTrustScore {
    pub fit_score_bps: i32,
    pub base_fit_score_bps: i32,
    #[serde(flatten)]
    pub signals: TrustSignals,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LeaderboardTrustScore {
    pub trust_score_bps: i32,
    pub base_score_bps: i32,
    #[serde(flatten)]
    pub signals: TrustSignals,
}

pub fn dispute_rate_bps(jobs_completed: i64, jobs_disputed: i64) -> i32 {
    if jobs_completed <= 0 {
        return 0;
    }
    (((jobs_disputed.max(0).min(jobs_completed)) * 10_000) / jobs_completed.max(1)) as i32
}

pub fn confidence_bps(jobs_completed: i64, jobs_disputed: i64) -> i32 {
    let capped_jobs = jobs_completed.max(0).min(FULL_CONFIDENCE_JOBS) as i32;
    let base_confidence = (capped_jobs * 10_000) / (FULL_CONFIDENCE_JOBS as i32);
    let dispute_drag = 10_000 - dispute_rate_bps(jobs_completed, jobs_disputed).clamp(0, 4_000);
    ((base_confidence as i64 * dispute_drag as i64) / 10_000) as i32
}

pub fn low_history_penalty_bps(jobs_completed: i64) -> i32 {
    if jobs_completed >= FULL_CONFIDENCE_JOBS {
        0
    } else {
        (((FULL_CONFIDENCE_JOBS - jobs_completed.max(0)) as i32) * 120).min(2_400)
    }
}

pub fn dispute_penalty_bps(jobs_completed: i64, jobs_disputed: i64) -> i32 {
    ((dispute_rate_bps(jobs_completed, jobs_disputed) * 3) / 4).min(2_500)
}

pub fn availability_penalty_bps(availability_bps: i32) -> i32 {
    if availability_bps >= WATCH_AVAILABILITY_BPS {
        0
    } else {
        ((WATCH_AVAILABILITY_BPS - availability_bps.max(0)) / 2).min(2_000)
    }
}

pub fn trust_signals(
    availability_bps: i32,
    jobs_completed: i64,
    jobs_disputed: i64,
) -> TrustSignals {
    let confidence_bps = confidence_bps(jobs_completed, jobs_disputed);
    let dispute_rate_bps = dispute_rate_bps(jobs_completed, jobs_disputed);
    let low_history = jobs_completed < THIN_HISTORY_JOBS;
    let low_confidence = confidence_bps < LOW_CONFIDENCE_BPS;
    let availability_warning = availability_bps < WATCH_AVAILABILITY_BPS;
    let dispute_warning = dispute_rate_bps >= WATCH_DISPUTE_RATE_BPS;
    let trust_state = if availability_bps < CAUTION_AVAILABILITY_BPS
        || dispute_rate_bps >= CAUTION_DISPUTE_RATE_BPS
        || confidence_bps < CAUTION_CONFIDENCE_BPS
    {
        TrustState::Caution
    } else if availability_warning || dispute_warning || low_confidence {
        TrustState::Watch
    } else {
        TrustState::Strong
    };

    TrustSignals {
        confidence_bps,
        dispute_rate_bps,
        low_history,
        low_confidence,
        availability_warning,
        dispute_warning,
        trust_state,
        low_history_penalty_bps: low_history_penalty_bps(jobs_completed),
        dispute_penalty_bps: dispute_penalty_bps(jobs_completed, jobs_disputed),
        availability_penalty_bps: availability_penalty_bps(availability_bps),
    }
}

pub fn score_match(inputs: MatchScoreInputs) -> MatchTrustScore {
    let availability_bps = inputs.availability_bps.clamp(0, 10_000);
    let signals = trust_signals(
        availability_bps,
        inputs.jobs_completed,
        inputs.jobs_disputed,
    );
    let base_fit_score_bps = (((inputs.coverage_bps.clamp(0, 10_000) as i64) * 25
        + (inputs.capability_reputation_bps.clamp(0, 10_000) as i64) * 30
        + (availability_bps as i64) * 15
        + (inputs.cost_efficiency_bps.clamp(0, 10_000) as i64) * 10
        + (inputs.honesty_bps.clamp(0, 10_000) as i64) * 20)
        / 100) as i32;
    let fit_score_bps = (base_fit_score_bps
        - signals.low_history_penalty_bps
        - signals.dispute_penalty_bps
        - signals.availability_penalty_bps)
        .max(0);

    MatchTrustScore {
        fit_score_bps,
        base_fit_score_bps,
        signals,
    }
}

pub fn score_leaderboard(inputs: LeaderboardScoreInputs) -> LeaderboardTrustScore {
    let availability_bps = inputs.availability_bps.clamp(0, 10_000);
    let signals = trust_signals(
        availability_bps,
        inputs.jobs_completed,
        inputs.jobs_disputed,
    );
    let base_score_bps = (((inputs.reputation_bps.clamp(0, 10_000) as i64) * 60
        + (availability_bps as i64) * 20
        + (inputs.honesty_bps.clamp(0, 10_000) as i64) * 20)
        / 100) as i32;
    let trust_score_bps = (base_score_bps
        - signals.low_history_penalty_bps
        - signals.dispute_penalty_bps
        - signals.availability_penalty_bps)
        .max(0);

    LeaderboardTrustScore {
        trust_score_bps,
        base_score_bps,
        signals,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thin_history_gets_penalized_and_low_confidence() {
        let scored = score_match(MatchScoreInputs {
            coverage_bps: 10_000,
            capability_reputation_bps: 8_200,
            availability_bps: 8_600,
            cost_efficiency_bps: 7_900,
            honesty_bps: 9_200,
            jobs_completed: 2,
            jobs_disputed: 0,
        });

        assert!(scored.base_fit_score_bps > scored.fit_score_bps);
        assert!(scored.signals.low_history);
        assert!(scored.signals.low_confidence);
        assert_eq!(scored.signals.trust_state, TrustState::Watch);
    }

    #[test]
    fn dispute_pressure_pushes_trust_state_to_caution() {
        let scored = score_leaderboard(LeaderboardScoreInputs {
            reputation_bps: 8_800,
            availability_bps: 8_700,
            honesty_bps: 8_600,
            jobs_completed: 10,
            jobs_disputed: 3,
        });

        assert!(scored.signals.dispute_warning);
        assert_eq!(scored.signals.trust_state, TrustState::Caution);
        assert!(scored.trust_score_bps < scored.base_score_bps);
    }

    #[test]
    fn strong_history_and_availability_keep_trust_state_strong() {
        let scored = score_leaderboard(LeaderboardScoreInputs {
            reputation_bps: 8_900,
            availability_bps: 9_300,
            honesty_bps: 9_500,
            jobs_completed: 32,
            jobs_disputed: 0,
        });

        assert_eq!(scored.signals.trust_state, TrustState::Strong);
        assert_eq!(scored.signals.low_history_penalty_bps, 0);
        assert_eq!(scored.signals.availability_penalty_bps, 0);
    }
}
