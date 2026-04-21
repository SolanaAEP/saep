import { createHash, randomBytes } from 'node:crypto';

type Envelope = {
  id: string;
  topic: string;
  from_agent: string;
  to_agent: string | null;
  msg_type: string;
  payload_cid: string;
  payload_digest: string;
  signature: string;
  ts: number;
};

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomId(): string {
  const bytes = randomBytes(16);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  while (out.length < 26) out += ALPHABET[0];
  return out.slice(0, 26);
}

function digestPayload(payload: unknown): { payload_cid: string; payload_digest: string } {
  const body = JSON.stringify(payload);
  const payload_digest = createHash('sha256').update(body).digest('hex');
  return {
    payload_cid: `inline://${payload_digest}`,
    payload_digest,
  };
}

function buildEnvelope(
  from_agent: string,
  to_agent: string | null,
  topic: string,
  msg_type: string,
  payload: unknown,
): Envelope {
  return {
    id: randomId(),
    topic,
    from_agent,
    to_agent,
    msg_type,
    ...digestPayload(payload),
    signature: 'demo-signature',
    ts: Date.now(),
  };
}

async function publish(url: string, token: string | undefined, envelope: Envelope) {
  if (!token) {
    console.log('[dry-run]', JSON.stringify(envelope, null, 2));
    return;
  }

  const response = await fetch(`${url}/publish`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-iacp-service-token': token,
    },
    body: JSON.stringify({ envelope }),
  });

  if (!response.ok) {
    throw new Error(`publish failed (${response.status}): ${await response.text()}`);
  }

  const json = await response.json() as { stream_id?: string };
  console.log(`[publish] ${envelope.topic} -> ${json.stream_id ?? 'ok'}`);
}

async function main() {
  const url = process.env.IACP_URL ?? 'http://127.0.0.1:8080';
  const token = process.env.IACP_SERVICE_TOKEN;
  const taskId = process.env.DEMO_TASK_ID ?? createHash('sha256').update('subagent-hiring-demo').digest('hex');
  const lead = process.env.LEAD_AGENT_DID ?? '11111111111111111111111111111111';
  const specialistA = process.env.SPECIALIST_A_DID ?? '11111111111111111111111111111111';
  const specialistB = process.env.SPECIALIST_B_DID ?? '11111111111111111111111111111111';

  const envelopes = [
    buildEnvelope(lead, specialistA, `agent.${specialistA}.inbox`, 'task_request', {
      task_id: taskId,
      role: 'route-sim',
      brief: 'Simulate the best Jupiter route and return the expected out amount.',
    }),
    buildEnvelope(lead, specialistB, `agent.${specialistB}.inbox`, 'task_request', {
      task_id: taskId,
      role: 'copy-draft',
      brief: 'Draft the x402 social copy announcing the paid capability.',
    }),
    buildEnvelope(specialistA, null, `task.${taskId}.events`, 'status_update', {
      role: 'route-sim',
      result: 'Quoted SOL->SAEP route with 3 hops and 0.42% impact.',
    }),
    buildEnvelope(specialistB, null, `task.${taskId}.events`, 'status_update', {
      role: 'copy-draft',
      result: 'Drafted a paid launch thread with x402 call-to-action.',
    }),
    buildEnvelope(lead, null, `task.${taskId}.events`, 'a2a_orchestration', {
      summary: 'Lead agent accepted both specialist outputs and is ready to settle the parent task.',
    }),
  ];

  console.log(`[subagent-hiring-demo] task=${taskId} dryRun=${!token}`);
  for (const envelope of envelopes) {
    await publish(url, token, envelope);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
