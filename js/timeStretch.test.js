import assert from "node:assert/strict";
import test from "node:test";
import { CAPTION_PLAYBACK_RATES } from "./playback.js";
import { timeStretchChannels } from "./timeStretch.js";

const SAMPLE_RATE = 48000;

function tone(freq, seconds, sampleRate = SAMPLE_RATE) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    out[i] =
      Math.sin(2 * Math.PI * freq * t) +
      0.35 * Math.sin(2 * Math.PI * freq * 2 * t) +
      0.15 * Math.sin(2 * Math.PI * freq * 3 * t);
  }
  return out;
}

/** Potência em uma frequência (Goertzel), independente da fase. */
function goertzelPower(samples, freq, sampleRate) {
  const start = Math.floor(samples.length * 0.3);
  const n = Math.min(4096, samples.length - start);
  const omega = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) {
    const s0 = samples[start + i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** Resample linear: é o que playbackRate faz, e por isso afina. */
function resampleLinear(input, tempo) {
  const outLen = Math.max(1, Math.round(input.length / tempo));
  const out = new Float32Array(outLen);
  const last = input.length - 1;
  for (let i = 0; i < outLen; i += 1) {
    const x = Math.min(last, i * tempo);
    const i0 = Math.floor(x);
    const i1 = Math.min(last, i0 + 1);
    const frac = x - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

test("tempo 1 devolve o mesmo áudio", () => {
  const input = tone(180, 0.25);
  const out = timeStretchChannels([input], 1, SAMPLE_RATE);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, input.length);
  assert.deepEqual(out[0], input);
});

test("clipe curtíssimo é cortado sem resample (o tom dos samples fica)", () => {
  const input = new Float32Array(100);
  for (let i = 0; i < input.length; i += 1) input[i] = Math.sin(i / 3);
  const out = timeStretchChannels([input], 2, SAMPLE_RATE);
  assert.equal(out[0].length, 50);
  for (let i = 0; i < 50; i += 1) assert.equal(out[0][i], input[i]);
});

test("silêncio só muda a duração", () => {
  const input = new Float32Array(SAMPLE_RATE);
  const out = timeStretchChannels([input], 1.25, SAMPLE_RATE);
  assert.equal(out[0].length, Math.round(SAMPLE_RATE / 1.25));
  assert.equal(rms(out[0]), 0);
});

test("velocidades do slide mudam a duração e mantêm o tom", () => {
  const freq = 180;
  const input = tone(freq, 1.2);
  for (const tempo of CAPTION_PLAYBACK_RATES) {
    const out = timeStretchChannels([input], tempo, SAMPLE_RATE)[0];
    assert.equal(out.length, Math.round(input.length / tempo), `duração em ${tempo}×`);
    if (tempo === 1) continue;
    const atVoice = goertzelPower(out, freq, SAMPLE_RATE);
    const atChipmunk = goertzelPower(out, freq * tempo, SAMPLE_RATE);
    const atSource = goertzelPower(input, freq, SAMPLE_RATE);
    assert.ok(atVoice > atSource * 0.15, `energia some em ${tempo}×`);
    assert.ok(
      atVoice > atChipmunk * 4,
      `tom subiu em ${tempo}× (voz ${atVoice.toFixed(1)} vs resample ${atChipmunk.toFixed(1)})`
    );
    assert.ok(rms(out) > rms(input) * 0.45, `nível caiu em ${tempo}×`);
  }
});

test("resample linear (playbackRate) sobe o tom; o stretch não", () => {
  const freq = 200;
  const tempo = 1.25;
  const input = tone(freq, 1);
  const shifted = resampleLinear(input, tempo);
  const stretched = timeStretchChannels([input], tempo, SAMPLE_RATE)[0];
  const shiftedRatio =
    goertzelPower(shifted, freq * tempo, SAMPLE_RATE) / goertzelPower(shifted, freq, SAMPLE_RATE);
  const stretchedRatio =
    goertzelPower(stretched, freq, SAMPLE_RATE) / goertzelPower(stretched, freq * tempo, SAMPLE_RATE);
  assert.ok(shiftedRatio > 4, "controle: resample precisa afinar, senão o teste não distingue");
  assert.ok(stretchedRatio > 4);
});

test("estéreo usa o mesmo tempo nos dois canais", () => {
  const left = tone(180, 0.8);
  const right = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 1) right[i] = left[(i + 40) % left.length] * 0.5;
  const [outL, outR] = timeStretchChannels([left, right], 1.5, SAMPLE_RATE);
  assert.equal(outL.length, outR.length);
  assert.equal(outL.length, Math.round(left.length / 1.5));
  assert.ok(goertzelPower(outL, 180, SAMPLE_RATE) > goertzelPower(outL, 270, SAMPLE_RATE) * 4);
  assert.ok(rms(outR) > 0.05);
});
