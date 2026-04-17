'use client';

import { useTreasury } from '@saep/sdk-ui';
import { TreasuryTimeline } from './treasury-timeline';

function didFromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
}

interface Props {
  didHex: string;
  children: React.ReactNode;
}

export function AgentDetailShell({ didHex, children }: Props) {
  const { data: treasury } = useTreasury(didHex.length === 64 ? didFromHex(didHex) : null);

  return (
    <>
      {children}
      <TreasuryTimeline treasury={treasury ?? null} />
    </>
  );
}
