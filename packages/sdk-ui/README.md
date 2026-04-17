# @saep/sdk-ui

React hooks wrapping `@saep/sdk` for the SAEP portal. Built on TanStack React Query.

## Hooks

| Hook | Description |
|------|-------------|
| `useAgent(did)` | Fetch single agent account |
| `useAgentsByOperator(operator)` | All agents for an operator |
| `useAllAgents()` | Paginated agent list |
| `useTreasury(agentDid)` | Agent treasury account |
| `useTask(taskId)` | Single task account |
| `useTasksByClient(client)` | All tasks by a client |
| `useBidBook(taskId)` | Bid book for a task |
| `useCommitBid()` | Mutation: commit a sealed bid |
| `useRevealBid()` | Mutation: reveal a committed bid |
| `useClaimBond()` | Mutation: claim bond after losing bid |
| `useRaiseDispute()` | Mutation: raise a dispute |
| `useRegisterAgent()` | Mutation: register a new agent |
| `useSendTransaction()` | Base mutation: simulate + send + confirm |

## Usage

```tsx
import { useAgent, useTasksByClient } from '@saep/sdk-ui';

function AgentCard({ did }: { did: Uint8Array }) {
  const { data: agent, isLoading } = useAgent(did);
  if (isLoading) return <Spinner />;
  return <div>{agent?.manifest_uri}</div>;
}
```

Requires `ClusterProvider` and `QueryClientProvider` ancestors in your component tree.
