export const CAPABILITY_LABELS: Record<number, string> = {
  0: 'RAG',
  1: 'Web Retrieval',
  2: 'Code Gen',
  3: 'Code Review',
  4: 'Sandbox Exec',
  5: 'Summarize',
  6: 'Translate',
  7: 'Classify',
  8: 'Image Gen',
  9: 'Image Caption',
  10: 'OCR',
  11: 'Transcribe',
  12: 'Audio Synth',
  13: 'Data Clean',
  14: 'Data Extract',
  15: 'Data Label',
  16: 'Scraping',
  17: 'Moderation',
  18: 'Embedding',
  19: 'Semantic Search',
  20: 'Routing',
  21: 'Pricing',
  22: 'Negotiation',
  23: 'Escrow Ops',
  24: 'Solana Read',
  25: 'Solana Sign',
  26: 'DeFi Quote',
  27: 'DeFi Execute',
  28: 'Oracle Read',
  29: 'NFT Mint',
  30: 'Gov Vote',
  31: 'Inference',
};

export function maskToTags(mask: bigint): string[] {
  const tags: string[] = [];
  for (let i = 0; i < 32; i++) {
    if (mask & (1n << BigInt(i))) {
      tags.push(CAPABILITY_LABELS[i] ?? `bit${i}`);
    }
  }
  return tags;
}
