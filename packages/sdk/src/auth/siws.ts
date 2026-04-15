export interface SiwsMessage {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: '1';
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

const LABELS: Array<[keyof SiwsMessage, string]> = [
  ['uri', 'URI'],
  ['version', 'Version'],
  ['chainId', 'Chain ID'],
  ['nonce', 'Nonce'],
  ['issuedAt', 'Issued At'],
  ['expirationTime', 'Expiration Time'],
];

export function formatSiwsMessage(msg: SiwsMessage): string {
  const header = `${msg.domain} wants you to sign in with your Solana account:\n${msg.address}`;
  const body = LABELS.map(([key, label]) => `${label}: ${msg[key]}`).join('\n');
  return `${header}\n\n${msg.statement}\n\n${body}`;
}

