// Tool-call grounded completion: an agent loop where the LLM decides to call
// @saep/sdk fetchers (fetch_agent, fetch_task, fetch_treasury) during its
// reasoning, the runtime executes them, and the model then produces a final
// answer using the tool results. Implements a single round of tool execution
// followed by a final-answer pass — enough to demonstrate ReAct-shaped
// reasoning without unbounded recursion.

import { completion, loadModel, type ModelProgressUpdate, unloadModel } from '@qvac/sdk';
import './bare-runtime-shim.js';
import { SAEP_TOOLS, type SaepToolName, type ToolHandler } from './saep-tools.js';

// Qwen3-1.7B is QVAC's reference tool-calling model — what their own
// llamacpp-native-tools example uses. The 1B Llama tool-calling fork doesn't
// reliably emit the native tool-call format on this prompt shape; Qwen3 does.
export const TOOL_LLM_SRC =
  'registry://hf/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_0.gguf';

export type ToolCompletionResult = {
  finalOutput: string;
  toolCalls: Array<{ name: string; arguments: unknown; result?: unknown; error?: string }>;
  rounds: number;
};

export async function loadToolModel(opts: {
  modelSrc?: string;
  ctxSize?: number;
} = {}): Promise<{ modelId: string; close: () => Promise<void> }> {
  const modelId = await loadModel({
    modelSrc: opts.modelSrc ?? TOOL_LLM_SRC,
    modelType: 'llm',
    modelConfig: {
      ctx_size: opts.ctxSize ?? 4096,
      tools: true,
    },
    onProgress: (p: ModelProgressUpdate) =>
      process.stderr.write(`\r[qvac] tool-llm: ${p.stage ?? 'loading'} ${Math.round((p.progress ?? 0) * 100)}%   `),
  } as Parameters<typeof loadModel>[0]);
  process.stderr.write('\n');
  return {
    modelId,
    close: () => unloadModel({ modelId }).catch(() => {}),
  };
}

function toolDefsForCompletion(): Array<{ name: string; description: string; parameters: unknown }> {
  return SAEP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export async function runWithTools(opts: {
  modelId: string;
  taskPrompt: string;
  groundingContext?: string;
  handlers: Record<SaepToolName, ToolHandler>;
  maxRounds?: number;
  systemPrompt?: string;
}): Promise<ToolCompletionResult> {
  const maxRounds = opts.maxRounds ?? 2;
  const baseSystem =
    opts.systemPrompt ??
    'You are an autonomous SAEP agent. The user will ask questions that require ' +
      'on-chain SAEP state. You MUST call the available tools (fetch_agent, fetch_task, ' +
      'fetch_treasury) to get the answer — do not guess values. After tool results return, ' +
      'produce the final plain-text answer using the result content.';

  const grounding = opts.groundingContext ? `\n\n# Grounding\n${opts.groundingContext}` : '';
  const history: Array<{ role: string; content: string }> = [
    { role: 'system', content: `${baseSystem}${grounding}` },
    { role: 'user', content: opts.taskPrompt },
  ];

  const collected: ToolCompletionResult['toolCalls'] = [];
  let finalOutput = '';
  let rounds = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    rounds = round + 1;
    const result = completion({
      modelId: opts.modelId,
      history,
      stream: true,
      tools: toolDefsForCompletion(),
    } as Parameters<typeof completion>[0]);

    let assistantText = '';
    const tokensTask = (async () => {
      for await (const token of result.tokenStream) {
        assistantText += token;
        process.stderr.write(token);
      }
    })();
    const toolEvents: Array<{ name: string; arguments: unknown; id?: string }> = [];
    const toolsTask = (async () => {
      for await (const evt of result.toolCallStream) {
        if (evt.type === 'toolCall') {
          toolEvents.push({ name: evt.call.name, arguments: evt.call.arguments, id: evt.call.id });
        }
      }
    })();
    await Promise.all([tokensTask, toolsTask]);
    process.stderr.write('\n');
    history.push({ role: 'assistant', content: assistantText });

    if (toolEvents.length === 0) {
      finalOutput = assistantText.trim();
      break;
    }

    for (const call of toolEvents) {
      const handler = opts.handlers[call.name as SaepToolName];
      if (!handler) {
        const err = `unknown tool: ${call.name}`;
        collected.push({ name: call.name, arguments: call.arguments, error: err });
        history.push({ role: 'tool', content: JSON.stringify({ ok: false, error: err }) });
        continue;
      }
      try {
        const r = await handler(call.arguments);
        collected.push({ name: call.name, arguments: call.arguments, result: r });
        history.push({ role: 'tool', content: JSON.stringify(r) });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        collected.push({ name: call.name, arguments: call.arguments, error: message });
        history.push({ role: 'tool', content: JSON.stringify({ ok: false, error: message }) });
      }
    }
  }

  if (!finalOutput) finalOutput = '[no final answer — max rounds reached]';

  return { finalOutput, toolCalls: collected, rounds };
}
