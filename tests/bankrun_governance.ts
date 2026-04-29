import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { startBankrun, loadBankrunProgram, warpClockBy, BankrunEnv } from './helpers/bankrun.js';
import { padBytes } from './helpers/encoding.js';
import type { GovernanceProgram } from '../target/types/governance_program';

type Program = anchor.Program<GovernanceProgram>;

const VOTE_WINDOW_STANDARD = 5 * 86_400;
const TIMELOCK_STANDARD = 7 * 86_400;
const EXECUTION_WINDOW_SECS = 14 * 86_400;

function configPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('governance_config')],
    programId,
  );
}

function registryPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('program_registry')],
    programId,
  );
}

function proposalPda(programId: PublicKey, proposalId: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(proposalId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('proposal'), buf],
    programId,
  );
}

function voteRecordPda(
  programId: PublicKey,
  proposal: PublicKey,
  voter: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vote'), proposal.toBuffer(), voter.toBuffer()],
    programId,
  );
}

function executionRecordPda(programId: PublicKey, proposal: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('execution'), proposal.toBuffer()],
    programId,
  );
}

function computeVoteLeaf(voter: PublicKey, weight: bigint): Buffer {
  const weightBuf = Buffer.alloc(16);
  weightBuf.writeBigUInt64LE(weight & 0xFFFFFFFFFFFFFFFFn, 0);
  weightBuf.writeBigUInt64LE(weight >> 64n, 8);
  return createHash('sha256')
    .update(voter.toBuffer())
    .update(weightBuf)
    .digest();
}

function label16(s: string): number[] {
  return padBytes(s, 16);
}

function defaultInitParams(authority: PublicKey): {
  authority: PublicKey;
  nxsStaking: PublicKey;
  capabilityRegistry: PublicKey;
  feeCollector: PublicKey;
  emergencyCouncil: PublicKey;
  minProposerStake: BN;
  proposerCollateral: BN;
  quorumBps: number;
  passThresholdBps: number;
  metaPassThresholdBps: number;
  devModeTimelockOverrideSecs: BN;
} {
  return {
    authority,
    nxsStaking: Keypair.generate().publicKey,
    capabilityRegistry: Keypair.generate().publicKey,
    feeCollector: Keypair.generate().publicKey,
    emergencyCouncil: authority,
    minProposerStake: new BN(0),
    proposerCollateral: new BN(0),
    quorumBps: 400,
    passThresholdBps: 5000,
    metaPassThresholdBps: 6667,
    devModeTimelockOverrideSecs: new BN(0),
  };
}

function fundAccount(env: BankrunEnv, pubkey: PublicKey) {
  env.context.setAccount(pubkey, {
    lamports: 100 * LAMPORTS_PER_SOL,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
  });
}

