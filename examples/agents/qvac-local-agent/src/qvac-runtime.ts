import './bare-runtime-shim.js';
import { close as qvacClose, loadModel, type ModelProgressUpdate, unloadModel } from '@qvac/sdk';

export const DEFAULT_LLM_SRC =
  'registry://hf/unsloth/Llama-3.2-1B-Instruct-GGUF/blob/b69aef112e9f895e6f98d7ae0949f72ff09aa401/Llama-3.2-1B-Instruct-Q4_0.gguf';

export const DEFAULT_EMBED_SRC =
  'registry://hf/unsloth/embeddinggemma-300m-GGUF/resolve/6661a6504c30d8304af13455cb4a5d4f5bc6011f/embeddinggemma-300m-Q4_0.gguf';

export type Runtime = {
  llmId: string;
  embedId: string;
  llmSrc: string;
  embedSrc: string;
  close(): Promise<void>;
};

function progressBar(label: string) {
  return (p: ModelProgressUpdate) => {
    const stage = p.stage ?? 'loading';
    const pct = Math.round((p.progress ?? 0) * 100);
    process.stderr.write(`\r[qvac] ${label}: ${stage} ${pct}%   `);
  };
}

export async function startRuntime(opts: {
  llmSrc?: string;
  embedSrc?: string;
} = {}): Promise<Runtime> {
  const llmSrc = opts.llmSrc ?? DEFAULT_LLM_SRC;
  const embedSrc = opts.embedSrc ?? DEFAULT_EMBED_SRC;

  const llmId = await loadModel({
    modelSrc: llmSrc,
    modelType: 'llm',
    onProgress: progressBar('llm'),
  });
  process.stderr.write('\n');

  const embedId = await loadModel({
    modelSrc: embedSrc,
    modelType: 'embeddings',
    onProgress: progressBar('embed'),
  });
  process.stderr.write('\n');

  return {
    llmId,
    embedId,
    llmSrc,
    embedSrc,
    async close() {
      await unloadModel({ modelId: llmId }).catch(() => {});
      await unloadModel({ modelId: embedId }).catch(() => {});
      await qvacClose().catch(() => {});
    },
  };
}
