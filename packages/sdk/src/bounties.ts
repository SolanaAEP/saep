export interface MarketplaceBounty {
  slug: string;
  title: string;
  summary: string;
  prompt: string;
  rewardUi: string;
  suggestedMint: 'SOL' | 'SAEP';
  taskHash: string;
}

export const MARKETPLACE_BOUNTIES: MarketplaceBounty[] = [
  {
    slug: 'ts-market-maker',
    title: 'TypeScript task market-maker',
    summary: 'Auto-bidder for fresh code-generation tasks with local devnet runner.',
    rewardUi: '0.45',
    suggestedMint: 'SOL',
    taskHash: 'b80e14bf92ced469e88350154999ab066e0493ea8793d8983aa0b2fea59801db',
    prompt: 'Build a TypeScript market-maker agent for SAEP that watches fresh task_market listings, auto-commits bids for code-generation jobs under 0.25 SOL, reveals bids on time, and includes a local devnet runner plus README.',
  },
  {
    slug: 'python-sdk-wrapper',
    title: 'Python SDK wrapper',
    summary: 'Python helpers for create-task, bidding, and submit-result with notebook walkthrough.',
    rewardUi: '2500',
    suggestedMint: 'SAEP',
    taskHash: 'f30289991acab1c3b5e13bc8e2c94f40df73a8da51d295c3692926e9f731c2ad',
    prompt: 'Ship a Python SAEP wrapper with create-task, open-bidding, commit-bid, reveal-bid, and submit-result helpers, plus a notebook that walks through one end-to-end devnet task.',
  },
  {
    slug: 'x402-social-agent',
    title: 'x402 social/content agent',
    summary: 'Paid SAEP summary agent that settles through the x402 gateway.',
    rewardUi: '1800',
    suggestedMint: 'SAEP',
    taskHash: '495178c389ba4395b52a6218e0f539b0ae9b843bb8f67a3fc1cdf97b25676254',
    prompt: 'Create an x402-powered social/content agent that sells SAEP task summaries over HTTP 402, settles through the SAEP x402 gateway, and ships with a one-command deploy example.',
  },
  {
    slug: 'subagent-hiring-demo',
    title: 'Sub-agent hiring demo',
    summary: 'Lead agent that coordinates specialists over IACP and settles child payouts.',
    rewardUi: '0.80',
    suggestedMint: 'SOL',
    taskHash: 'e46e3639fee907628d019c3d1a53b265d344b505a6b2c040e9996064e877d1b9',
    prompt: 'Implement a sub-agent hiring demo where a lead SAEP agent delegates work to two specialists over IACP, aggregates their outputs, and settles payouts through task_market.',
  },
  {
    slug: 'jupiter-executor',
    title: 'Jupiter execution agent',
    summary: 'Treasury rebalance worker with route simulation and proof-ready execution output.',
    rewardUi: '1.10',
    suggestedMint: 'SOL',
    taskHash: 'a71c50fbdec0d43d21600076cc42551bf869d3283655590760028d6f363c7946',
    prompt: 'Build a Jupiter execution agent that accepts SAEP treasury rebalance tasks, simulates routes before execution, and submits proof-ready execution summaries for settlement.',
  },
  {
    slug: 'pyth-oracle-watcher',
    title: 'Oracle watcher agent',
    summary: 'Pyth/Switchboard watcher that turns signed deviations into proof-friendly tasks.',
    rewardUi: '1600',
    suggestedMint: 'SAEP',
    taskHash: '8be49320254913d577e6a4911240d7ea3700eca32c3787cc9eb76de7792bbfb4',
    prompt: 'Create a Pyth and Switchboard oracle watcher agent that turns signed price deviations into SAEP tasks and emits witness data suitable for proof-gen verification.',
  },
  {
    slug: 'governance-ops-agent',
    title: 'Governance ops copilot',
    summary: 'Proposal watcher that drafts vote recommendations and publishes rationale to IACP.',
    rewardUi: '1200',
    suggestedMint: 'SAEP',
    taskHash: 'f26811690c9dbbf049e5123918420cac21dbadfa16f722ded661ee87204f8232',
    prompt: 'Ship a governance ops agent that watches SAEP proposals, drafts vote recommendations, posts rationale to IACP, and exposes a reviewable action log.',
  },
  {
    slug: 'reputation-auditor',
    title: 'Reputation auditor',
    summary: 'Settlement anomaly detector backed by reproducible reports.',
    rewardUi: '0.65',
    suggestedMint: 'SOL',
    taskHash: '0db3cd8924eb51055b7c96ae7e69c03ddedfcf05ff374533795511d34305206d',
    prompt: 'Build a reputation auditor agent that reads indexer plus proof events, flags suspicious settlement patterns, and publishes reproducible investigation reports through SAEP.',
  },
  {
    slug: 'docs-concierge',
    title: 'Docs concierge',
    summary: 'Developer-facing SAEP integration assistant with x402 upsell path.',
    rewardUi: '900',
    suggestedMint: 'SAEP',
    taskHash: '59473ccae290cc7ee9aa8f9b1441733d56b401aa2f35928c6a94df1561e17bcc',
    prompt: 'Create a docs concierge agent for SAEP integrations that answers developer questions, quotes relevant specs, and sells advanced responses over x402.',
  },
  {
    slug: 'treasury-sweeper',
    title: 'Treasury sweeper',
    summary: 'Policy-driven auto-swap agent for stable inflows into SAEP or SOL.',
    rewardUi: '1.25',
    suggestedMint: 'SOL',
    taskHash: '5d29c10a882c7d5109d63737ee514219ba88391f2462b452a2959818f18c5f11',
    prompt: 'Implement a treasury sweeper agent that auto-swaps inbound stable balances into SAEP or SOL through Jupiter according to configurable treasury policy thresholds.',
  },
  {
    slug: 'sandbox-verifier',
    title: 'Sandbox verifier template',
    summary: 'Deterministic code execution verifier that emits witness bundles for proof-gen.',
    rewardUi: '2000',
    suggestedMint: 'SAEP',
    taskHash: 'eb8be52e0fc8ac2bbf1cb7d6129abdab60813e5b16551af596838f743e0fa2d0',
    prompt: 'Build a code execution verifier agent template that runs submitted jobs in a sandbox, records deterministic outputs, and emits witness bundles for SAEP proof-gen.',
  },
  {
    slug: 'template-publisher',
    title: 'Template registry publisher',
    summary: 'Reusable task-template packager with royalty metadata and local setup docs.',
    rewardUi: '1100',
    suggestedMint: 'SAEP',
    taskHash: '3b88c10ea634e7081149380c35bf77276bffc95fa79e6fdabfebe75d55bf710a',
    prompt: 'Create a template registry publisher agent that packages reusable SAEP task templates with royalty metadata, deployment docs, and one-command local setup.',
  },
];

export function findMarketplaceBountyByTaskHash(taskHash: string): MarketplaceBounty | null {
  return MARKETPLACE_BOUNTIES.find((bounty) => bounty.taskHash === taskHash) ?? null;
}
