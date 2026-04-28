import { PublicKey } from '@solana/web3.js';

export const PROGRAM_IDS = {
  capability_registry: new PublicKey('GW161Wce7z4S2rdcSCPNGixn2YQajefNc4r3jUj9zZ5F'),
  agent_registry: new PublicKey('EQJ4Lp2gxJDD5hs185aDcermYWdAi4cQeSKfnuqLAQYu'),
  treasury_standard: new PublicKey('6boJQg4L6FRS7YZ5rFXfKUaXSy3eCKnW2SdrT3LJLizQ'),
  task_market: new PublicKey('HiyqZ4q1GPPgx1EaxSuyBFKTzoPAYDPmnSfTX1vjbB8w'),
  proof_verifier: new PublicKey('DcJx1p6bcNuFm4i5WMgK4uGZitc1bf4Ubc5d4sctZKVe'),
  fee_collector: new PublicKey('4xLpFgjpZwJbf61UyvyMhmEBmeJzPaCyKvZeYuK2YFFu'),
} as const;

export const capRegPdas = {
  config: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_IDS.capability_registry),
  tag: (bitIndex: number): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('tag'), Buffer.from([bitIndex])],
      PROGRAM_IDS.capability_registry,
    ),
};

export const agentRegPdas = {
  global: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('global')], PROGRAM_IDS.agent_registry),
  agent: (operator: PublicKey, agentId: Uint8Array): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), operator.toBuffer(), Buffer.from(agentId)],
      PROGRAM_IDS.agent_registry,
    ),
  stake: (agent: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('stake'), agent.toBuffer()],
      PROGRAM_IDS.agent_registry,
    ),
  guard: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('guard')], PROGRAM_IDS.agent_registry),
};

export const treasuryPdas = {
  global: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('treasury_global')],
      PROGRAM_IDS.treasury_standard,
    ),
  allowedMints: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('allowed_mints')],
      PROGRAM_IDS.treasury_standard,
    ),
  treasury: (agentDid: Uint8Array): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('treasury'), Buffer.from(agentDid)],
      PROGRAM_IDS.treasury_standard,
    ),
  vault: (agentDid: Uint8Array, mint: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), Buffer.from(agentDid), mint.toBuffer()],
      PROGRAM_IDS.treasury_standard,
    ),
  stream: (did: Uint8Array, client: PublicKey, nonce: Uint8Array): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('stream'), Buffer.from(did), client.toBuffer(), Buffer.from(nonce)],
      PROGRAM_IDS.treasury_standard,
    ),
  streamEscrow: (stream: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('stream_escrow'), stream.toBuffer()],
      PROGRAM_IDS.treasury_standard,
    ),
  guard: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('guard')], PROGRAM_IDS.treasury_standard),
  allowedCallers: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('allowed_callers')],
      PROGRAM_IDS.treasury_standard,
    ),
};

export const taskMarketPdas = {
  global: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('market_global')],
      PROGRAM_IDS.task_market,
    ),
  task: (client: PublicKey, taskNonce: Uint8Array): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('task'), client.toBuffer(), Buffer.from(taskNonce)],
      PROGRAM_IDS.task_market,
    ),
  escrow: (task: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('task_escrow'), task.toBuffer()],
      PROGRAM_IDS.task_market,
    ),
  bidBook: (taskId: Uint8Array): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('bid_book'), Buffer.from(taskId)],
      PROGRAM_IDS.task_market,
    ),
  bid: (taskId: Uint8Array, bidder: PublicKey): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('bid'), Buffer.from(taskId), bidder.toBuffer()],
      PROGRAM_IDS.task_market,
    ),
  bondEscrow: (taskId: Uint8Array): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('bond_escrow'), Buffer.from(taskId)],
      PROGRAM_IDS.task_market,
    ),
  guard: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('guard')], PROGRAM_IDS.task_market),
};

export const proofVerifierPdas = {
  config: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('verifier_config')],
      PROGRAM_IDS.proof_verifier,
    ),
  mode: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('mode')], PROGRAM_IDS.proof_verifier),
  vk: (vkId: Uint8Array): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('vk'), Buffer.from(vkId)],
      PROGRAM_IDS.proof_verifier,
    ),
};

export const feeCollectorPdas = {
  config: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('fee_config')], PROGRAM_IDS.fee_collector),
  epoch: (epochId: number | bigint): [PublicKey, number] => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(epochId));
    return PublicKey.findProgramAddressSync(
      [Buffer.from('epoch'), buf],
      PROGRAM_IDS.fee_collector,
    );
  },
  intakeVault: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('intake_vault')], PROGRAM_IDS.fee_collector),
  burnVault: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('burn_vault')], PROGRAM_IDS.fee_collector),
  stakerVault: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('staker_vault')], PROGRAM_IDS.fee_collector),
  transferFeeWithdrawAuthority: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('transfer_fee_withdraw_authority')],
      PROGRAM_IDS.fee_collector,
    ),
  depositVault: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('deposit_vault')], PROGRAM_IDS.fee_collector),
  mintAuthority: (): [PublicKey, number] =>
    PublicKey.findProgramAddressSync([Buffer.from('mint_authority')], PROGRAM_IDS.fee_collector),
  claim: (epochId: number | bigint, staker: PublicKey): [PublicKey, number] => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(epochId));
    return PublicKey.findProgramAddressSync(
      [Buffer.from('claim'), buf, staker.toBuffer()],
      PROGRAM_IDS.fee_collector,
    );
  },
};

// Backwards-compat aliases for files that import the old names.
export { capRegPdas as capReg };
export { agentRegPdas as agentReg };
export { treasuryPdas as treasury };
export { taskMarketPdas as taskMarket };
export { proofVerifierPdas as proofVerifier };
