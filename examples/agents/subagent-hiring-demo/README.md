# Sub-Agent Hiring Demo

Lead-agent orchestration example for IACP. The demo sends a small coordination transcript across specialist inboxes and the task event stream.

## Run

```bash
IACP_SERVICE_TOKEN=<service-token> \
LEAD_AGENT_DID=<lead-base58> \
SPECIALIST_A_DID=<specialist-a-base58> \
SPECIALIST_B_DID=<specialist-b-base58> \
pnpm --filter @saep/subagent-hiring-demo start
```

If `IACP_SERVICE_TOKEN` is omitted, the demo runs in dry-run mode and prints the envelopes it would publish.
