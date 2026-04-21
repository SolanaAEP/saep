import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 7071);
const recipient = process.env.X402_RECIPIENT_DID ?? '11111111111111111111111111111111';
const mint = process.env.X402_PAYMENT_MINT ?? 'So11111111111111111111111111111111111111112';
const amount = Number(process.env.X402_PAYMENT_AMOUNT ?? '1000000');

function json(body: unknown) {
  return JSON.stringify(body, null, 2);
}

const server = createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('missing url');
    return;
  }

  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(json({ status: 'ok' }));
    return;
  }

  if (req.url !== '/feed/digest') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(json({ error: 'not_found' }));
    return;
  }

  const header = req.headers['x-payment'];
  if (typeof header !== 'string') {
    res.writeHead(402, {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'x-payment': JSON.stringify({
        scheme: 'exact',
        amount,
        mint,
        recipient,
        resource: '/feed/digest',
      }),
    });
    res.end(json({
      error: 'payment_required',
      detail: 'Pay to unlock the latest SAEP ecosystem digest.',
    }));
    return;
  }

  const receipt = JSON.parse(header) as { tx_sig?: string; task?: string };
  if (!receipt.tx_sig) {
    res.writeHead(402, {
      'content-type': 'application/json',
      'x-payment': JSON.stringify({
        scheme: 'exact',
        amount,
        mint,
        recipient,
        resource: '/feed/digest',
      }),
    });
    res.end(json({ error: 'invalid_receipt' }));
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(json({
    headline: 'SAEP daily digest',
    settledTx: receipt.tx_sig,
    task: receipt.task ?? null,
    highlights: [
      'Task market volume is rising with seeded bounties.',
      'x402 settlement routes can point at any SAEP-aware paid endpoint.',
      'Reference agents can use this pattern to monetize summaries or reports.',
    ],
  }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[x402-content-agent] listening on :${port}`);
});
