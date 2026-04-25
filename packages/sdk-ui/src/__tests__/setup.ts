import { vi } from 'vitest';

// stub wallet-adapter-react — all hooks tests override via wrapper
vi.mock('@solana/wallet-adapter-react', () => ({
  useConnection: vi.fn(() => ({
    connection: {
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: 'mock-blockhash',
        lastValidBlockHeight: 100,
      }),
      simulateTransaction: vi.fn().mockResolvedValue({
        value: { err: null, unitsConsumed: 200_000, logs: ['log1'] },
      }),
      confirmTransaction: vi.fn().mockResolvedValue({ value: {} }),
    },
  })),
  useWallet: vi.fn(() => ({
    publicKey: null,
    sendTransaction: vi.fn(),
    signTransaction: vi.fn(),
  })),
  useAnchorWallet: vi.fn(() => null),
}));

vi.mock('@saep/sdk', async () => {
  const actual = await vi.importActual<typeof import('@saep/sdk')>('@saep/sdk');
  return {
    ...actual,
    fetchAgentsByOperator: vi.fn(),
    fetchAgentByDid: vi.fn(),
    fetchTasksByAgent: vi.fn(),
    fetchTreasury: vi.fn(),
    fetchAllAgentsDetailed: vi.fn(),
    fetchTemplateRegistryConfig: vi.fn(),
    fetchAllTemplates: vi.fn(),
    fetchTemplateById: vi.fn(),
    fetchTemplateForks: vi.fn(),
    fetchTemplateRentals: vi.fn(),
    fetchTemplateRentalsByRenter: vi.fn(),
    buildOpenRentalIx: vi.fn(),
    buildForkTemplateIx: vi.fn(),
    buildClaimRentalRevenueIx: vi.fn(),
    buildCloseRentalIx: vi.fn(),
    fetchTaskById: vi.fn(),
    fetchTasksByClient: vi.fn(),
    fetchRecentTasks: vi.fn(),
    fetchMarketGlobal: vi.fn(),
    buildRaiseDisputeIx: vi.fn(),
    buildRegisterAgentIx: vi.fn(),
    buildSetLimitsIx: vi.fn(),
    fetchBidBook: vi.fn(),
    fetchBidsForTask: vi.fn(),
    fetchBid: vi.fn(),
    buildCommitBidIx: vi.fn(),
    buildRevealBidIx: vi.fn(),
    buildClaimBondIx: vi.fn(),
    fetchAllowedMints: vi.fn(),
    fetchStreamsByAgent: vi.fn(),
    fetchVaultBalances: vi.fn(),
    fetchCategoryReputation: vi.fn(),
    fetchCategoryReputationsByAgent: vi.fn(),
    fetchSettlement: vi.fn(),
    agentRegistryProgram: vi.fn(),
    capabilityRegistryProgram: vi.fn(),
    taskMarketProgram: vi.fn(),
    proofVerifierProgram: vi.fn(),
    treasuryStandardProgram: vi.fn(),
    governanceProgramProgram: vi.fn(),
    nxsStakingProgram: vi.fn(),
    templateRegistryProgram: vi.fn(),
    StakedRpcSubmitter: vi.fn(),
    clampPriorityFee: vi.fn((v: number) => v),
    getHeliusPriorityFeeEstimate: vi.fn(),
    withPriorityFee: vi.fn(),
    JitoBundleSubmitter: vi.fn(),
  };
});
