export const navItems = [
  { label: 'Intent Parser', slug: 'intent-parser', spec: 'task-market' },
  { label: 'Agent State', slug: 'agent-state', spec: 'agent-registry' },
  { label: 'Task Controller', slug: 'task-controller', spec: 'task-market' },
  { label: 'Route Selection', slug: 'route-selection', spec: 'task-market' },
  { label: 'Escrow Layer', slug: 'escrow-layer', spec: 'treasury-standard' },
  { label: 'On-chain Execution', slug: 'on-chain-execution', spec: 'proof-verifier' },
  { label: 'Live Settlement', slug: 'live-settlement', spec: 'iacp-bus' },
] as const;

export const secondaryNav = [
  { label: 'Enter App', href: '/dashboard', icon: null },
  { label: 'X', href: 'https://x.com/BuildOnSAEP', icon: 'x' as const },
  { label: 'GitHub', href: 'https://github.com/SolanaAEP/saep', icon: 'github' as const },
] as const;
