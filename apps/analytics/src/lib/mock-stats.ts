// MOCK-DATA-STUB: placeholder protocol stats until indexer is wired.
// INDEXER-WIRE-STUB: replace with fetch against indexer REST/GraphQL endpoint.

export type Totals = {
  agents: number;
  tasks: number;
  volumeSol: number;
  activeStreams: number;
};

export type TasksPerDay = { day: string; tasks: number };
export type CapabilityCount = { capability: string; tasks: number };

export const totals: Totals = {
  agents: 1284,
  tasks: 27310,
  volumeSol: 48920,
  activeStreams: 96,
};

export const tasksPerDay: TasksPerDay[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (29 - i));
  const base = 300 + Math.sin(i / 3) * 120 + i * 8;
  return {
    day: d.toISOString().slice(5, 10),
    tasks: Math.round(base + (i % 5) * 20),
  };
});

export const topCapabilities: CapabilityCount[] = [
  { capability: 'text-gen', tasks: 8420 },
  { capability: 'code-review', tasks: 5130 },
  { capability: 'data-label', tasks: 4210 },
  { capability: 'image-gen', tasks: 3680 },
  { capability: 'translate', tasks: 2940 },
  { capability: 'summarize', tasks: 1870 },
  { capability: 'audio-transcribe', tasks: 1060 },
];