describe('bankrun: governance_program', function () {
  this.timeout(60_000);

  let env: BankrunEnv;
  let program: Program;
  let authority: PublicKey;
  let targetProgram: PublicKey;

  async function initConfig() {
    authority = env.wallet.publicKey;
    await program.methods
      .initConfig(defaultInitParams(authority))
      .accountsPartial({ deployer: authority })
      .rpc();
  }

  async function registerTarget(isCritical = false, maxPayload = 256) {
    targetProgram = Keypair.generate().publicKey;
    await program.methods
      .registerProgram(
        label16('test_target') as unknown as number[],
        targetProgram,
        isCritical,
        Array.from(Buffer.alloc(32)) as unknown as number[],
        maxPayload,
      )
      .accountsPartial({ authority })
      .rpc();
  }

  function snapshotForVoter(voter: PublicKey, weight: bigint) {
    const root = computeVoteLeaf(voter, weight);
    return {
      totalEligibleWeight: new BN(weight.toString()),
      snapshotSlot: new BN(1),
      snapshotRoot: Array.from(root),
    };
  }

  async function createProposal(
    proposerKp: Keypair,
    snapshot: { totalEligibleWeight: BN; snapshotSlot: BN; snapshotRoot: number[] },
    ixData: Buffer = Buffer.from([1, 2, 3]),
  ) {
    const [configAddr] = configPda(program.programId);
    const cfg = await program.account.governanceConfig.fetch(configAddr);
    const proposalId = BigInt(cfg.nextProposalId.toString());
    const [proposalAddr] = proposalPda(program.programId, proposalId);

    await program.methods
      .propose(
        { parameterChange: {} },
        targetProgram,
        ixData,
        Buffer.from('ipfs://meta'),
        snapshot,
      )
      .accountsPartial({ proposer: proposerKp.publicKey })
      .signers([proposerKp])
      .rpc();

    return { proposalId, proposalAddr };
  }

  describe('init_config', () => {
    beforeEach(async () => {
      env = await startBankrun();
      program = loadBankrunProgram<GovernanceProgram>('governance_program', env.provider);
    });

    it('creates config + registry', async () => {
      authority = env.wallet.publicKey;
      await program.methods
        .initConfig(defaultInitParams(authority))
        .accountsPartial({ deployer: authority })
        .rpc();

      const [cfgAddr] = configPda(program.programId);
      const cfg = await program.account.governanceConfig.fetch(cfgAddr);
      expect(cfg.authority.toBase58()).to.equal(authority.toBase58());
      expect(cfg.quorumBps).to.equal(400);
      expect(cfg.passThresholdBps).to.equal(5000);
      expect(cfg.nextProposalId.toNumber()).to.equal(0);
      expect(cfg.paused).to.equal(false);

      const [regAddr] = registryPda(program.programId);
      const reg = await program.account.programRegistry.fetch(regAddr);
      expect(reg.entries).to.have.length(0);
    });
  });

  describe('register_program', () => {
    beforeEach(async () => {
      env = await startBankrun();
      program = loadBankrunProgram<GovernanceProgram>('governance_program', env.provider);
      await initConfig();
    });

    it('adds entry to registry', async () => {
      const pid = Keypair.generate().publicKey;
      await program.methods
        .registerProgram(
          label16('my_program') as unknown as number[],
          pid,
          false,
          Array.from(Buffer.alloc(32)) as unknown as number[],
          512,
        )
        .accountsPartial({ authority })
        .rpc();

      const [regAddr] = registryPda(program.programId);
      const reg = await program.account.programRegistry.fetch(regAddr);
      expect(reg.entries).to.have.length(1);
      expect(reg.entries[0].programId.toBase58()).to.equal(pid.toBase58());
      expect(reg.entries[0].isCritical).to.equal(false);
      expect(reg.entries[0].maxParamPayloadBytes).to.equal(512);
    });

    it('rejects duplicate program', async () => {
      const pid = Keypair.generate().publicKey;
      const seed = Array.from(Buffer.alloc(32)) as unknown as number[];

      await program.methods
        .registerProgram(label16('prog_a') as unknown as number[], pid, false, seed, 256)
        .accountsPartial({ authority })
        .rpc();

      try {
        await program.methods
          .registerProgram(label16('prog_b') as unknown as number[], pid, false, seed, 256)
          .accountsPartial({ authority })
          .rpc();
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(String(e)).to.match(/DuplicateProgram/);
      }
    });
  });

  describe('propose', () => {
    let proposer: Keypair;

    beforeEach(async () => {
      env = await startBankrun();
      program = loadBankrunProgram<GovernanceProgram>('governance_program', env.provider);
      await initConfig();
      await registerTarget();
      proposer = Keypair.generate();
      fundAccount(env, proposer.publicKey);
    });

    it('creates proposal in Voting status', async () => {
      const snapshot = snapshotForVoter(proposer.publicKey, 1000n);
      const { proposalAddr } = await createProposal(proposer, snapshot);

      const p = await program.account.proposalAccount.fetch(proposalAddr);
      expect(Object.keys(p.status)[0]).to.equal('voting');
      expect(p.proposer.toBase58()).to.equal(proposer.publicKey.toBase58());
      expect(p.targetProgram.toBase58()).to.equal(targetProgram.toBase58());
      expect(p.forWeight.toString()).to.equal('0');
    });

    it('rejects proposal while paused', async () => {
      await program.methods
        .setPaused(true)
        .accountsPartial({ authority })
        .rpc();

      const snapshot = snapshotForVoter(proposer.publicKey, 1000n);
      try {
        await createProposal(proposer, snapshot);
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(String(e)).to.match(/Paused/);
      }
    });

    it('rejects oversized payload', async () => {
      const snapshot = snapshotForVoter(proposer.publicKey, 1000n);
      const oversized = Buffer.alloc(257, 0xAA);

      try {
        await createProposal(proposer, snapshot, oversized);
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(String(e)).to.match(/PayloadTooLarge/);
      }
    });
  });

  describe('vote', () => {
    let voter: Keypair;
    let proposalAddr: PublicKey;

    beforeEach(async () => {
      env = await startBankrun();
      program = loadBankrunProgram<GovernanceProgram>('governance_program', env.provider);
      await initConfig();
      await registerTarget();

      voter = Keypair.generate();
      fundAccount(env, voter.publicKey);

      const snapshot = snapshotForVoter(voter.publicKey, 1000n);
      const result = await createProposal(voter, snapshot);
      proposalAddr = result.proposalAddr;
    });

    it('casts vote with valid merkle proof', async () => {
      await program.methods
        .vote({ for: {} }, new BN(1000), [])
        .accountsPartial({ proposal: proposalAddr, voter: voter.publicKey })
        .signers([voter])
        .rpc();

      const p = await program.account.proposalAccount.fetch(proposalAddr);
      expect(p.forWeight.toString()).to.equal('1000');

      const [voteAddr] = voteRecordPda(program.programId, proposalAddr, voter.publicKey);
      const v = await program.account.voteRecord.fetch(voteAddr);
      expect(Object.keys(v.choice)[0]).to.equal('for');
      expect(v.weight.toString()).to.equal('1000');
    });

    it('rejects vote after window closes', async () => {
      await warpClockBy(env.context, VOTE_WINDOW_STANDARD + 1);

      try {
        await program.methods
          .vote({ for: {} }, new BN(1000), [])
          .accountsPartial({ proposal: proposalAddr, voter: voter.publicKey })
          .signers([voter])
          .rpc();
        expect.fail('should have thrown');
      } catch (e: any) {
        expect(String(e)).to.match(/VotingEnded/);
      }
    });
  });

  describe('finalize_vote', () => {
    beforeEach(async () => {
      env = await startBankrun();
      program = loadBankrunProgram<GovernanceProgram>('governance_program', env.provider);
      await initConfig();
      await registerTarget();
    });

    it('passes with quorum + majority', async () => {
      const voter = Keypair.generate();
      fundAccount(env, voter.publicKey);

      const weight = 1000n;
      const snapshot = snapshotForVoter(voter.publicKey, weight);
      const { proposalAddr } = await createProposal(voter, snapshot);

      await program.methods
        .vote({ for: {} }, new BN(weight.toString()), [])
        .accountsPartial({ proposal: proposalAddr, voter: voter.publicKey })
        .signers([voter])
        .rpc();

      await warpClockBy(env.context, VOTE_WINDOW_STANDARD + 1);

      const cranker = Keypair.generate();
      fundAccount(env, cranker.publicKey);

      await program.methods
        .finalizeVote()
        .accountsPartial({ proposal: proposalAddr, cranker: cranker.publicKey })
        .signers([cranker])
        .rpc();

      const p = await program.account.proposalAccount.fetch(proposalAddr);
      expect(Object.keys(p.status)[0]).to.equal('passed');
      expect(p.executableAt.toNumber()).to.be.greaterThan(0);
    });

    it('rejects without quorum', async () => {
      const voter = Keypair.generate();
      fundAccount(env, voter.publicKey);

      const weight = 10n;
      const totalEligible = 100_000n;

      const leaf = computeVoteLeaf(voter.publicKey, weight);
      const snapshot = {
        totalEligibleWeight: new BN(totalEligible.toString()),
        snapshotSlot: new BN(1),
        snapshotRoot: Array.from(leaf),
      };

      const { proposalAddr } = await createProposal(voter, snapshot);

      await program.methods
        .vote({ for: {} }, new BN(weight.toString()), [])
        .accountsPartial({ proposal: proposalAddr, voter: voter.publicKey })
        .signers([voter])
        .rpc();

      await warpClockBy(env.context, VOTE_WINDOW_STANDARD + 1);

      const cranker = Keypair.generate();
      fundAccount(env, cranker.publicKey);

      await program.methods
        .finalizeVote()
        .accountsPartial({ proposal: proposalAddr, cranker: cranker.publicKey })
        .signers([cranker])
        .rpc();

      const p = await program.account.proposalAccount.fetch(proposalAddr);
      expect(Object.keys(p.status)[0]).to.equal('rejected');
    });
  });

  describe('queue_execution', () => {
    it('queues after timelock elapses', async () => {
      env = await startBankrun();
      program = loadBankrunProgram<GovernanceProgram>('governance_program', env.provider);
      await initConfig();
      await registerTarget();

      const voter = Keypair.generate();
      fundAccount(env, voter.publicKey);

      const weight = 1000n;
      const snapshot = snapshotForVoter(voter.publicKey, weight);
      const { proposalAddr } = await createProposal(voter, snapshot);

      await program.methods
        .vote({ for: {} }, new BN(weight.toString()), [])
        .accountsPartial({ proposal: proposalAddr, voter: voter.publicKey })
        .signers([voter])
        .rpc();

      await warpClockBy(env.context, VOTE_WINDOW_STANDARD + 1);

      const cranker = Keypair.generate();
      fundAccount(env, cranker.publicKey);

      await program.methods
        .finalizeVote()
        .accountsPartial({ proposal: proposalAddr, cranker: cranker.publicKey })
        .signers([cranker])
        .rpc();

      await warpClockBy(env.context, TIMELOCK_STANDARD + 1);

      await program.methods
        .queueExecution()
        .accountsPartial({ proposal: proposalAddr, cranker: cranker.publicKey })
        .signers([cranker])
        .rpc();

      const p = await program.account.proposalAccount.fetch(proposalAddr);
      expect(Object.keys(p.status)[0]).to.equal('queued');
    });
  });

  describe('expire_proposal', () => {
    it('expires after execution window', async () => {
      env = await startBankrun();
      program = loadBankrunProgram<GovernanceProgram>('governance_program', env.provider);
      await initConfig();
      await registerTarget();

      const voter = Keypair.generate();
      fundAccount(env, voter.publicKey);

      const weight = 1000n;
      const snapshot = snapshotForVoter(voter.publicKey, weight);
      const { proposalAddr } = await createProposal(voter, snapshot);

      await program.methods
        .vote({ for: {} }, new BN(weight.toString()), [])
        .accountsPartial({ proposal: proposalAddr, voter: voter.publicKey })
        .signers([voter])
        .rpc();

      await warpClockBy(env.context, VOTE_WINDOW_STANDARD + 1);

      const cranker = Keypair.generate();
      fundAccount(env, cranker.publicKey);

      await program.methods
        .finalizeVote()
        .accountsPartial({ proposal: proposalAddr, cranker: cranker.publicKey })
        .signers([cranker])
        .rpc();

      await warpClockBy(env.context, TIMELOCK_STANDARD + 1);

      await program.methods
        .queueExecution()
        .accountsPartial({ proposal: proposalAddr, cranker: cranker.publicKey })
        .signers([cranker])
        .rpc();

      await warpClockBy(env.context, EXECUTION_WINDOW_SECS + 1);

      await program.methods
        .expireProposal()
        .accountsPartial({ proposal: proposalAddr, cranker: cranker.publicKey })
        .signers([cranker])
        .rpc();

      const p = await program.account.proposalAccount.fetch(proposalAddr);
      expect(Object.keys(p.status)[0]).to.equal('expired');
    });
  });
});
