import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { URL } from 'node:url';
import { OpenAI } from 'openai';

import { LlmOpenAI } from '../module/LlmOpenAI';
import { TtsTypeCast } from '../tts/TtsTypeCast';
import { TtsCoqui } from '../tts/TtsCoqui';
import { VTubeBridge } from '../module/VTubeBridge';
import { ObsVision } from '../module/ObsVision';
import { TikTokVision } from '../module/TikTokVision';
import { TwitchVision, type NormalizedMessage } from '../module/TwitchVision';
import { YTVision } from '../module/YTVision';

interface StreamTarget {
  name: string;
  rtmpUrl: string;
  streamKey: string;
  enabled: boolean;
}

interface StartMultistreamBody {
  inputUrl?: string;
  sobuPngUrl?: string;
  targets?: StreamTarget[];
}

const port = Number(process.env['WEB_PORT'] ?? 3000);
const webRoot = path.join(process.cwd(), 'web');

const whisperClient = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
const eveBrain = new LlmOpenAI();
const eveVoice = new TtsTypeCast();
const eveVoiceBackup = new TtsCoqui();
const eveBody = new VTubeBridge();
const eveEyes = new ObsVision();
const twitch = new TwitchVision();
const youtube = new YTVision();
const tiktok = new TikTokVision();

let isEveSpeaking = false;
const chatQueue: NormalizedMessage[] = [];
let multiStreamProcess: ChildProcessWithoutNullStreams | null = null;

const sendJson = (res: ServerResponse, statusCode: number, body: object): void => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readJsonBody = async <T>(req: IncomingMessage): Promise<T | null> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as T;
};

const serveStaticFile = async (res: ServerResponse, filePath: string): Promise<void> => {
  try {
    const fullPath = path.join(webRoot, filePath);
    const normalized = path.normalize(fullPath);

    if (!normalized.startsWith(webRoot)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }

    const ext = path.extname(normalized);
    const contentType =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.js'
          ? 'application/javascript; charset=utf-8'
          : ext === '.css'
            ? 'text/css; charset=utf-8'
            : 'application/octet-stream';

    await fs.access(normalized);
    res.writeHead(200, { 'Content-Type': contentType });
    createReadStream(normalized).pipe(res);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
};

const processInteraction = async (prompt: string, source: string): Promise<string> => {
  if (isEveSpeaking) {
    return 'エーヴェ様 is already speaking. Please wait a moment.';
  }

  isEveSpeaking = true;

  try {
    console.log(`🧠 [Brain]: Processing prompt from ${source}`);
    const base64Image = await eveEyes.captureScreen();
    const response = await eveBrain.generate(prompt, base64Image);

    if (!response.success || !response.value) {
      return '...I lost the signal for a moment. Please ask me again.';
    }

    let spokenText = response.value;
    const expressionMatch = spokenText.match(/\[エーヴェ様:([^\]]+)\]/);

    if (expressionMatch) {
      const expressionFile = `${expressionMatch[1]}.exp3.json`;
      spokenText = spokenText.replace(expressionMatch[0], '').trim().replace(/^"|"$/g, '').trim();

      await eveBody.triggerExpression(expressionFile);
      setTimeout(async () => {
        await eveBody.clearExpression(expressionFile);
      }, 5000);
    }

    try {
      await eveVoice.generate(spokenText);
    } catch (error) {
      console.warn('☁️ [System]: Cloud voice failed, switching to local backup.', error);
      await eveVoiceBackup.generate(spokenText);
    }

    return spokenText;
  } catch (error) {
    console.error('Aetherial loop error', error);
    return 'Aetherial systems stumbled during processing.';
  } finally {
    isEveSpeaking = false;
  }
};

const queueTick = setInterval(async () => {
  if (isEveSpeaking || chatQueue.length === 0) {
    return;
  }

  const nextMessage = chatQueue.shift();
  if (!nextMessage) {
    return;
  }

  const streamPrompt = `[From ${nextMessage.platform} user '${nextMessage.author}']: ${nextMessage.content}`;
  await processInteraction(streamPrompt, nextMessage.platform);
}, 1000);

const handleChat = (msg: NormalizedMessage): void => {
  chatQueue.push(msg);
};

