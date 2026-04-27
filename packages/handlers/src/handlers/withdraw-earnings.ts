import { PublicKey, Transaction } from '@solana/web3.js';
import { treasuryStandardProgram, buildWithdrawEarnedIx } from '@saep/sdk';
import type { HandlerContext, HandlerResult } from '../types.js';
import type { WithdrawEarningsInput } from '../schemas.js';
import { bytesToHex } from '../crypto.js';
import { resolveTokenProgram } from '../context.js';
import { enforceGuardrails, type GuardrailOpts } from '../guardrails.js';

export async function handleWithdrawEarnings(
  ctx: HandlerContext,
  input: WithdrawEarningsInput,
  opts?: GuardrailOpts,
): Promise<HandlerResult> {
  const treasury = treasuryStandardProgram(ctx.provider, ctx.config);

  const streamPk = new PublicKey(input.stream_address);
  const stream = (await treasury.account.paymentStream.fetch(streamPk)) as {
    agentDid: number[];
    payerMint: PublicKey;
    payoutMint: PublicKey;
  };
  const agentDid = Uint8Array.from(stream.agentDid);
  const agentDidHex = bytesToHex(agentDid);
  const swapped = !stream.payerMint.equals(stream.payoutMint);

  if (swapped && !input.route_data_base64) {
    return {
      cluster: ctx.cluster,
      error: 'swap_route_required',
      agent_did_hex: agentDidHex,
      reason: 'cross-mint withdrawals need route_data_base64 plus Jupiter + oracle accounts',
    };
  }
  if (swapped && (!input.jupiter_program || !input.payer_price_feed || !input.payout_price_feed)) {
    return {
      cluster: ctx.cluster,
      error: 'swap_accounts_required',
      agent_did_hex: agentDidHex,
      reason: 'cross-mint withdrawals need jupiter_program, payer_price_feed, and payout_price_feed',
    };
  }

  const routeData = input.route_data_base64
    ? Uint8Array.from(Buffer.from(input.route_data_base64, 'base64'))
    : new Uint8Array();
  const tokenProgramId = await resolveTokenProgram(ctx.connection, stream.payerMint);

  const ix = await buildWithdrawEarnedIx(treasury, {
    operator: ctx.operator,
    agentDid,
    stream: streamPk,
    payerMint: stream.payerMint,
    payoutMint: stream.payoutMint,
    jupiterProgram: input.jupiter_program ? new PublicKey(input.jupiter_program) : PublicKey.default,
    routeData,
    payerPriceFeed: input.payer_price_feed ? new PublicKey(input.payer_price_feed) : undefined,
    payoutPriceFeed: input.payout_price_feed ? new PublicKey(input.payout_price_feed) : undefined,
    tokenProgramId,
  });
  const tx = new Transaction().add(ix);
  enforceGuardrails(opts);
  const signature = await ctx.provider.sendAndConfirm(tx);

  return {
    cluster: ctx.cluster,
    signature,
    stream_address: streamPk.toBase58(),
    agent_did_hex: agentDidHex,
    payer_mint: stream.payerMint.toBase58(),
    payout_mint: stream.payoutMint.toBase58(),
    swapped,
  };
}
