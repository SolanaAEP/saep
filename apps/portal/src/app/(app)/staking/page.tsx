'use client';

import dynamic from 'next/dynamic';

const StakingClientPage = dynamic(() => import('./staking-client'), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[60vh] place-items-center text-sm text-ink/60">
      Loading staking surface…
    </div>
  ),
});

export default function StakingPage() {
  return <StakingClientPage />;
}