twitch.onMessageReceived = handleChat;
youtube.onMessageReceived = handleChat;
tiktok.onMessageReceived = handleChat;

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  try {
    if (method === 'GET' && parsedUrl.pathname === '/api/status') {
      sendJson(res, 200, {
        multistreamActive: multiStreamProcess !== null,
        queueDepth: chatQueue.length,
        isEveSpeaking,
      });
      return;
    }

    if (method === 'POST' && parsedUrl.pathname === '/api/message') {
      const body = await readJsonBody<{ prompt?: string; image?: string }>(req);
      const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
      const image = typeof body?.image === 'string' ? body.image : undefined;

      if (!prompt && !image) {
        sendJson(res, 400, { error: 'Prompt or image is required.' });
        return;
      }

      const messagePrompt = image ? `${prompt}\n[User attached an image for visual context.]` : prompt;
      const responseText = await processInteraction(messagePrompt, 'Web UI');
      sendJson(res, 200, { responseText });
      return;
    }

    if (method === 'POST' && parsedUrl.pathname === '/api/transcribe') {
      const body = await readJsonBody<{ audioBase64?: string; mimeType?: string }>(req);
      const audioBase64 = typeof body?.audioBase64 === 'string' ? body.audioBase64 : '';
      const mimeType = typeof body?.mimeType === 'string' ? body.mimeType : 'audio/webm';

      if (!audioBase64) {
        sendJson(res, 400, { error: 'audioBase64 is required.' });
        return;
      }

      const payloadPart = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
      const payload = payloadPart ?? '';
      const extension = mimeType.includes('wav') ? 'wav' : 'webm';
      const filePath = path.join(tmpdir(), `${randomUUID()}.${extension}`);

      try {
        await fs.writeFile(filePath, Buffer.from(payload, 'base64'));

        const transcription = await whisperClient.audio.transcriptions.create({
          model: 'gpt-4o-mini-transcribe',
          file: createReadStream(filePath),
          response_format: 'text',
        });

        sendJson(res, 200, { text: String(transcription).trim() });
      } finally {
        await fs.rm(filePath, { force: true });
      }

      return;
    }

    if (method === 'POST' && parsedUrl.pathname === '/api/multistream/start') {
      if (multiStreamProcess) {
        sendJson(res, 409, { error: 'Multistream is already running.' });
        return;
      }

      const body = await readJsonBody<StartMultistreamBody>(req);
      const inputUrl = typeof body?.inputUrl === 'string' ? body.inputUrl : '';
      const sobuPngUrl = typeof body?.sobuPngUrl === 'string' ? body.sobuPngUrl : '';
      const validTargets = (body?.targets ?? []).filter((target) => target.enabled && target.rtmpUrl && target.streamKey);

      if (!inputUrl || validTargets.length === 0) {
        sendJson(res, 400, { error: 'inputUrl and at least one enabled target are required.' });
        return;
      }

      const outputs = validTargets
        .map((target) => `[f=flv]${target.rtmpUrl.replace(/\/$/, '')}/${target.streamKey}`)
        .join('|');

      const ffmpegArgs: string[] = ['-re', '-i', inputUrl];

      if (sobuPngUrl) {
        ffmpegArgs.push('-stream_loop', '-1', '-i', sobuPngUrl, '-filter_complex', 'overlay=W-w-30:H-h-30');
      }

      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-maxrate', '6000k',
        '-bufsize', '12000k',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-f', 'tee',
        outputs,
      );

      multiStreamProcess = spawn('ffmpeg', ffmpegArgs, { stdio: 'pipe' });
      multiStreamProcess.stdout.on('data', (data) => console.log(`[ffmpeg] ${String(data)}`));
      multiStreamProcess.stderr.on('data', (data) => console.log(`[ffmpeg] ${String(data)}`));
      multiStreamProcess.on('close', () => {
        multiStreamProcess = null;
      });

      sendJson(res, 200, { success: true });
      return;
    }

    if (method === 'POST' && parsedUrl.pathname === '/api/multistream/stop') {
      if (!multiStreamProcess) {
        sendJson(res, 409, { error: 'No active multistream process.' });
        return;
      }

      multiStreamProcess.kill('SIGTERM');
      multiStreamProcess = null;
      sendJson(res, 200, { success: true });
      return;
    }

    if (method === 'GET') {
      if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
        await serveStaticFile(res, 'index.html');
      } else {
        await serveStaticFile(res, parsedUrl.pathname.slice(1));
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

const boot = async (): Promise<void> => {
  await eveBrain.init();
  await eveVoice.init();
  await eveVoiceBackup.init();
  await eveBody.init();
  await eveEyes.init();

  await twitch.init();
  await youtube.init();
  await tiktok.init();

  server.listen(port, () => {
    console.log(`🌐 Aetherial Eve web console live on http://localhost:${port}`);
  });
};

void boot();

process.on('SIGINT', async () => {
  clearInterval(queueTick);
  await twitch.free();
  await youtube.free();
  await tiktok.free();
  await eveBrain.free();
  await eveVoice.free();
  await eveVoiceBackup.free();
  await eveBody.free();
  await eveEyes.free();
  process.exit(0);
});
