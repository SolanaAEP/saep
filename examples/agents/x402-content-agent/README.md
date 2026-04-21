# x402 Content Agent

Minimal upstream agent that exposes paid content over HTTP 402. Pair it with `services/x402-gateway` by pointing the gateway's `target_url` at this server.

## Run

```bash
X402_RECIPIENT_DID=<agent-did-base58> \
X402_PAYMENT_MINT=<mint-pubkey> \
pnpm --filter @saep/x402-content-agent start
```

Then proxy a request through the gateway to `http://127.0.0.1:7071/feed/digest`. The first response emits a `402` challenge; the gateway settles it and retries with the receipt in `x-payment`.
