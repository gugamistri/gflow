/**
 * Narração leve: MP3 mono 48 kbps a 24 kHz (voz), trilha de fundo MP3 96 kbps.
 * why: a narração vinha em MP3 128 kbps 44,1 kHz — metade do tour de exemplo era áudio.
 *      MP3 toca em todo lugar (iOS Safari, export HTML, export de vídeo via decodeAudioData);
 *      Opus/WebM ainda falha em iOS antigos, então não arriscamos.
 * Decodifica com OfflineAudioContext (já reamostrando) e codifica no worker (LAME).
 */

import { bytesToDataUrl, dataUrlByteLength, dataUrlMime, dataUrlToBytes } from "./mediaBytes.js";
import { runMediaWorker } from "./imageOptimize.js";

export const VOICE_PROFILE = Object.freeze({ kbps: 48, sampleRate: 24000, channels: 1 });
export const MUSIC_PROFILE = Object.freeze({ kbps: 96, sampleRate: 44100, channels: 2 });
/** MP3/AAC já comprimido: só troca com pelo menos 15% de ganho. */
export const AUDIO_REENCODE_MIN_GAIN = 0.15;
const AUDIO_MIN_BYTES = 16 * 1024;

const MP3_BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

/** kbps do primeiro quadro MP3 (pula a tag ID3v2). 0 quando não reconhece. */
export function mp3Bitrate(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let i = 0;
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    i = 10 + size + (b[5] & 0x10 ? 10 : 0);
  }
  const end = Math.min(b.length - 4, i + 64 * 1024);
  for (; i < end; i += 1) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const versionBits = (b[i + 1] >> 3) & 0x03;
    const layerBits = (b[i + 1] >> 1) & 0x03;
    const index = (b[i + 2] >> 4) & 0x0f;
    if (versionBits === 1 || layerBits !== 1 || index === 0 || index === 15) continue;
    const table = versionBits === 3 ? MP3_BITRATES[1] : MP3_BITRATES[2];
    return table[index] || 0;
  }
  return 0;
}

/** Troca o original? MP3/AAC só com ganho real; formatos sem suporte no iOS (ogg/webm/wav) trocam se não crescer muito. */
export function acceptAudio({ beforeBytes, afterBytes, sourceMime }) {
  if (!(afterBytes > 0) || !(beforeBytes > 0)) return false;
  if (/^audio\/(mpeg|mp3|aac|mp4|x-m4a|m4a)$/i.test(sourceMime)) {
    return afterBytes <= beforeBytes * (1 - AUDIO_REENCODE_MIN_GAIN);
  }
  return afterBytes <= beforeBytes * 1.25;
}

/** Vale decodificar? Evita trabalho com MP3 que já está leve. */
export function audioNeedsWork(dataUrl, profile = VOICE_PROFILE) {
  if (typeof dataUrl !== "string" || !/^data:audio\//i.test(dataUrl) || !/;base64,/i.test(dataUrl.slice(0, 80))) return false;
  if (dataUrlByteLength(dataUrl) < AUDIO_MIN_BYTES) return false;
  const mime = dataUrlMime(dataUrl);
  if (/^audio\/(mpeg|mp3)$/i.test(mime)) {
    const head = dataUrl.slice(dataUrl.indexOf(",") + 1, dataUrl.indexOf(",") + 1 + 96 * 1024);
    let kbps = 0;
    try {
      kbps = mp3Bitrate(dataUrlToBytes(`data:audio/mpeg;base64,${head.slice(0, head.length - (head.length % 4))}`).bytes);
    } catch {
      kbps = 0;
    }
    // why: 64 kbps (TTS novo) já é leve; recodificar só somaria perda
    return !kbps || kbps > profile.kbps + 24;
  }
  return true;
}

function offlineCtor() {
  if (typeof window === "undefined") return null;
  return window.OfflineAudioContext || window.webkitOfflineAudioContext || null;
}

async function decodeAt(bytes, sampleRate, channels) {
  const Ctor = offlineCtor();
  if (!Ctor) throw new Error("no_audio_context");
  const ctx = new Ctor(channels, 1, sampleRate);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && typeof p.then === "function") p.then(resolve, reject);
  });
}

function toInt16(data) {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const s = Math.max(-1, Math.min(1, data[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function pcmChannels(audio, wantChannels) {
  if (wantChannels === 1 || audio.numberOfChannels === 1) {
    if (audio.numberOfChannels === 1) return [toInt16(audio.getChannelData(0))];
    const mixed = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c += 1) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < d.length; i += 1) mixed[i] += d[i] / audio.numberOfChannels;
    }
    return [toInt16(mixed)];
  }
  return [toInt16(audio.getChannelData(0)), toInt16(audio.getChannelData(1))];
}

async function defaultEncode(dataUrl, profile, timeoutMs) {
  const { bytes } = dataUrlToBytes(dataUrl);
  let audio;
  try {
    audio = await decodeAt(bytes, profile.sampleRate, profile.channels);
  } catch (err) {
    // why: Safari antigo só aceita OfflineAudioContext de 44,1 kHz para cima
    if (profile.sampleRate === 44100) throw err;
    audio = await decodeAt(dataUrlToBytes(dataUrl).bytes, 44100, profile.channels);
  }
  const channels = pcmChannels(audio, profile.channels);
  const res = await runMediaWorker(
    { kind: "mp3", channels, sampleRate: audio.sampleRate, kbps: profile.kbps },
    channels.map((c) => c.buffer),
    timeoutMs
  );
  return { dataUrl: bytesToDataUrl(res.bytes, "audio/mpeg"), durationSeconds: audio.duration };
}

/**
 * Otimiza um clipe (data URL). Nunca rejeita: em erro devolve o original com changed=false.
 */
export async function optimizeAudioDataUrl(dataUrl, { profile = VOICE_PROFILE, timeoutMs = 120000, encode = defaultEncode, force = false } = {}) {
  const beforeBytes = dataUrlByteLength(dataUrl);
  const keep = { dataUrl, changed: false, beforeBytes, afterBytes: beforeBytes };
  if (!force && !audioNeedsWork(dataUrl, profile)) return keep;
  let res;
  try {
    res = await encode(dataUrl, profile, timeoutMs);
  } catch {
    return keep;
  }
  if (!res?.dataUrl?.startsWith("data:audio/")) return keep;
  const afterBytes = dataUrlByteLength(res.dataUrl);
  if (!acceptAudio({ beforeBytes, afterBytes, sourceMime: dataUrlMime(dataUrl) })) return keep;
  return { dataUrl: res.dataUrl, changed: true, beforeBytes, afterBytes, durationSeconds: res.durationSeconds };
}
