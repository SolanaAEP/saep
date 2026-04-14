'use client';

import dynamic from 'next/dynamic';

const WalletMultiButton = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false },
);

export default function Page() {
  return (
    <main style={{ padding: '4rem 2rem', maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: '4rem', fontWeight: 700, letterSpacing: '-0.03em' }}>SAEP</h1>
      <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>Solana Agent Economy Protocol — bootstrap</p>
      <div style={{ marginTop: '2rem' }}>
        <WalletMultiButton />
      </div>
    </main>
  );
}
