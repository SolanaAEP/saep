import fs from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

import WebSocket from 'ws';

import {voiceoverConfig} from '../voiceover/saep-speed-proofs.config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const scriptOnly = args.has('--script-only');
const voiceArg = process.argv.find((arg) => arg.startsWith('--voice='));
const voice = voiceArg ? voiceArg.slice('--voice='.length) : voiceoverConfig.voice;

const outputPath = path.join(appDir, voiceoverConfig.outputFile);
const transcriptPath = path.join(appDir, voiceoverConfig.transcriptFile);
const metadataPath = path.join(appDir, voiceoverConfig.metadataFile);
const desktopKeyPath = path.join(homedir(), 'Desktop', 'xai.txt');

const normalizeApiKey = (rawValue) => {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('XAI_API_KEY=')) {
    return trimmed.slice('XAI_API_KEY='.length).trim();
  }

  return trimmed;
};

const resolveApiKey = async () => {
  if (process.env.XAI_API_KEY) {
    return normalizeApiKey(process.env.XAI_API_KEY);
  }

  try {
    const fileValue = await fs.readFile(desktopKeyPath, 'utf8');
    return normalizeApiKey(fileValue);
  } catch {
    return null;
  }
};

const writeWaveFile = async (pcmBuffer) => {
  const sampleRate = voiceoverConfig.sampleRate;
  const channelCount = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channelCount * (bitsPerSample / 8);
  const blockAlign = channelCount * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  await fs.writeFile(outputPath, Buffer.concat([header, pcmBuffer]));
};

const writeScriptArtifacts = async () => {
  await fs.mkdir(path.dirname(outputPath), {recursive: true});

  await fs.writeFile(
    transcriptPath,
    `${voiceoverConfig.scriptText}\n`,
    'utf8',
  );

  await fs.writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        title: voiceoverConfig.title,
        model: voiceoverConfig.model,
        voice,
        sampleRate: voiceoverConfig.sampleRate,
        remotionStaticPath: voiceoverConfig.remotionStaticPath,
        systemPrompt: voiceoverConfig.systemPrompt,
        scriptText: voiceoverConfig.scriptText,
        segments: voiceoverConfig.segments,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};

const renderVoiceover = async () => {
  const apiKey = await resolveApiKey();

  if (!apiKey) {
    throw new Error(
      'XAI_API_KEY is missing. Set it in your shell or place it in ~/Desktop/xai.txt, then rerun `pnpm --filter @saep/video voiceover`.',
    );
  }

  const audioChunks = [];
  const textChunks = [];
  let promptSent = false;
  let finished = false;
  const wsUrl = voiceoverConfig.model
    ? `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(voiceoverConfig.model)}`
    : 'wss://api.x.ai/v1/realtime';

  const socket = new WebSocket(
    wsUrl,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out waiting for xAI voice output.'));
    }, 120_000);

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            instructions: voiceoverConfig.systemPrompt,
            voice,
            turn_detection: null,
            audio: {
              input: {format: {type: 'audio/pcm', rate: voiceoverConfig.sampleRate}},
              output: {format: {type: 'audio/pcm', rate: voiceoverConfig.sampleRate}},
            },
          },
        }),
      );
    });

    socket.on('message', (raw) => {
      let event;

      try {
        event = JSON.parse(raw.toString());
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
        return;
      }

      if (event.type === 'session.updated' && !promptSent) {
        promptSent = true;

        socket.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: voiceoverConfig.scriptText,
                },
              ],
            },
          }),
        );

        socket.send(
          JSON.stringify({
            type: 'response.create',
          }),
        );

        return;
      }

      if (event.type === 'response.output_audio.delta' && event.delta) {
        audioChunks.push(Buffer.from(event.delta, 'base64'));
        return;
      }

      if (event.type === 'response.text.delta' && event.delta) {
        textChunks.push(event.delta);
        return;
      }

      if (event.type === 'error') {
        clearTimeout(timeout);
        reject(
          new Error(event.error?.message ?? 'xAI realtime returned an error event.'),
        );
        return;
      }

      if (event.type === 'response.done') {
        finished = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    socket.on('close', (code, reason) => {
      if (finished) {
        return;
      }

      clearTimeout(timeout);
      reject(
        new Error(
          `xAI realtime socket closed before completion (${code}): ${reason.toString()}`,
        ),
      );
    });
  });

  const pcmBuffer = Buffer.concat(audioChunks);

  if (pcmBuffer.length === 0) {
    throw new Error('xAI completed the request but returned no audio.');
  }

  await writeWaveFile(pcmBuffer);

  const updatedMetadata = {
    title: voiceoverConfig.title,
    model: voiceoverConfig.model,
    voice,
    sampleRate: voiceoverConfig.sampleRate,
    remotionStaticPath: voiceoverConfig.remotionStaticPath,
    systemPrompt: voiceoverConfig.systemPrompt,
    scriptText: voiceoverConfig.scriptText,
    transcriptFromModel: textChunks.join('').trim() || null,
    segments: voiceoverConfig.segments,
  };

  await fs.writeFile(metadataPath, `${JSON.stringify(updatedMetadata, null, 2)}\n`, 'utf8');
};

await writeScriptArtifacts();

if (scriptOnly) {
  console.log(`Script written to ${transcriptPath}`);
  console.log(`Metadata written to ${metadataPath}`);
  process.exit(0);
}

await renderVoiceover();

console.log(`Voice-over written to ${outputPath}`);
console.log(`Transcript written to ${transcriptPath}`);
console.log(`Metadata written to ${metadataPath}`);
