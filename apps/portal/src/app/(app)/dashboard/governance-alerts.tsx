'use client';

import { useState } from 'react';

interface Alert {
  id: string;
  title: string;
  severity: 'info' | 'warning';
}

const STUB_ALERTS: Alert[] = [
  {
    id: 'gov-m2',
    title: 'Governance module launches with M2. Proposals, voting, and parameter changes will appear here.',
    severity: 'info',
  },
];

export function GovernanceAlerts() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = STUB_ALERTS.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {visible.map((alert) => (
        <div
          key={alert.id}
          className="flex items-start justify-between gap-3 rounded-lg border border-ink/10 p-4 text-xs bg-ink/[0.02]"
        >
          <div className="flex items-start gap-2">
            <span className="shrink-0 mt-0.5 text-mute">
              {alert.severity === 'warning' ? '⚠' : 'ℹ'}
            </span>
            <p className="text-ink/70">{alert.title}</p>
          </div>
          <button
            onClick={() => setDismissed((prev) => new Set(prev).add(alert.id))}
            className="shrink-0 text-ink/40 hover:text-ink/70 transition-colors"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
