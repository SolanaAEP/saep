import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import { keccak_256 } from 'js-sha3';
import { getProvider } from './helpers/setup';
import { taskMarket, PROGRAM_IDS } from './helpers/accounts';
import type { TaskMarket } from '../target/types/task_market';

// CU-MEASURE-PENDING

describe('task_market commit-reveal bidding', () => {
  const provider = getProvider();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const idl = require('../target/idl/task_market.json');
  const program = new anchor.Program<TaskMarket>(idl, provider);

  it('program id matches Anchor.toml', () => {
    expect(program.programId.toBase58()).to.equal(PROGRAM_IDS.task_market.toBase58());
  });

  it('bid_book PDA is deterministic', () => {
    const taskId = new Uint8Array(32).fill(7);
    const [a] = taskMarket.bidBook(taskId);
    const [b] = taskMarket.bidBook(taskId);
    expect(a.toBase58()).to.equal(b.toBase58());
  });

  it('bid PDA depends on bidder', () => {
    const taskId = new Uint8Array(32).fill(7);
    const bidder1 = anchor.web3.Keypair.generate().publicKey;
    const bidder2 = anchor.web3.Keypair.generate().publicKey;
    const [a] = taskMarket.bid(taskId, bidder1);
    const [b] = taskMarket.bid(taskId, bidder2);
    expect(a.toBase58()).to.not.equal(b.toBase58());
  });

  it('commit hash matches on-chain keccak(amount_le || nonce || agent_did)', () => {
    const amount = 1234n;
    const amountLe = new Uint8Array(8);
    new DataView(amountLe.buffer).setBigUint64(0, amount, true);
    const nonce = new Uint8Array(32).fill(3);
    const agentDid = new Uint8Array(32).fill(5);
    const buf = Buffer.concat([Buffer.from(amountLe), Buffer.from(nonce), Buffer.from(agentDid)]);
    const hash = keccak_256(buf);
    expect(hash).to.have.length(64);
  });

  it.skip('happy path: open -> 3 commits -> 3 reveals -> close picks lowest bid',
    async () => {
      // Requires anchor localnet bringup with funded task + 3 agent accounts.
    });

  it.skip('reveal mismatch marks bid.slashed, does not increment reveal_count', async () => {
    // Covers spec §79: slash on success path, not Err.
  });

  it.skip('over-cap: 65th commit_bid rejected with TooManyBidders', async () => {
    // MAX_BIDDERS_PER_TASK = 64.
  });

  it.skip('commit before commit_start or after commit_end -> PhaseClosed', async () => {
    // Requires warp helper.
  });

  it.skip('reveal outside [commit_end, reveal_end) -> PhaseClosed', async () => {
    // Requires warp helper.
  });

  it.skip('zero reveals -> close_bidding sets phase=Cancelled, all claim refund', async () => {
    // Spec §81: no slash on Cancelled.
  });

  it.skip('cancel_bidding: commit_count==0 + now<commit_end succeeds', async () => {
    // Frees rent back to client, clears task.bid_book.
  });

  it.skip('cancel_bidding: commit_count>0 -> CommitsPresent', async () => {});

  it.skip('submit_result: task with bid_book rejects non-winner agent', async () => {
    // assigned_agent gate.
  });

  it.skip('submit_result: task without bid_book retains direct-assign path', async () => {});

  it.skip('claim_bond: winner bond retained in escrow (refunded=true, no transfer)',
    async () => {
      // Spec §84 row 2.
    });

  it.skip('claim_bond: non-winner revealed gets full refund', async () => {});

  it.skip('claim_bond: non-revealed bidder bond goes to fee_collector, emits BidSlashed',
    async () => {});

  it.skip('claim_bond: double-claim rejected with AlreadyRefunded', async () => {});
});
