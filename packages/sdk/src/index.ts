export const SAEP_PROGRAM_IDS = {
  agentRegistry: 'EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu',
  treasuryStandard: '6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ',
  taskMarket: 'HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w',
  disputeArbitration: 'GM8xiT17USBpCW24XXBmUR8YVCxxrJPMEcsddwfUokMa',
  governanceProgram: '9uczLDZaN9EWqW76be75ji4vCsz3cydefbChqvBS6qw1',
  feeCollector: '4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu',
  proofVerifier: 'DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe',
} as const;

export type SaepProgramName = keyof typeof SAEP_PROGRAM_IDS;
