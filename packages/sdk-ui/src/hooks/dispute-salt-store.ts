const PREFIX = 'saep:dispute:salt';

export interface StoredSalt {
  salt: string;
  verdict: number;
  commitHash: string;
  caseId: string;
  round: number;
  createdAt: number;
}

function storageKey(caseId: string, round: number, wallet: string): string {
  return `${PREFIX}:${caseId}:${round}:${wallet}`;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

export async function computeCommitHash(verdictByte: number, salt: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(1 + salt.length);
  input[0] = verdictByte;
  input.set(salt, 1);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(digest);
}

export function saveSalt(
  caseId: string,
  round: number,
  wallet: string,
  salt: Uint8Array,
  verdict: number,
  commitHash: Uint8Array,
): void {
  const entry: StoredSalt = {
    salt: toHex(salt),
    verdict,
    commitHash: toHex(commitHash),
    caseId,
    round,
    createdAt: Date.now(),
  };
  localStorage.setItem(storageKey(caseId, round, wallet), JSON.stringify(entry));
}

export function loadSalt(caseId: string, round: number, wallet: string): StoredSalt | null {
  const raw = localStorage.getItem(storageKey(caseId, round, wallet));
  if (!raw) return null;
  return JSON.parse(raw) as StoredSalt;
}

export function deleteSalt(caseId: string, round: number, wallet: string): void {
  localStorage.removeItem(storageKey(caseId, round, wallet));
}

export function listPendingSalts(wallet: string): StoredSalt[] {
  const results: StoredSalt[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    if (!key.endsWith(`:${wallet}`)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    results.push(JSON.parse(raw) as StoredSalt);
  }
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export function saltFromHex(hex: string): Uint8Array {
  return fromHex(hex);
}
