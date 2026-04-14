pub struct SaepProgram {
    pub name: &'static str,
    pub id: &'static str,
}

pub const SAEP_PROGRAMS: &[SaepProgram] = &[
    SaepProgram { name: "agent_registry",      id: "EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu" },
    SaepProgram { name: "capability_registry", id: "GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F" },
    SaepProgram { name: "treasury_standard",   id: "6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ" },
    SaepProgram { name: "task_market",         id: "HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w" },
    SaepProgram { name: "proof_verifier",      id: "DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe" },
    SaepProgram { name: "dispute_arbitration", id: "GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa" },
    SaepProgram { name: "governance_program",  id: "9uczLDZaN9EWqW76be75ji4vCsz3cydefbChqvBS6qw1" },
    SaepProgram { name: "fee_collector",       id: "4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu" },
];

pub fn all_ids() -> Vec<String> {
    SAEP_PROGRAMS.iter().map(|p| p.id.to_string()).collect()
}

pub fn name_for(id: &str) -> Option<&'static str> {
    SAEP_PROGRAMS.iter().find(|p| p.id == id).map(|p| p.name)
}
