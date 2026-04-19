import { PublicKey } from '@solana/web3.js';
import {
  fetchAgentsByOperator,
  fetchTasksByClient,
  fetchTaskById,
  type AgentSummary,
  type TaskSummary,
} from '@saep/sdk';
import type { BotContext } from './context.js';

const CAPABILITY_NAMES: Record<number, string> = {
  0: 'Swap',
  1: 'Transfer',
  2: 'DataFetch',
  3: 'Compute',
  4: 'Generic',
  5: 'Bridge',
  6: 'Governance',
  7: 'Staking',
};

function capBits(mask: bigint): string[] {
  const names: string[] = [];
  for (let i = 0; i < 64; i++) {
    if (mask & (1n << BigInt(i))) {
      names.push(CAPABILITY_NAMES[i] ?? `bit:${i}`);
    }
  }
  return names;
}

function statusEmoji(s: string): string {
  switch (s) {
    case 'active': return '\u{1f7e2}';
    case 'paused': return '\u{1f7e1}';
    case 'funded': return '\u{1f4b0}';
    case 'completed': return '\u{2705}';
    case 'disputed': return '\u{26a0}\u{fe0f}';
    default: return '\u{26aa}';
  }
}

function truncAddr(pk: PublicKey): string {
  const s = pk.toBase58();
  return `${s.slice(0, 4)}..${s.slice(-4)}`;
}

function formatAgent(a: AgentSummary, portalUrl: string): string {
  const caps = capBits(a.capabilityMask).join(', ') || 'none';
  const price = Number(a.priceLamports) / 1e9;
  return [
    `${statusEmoji(a.status)} *${a.manifestUri.split('/').pop() || truncAddr(a.address)}*`,
    `  Operator: \`${truncAddr(a.operator)}\``,
    `  Caps: ${caps}`,
    `  Price: ${price} SOL`,
    `  Jobs: ${a.jobsCompleted}`,
    `  [View](${portalUrl}/agents/${a.address.toBase58()})`,
  ].join('\n');
}

function formatTask(t: TaskSummary, portalUrl: string): string {
  const amount = Number(t.paymentAmount) / 1e6;
  return [
    `${statusEmoji(t.status)} Task \`${truncAddr(t.address)}\``,
    `  Status: ${t.status}`,
    `  Amount: ${amount} USDC`,
    `  Deadline: ${new Date(t.deadline * 1000).toISOString().slice(0, 16)}`,
    `  [View](${portalUrl}/tasks/${t.address.toBase58()})`,
  ].join('\n');
}

export async function handleAgents(ctx: BotContext): Promise<string> {
  try {
    const all = await ctx.agentRegistry.account.agentAccount.all();
    if (all.length === 0) return 'No agents registered yet.';

    const agents: AgentSummary[] = all.slice(0, 10).map(({ publicKey, account }) => ({
      address: publicKey,
      operator: account.operator,
      agentId: Uint8Array.from(account.agentId as number[]),
      did: Uint8Array.from(account.did as number[]),
      manifestUri: '',
      capabilityMask: BigInt(account.capabilityMask?.toString() ?? '0'),
      priceLamports: BigInt(account.priceLamports?.toString() ?? '0'),
      streamRate: 0n,
      stakeAmount: 0n,
      status: 'active',
      jobsCompleted: BigInt(account.jobsCompleted?.toString() ?? '0'),
      registeredAt: 0,
    }));

    return agents.map((a) => formatAgent(a, ctx.portalUrl)).join('\n\n');
  } catch {
    return 'Failed to fetch agents. Network may be unavailable.';
  }
}

export async function handlePortfolio(ctx: BotContext, walletAddress: string): Promise<string> {
  try {
    const operator = new PublicKey(walletAddress);
    const agents = await fetchAgentsByOperator(ctx.agentRegistry, operator);
    if (agents.length === 0) return 'No agents found for this wallet.';
    return agents.map((a) => formatAgent(a, ctx.portalUrl)).join('\n\n');
  } catch {
    return 'Invalid wallet address or network error.';
  }
}

export async function handleStatus(ctx: BotContext, taskId: string): Promise<string> {
  try {
    const task = await fetchTaskById(ctx.taskMarket, taskId);
    if (!task) return `Task \`${taskId}\` not found.`;
    return formatTask(task, ctx.portalUrl);
  } catch {
    return 'Failed to fetch task. Check the ID and try again.';
  }
}

export async function handleHire(ctx: BotContext, capability: string): Promise<string> {
  const capIndex = Object.entries(CAPABILITY_NAMES).find(
    ([, name]) => name.toLowerCase() === capability.toLowerCase(),
  )?.[0];

  if (capIndex === undefined) {
    const valid = Object.values(CAPABILITY_NAMES).join(', ');
    return `Unknown capability "${capability}". Valid: ${valid}`;
  }

  const bit = BigInt(capIndex);

  try {
    const all = await ctx.agentRegistry.account.agentAccount.all();
    const matching = all.filter(({ account }) => {
      const mask = BigInt(account.capabilityMask?.toString() ?? '0');
      return mask & (1n << bit);
    });

    if (matching.length === 0) {
      return `No agents found with capability "${capability}".`;
    }

    const lines = matching.slice(0, 5).map(({ publicKey }) =>
      `- \`${truncAddr(publicKey)}\` [Hire](${ctx.portalUrl}/agents/${publicKey.toBase58()})`
    );

    return `Agents with *${capability}* capability:\n${lines.join('\n')}`;
  } catch {
    return 'Failed to search agents. Network may be unavailable.';
  }
}

export function handleRegister(ctx: BotContext): string {
  return [
    'To register as an agent operator:',
    '',
    `1. Go to [SAEP Portal](${ctx.portalUrl}/register)`,
    '2. Connect your Solana wallet',
    '3. Choose capabilities and set your price',
    '',
    `Or use the Blink: ${ctx.portalUrl}/api/actions/register-agent`,
  ].join('\n');
}

export function handleStart(ctx: BotContext): string {
  return [
    '*SAEP Bot* - Solana Agent Economy Protocol',
    '',
    'Commands:',
    '/agents - List available agents',
    '/hire <capability> - Find agents by capability',
    '/status <task\\_id> - Check task status',
    '/portfolio <wallet> - View agent fleet',
    '/register - Register as an agent',
    '',
    `Portal: ${ctx.portalUrl}`,
  ].join('\n');
}
