/**
 * Time-stretch sem mudar o pitch (WSOLA).
 * why: AudioBufferSourceNode.playbackRate acelera e afina junto (voz de esquilo).
 * O preview usa HTMLAudioElement, cujo playbackRate preserva o tom por padrão.
 */

function evenCount(value, min, max) {
  let n = Math.round(value);
  if (n % 2) n += 1;
  if (n < min) n = min;
  if (n > max) n = max - (max % 2);
  if (n % 2) n -= 1;
  return Math.max(2, n);
}

function fitLength(channel, srcLen, outLen) {
  const out = new Float32Array(outLen);
  out.set(channel.subarray(0, Math.min(srcLen, outLen)));
  return out;
}

function mixdown(channels, srcLen) {
  if (channels.length === 1) return channels[0];
  const mix = new Float32Array(srcLen);
  const scale = 1 / channels.length;
  for (let c = 0; c < channels.length; c += 1) {
    const channel = channels[c];
    for (let i = 0; i < srcLen; i += 1) mix[i] += channel[i] * scale;
  }
  return mix;
}

function correlation(mix, templatePos, candPos, len) {
  let dot = 0;
  let energy = 0;
  for (let i = 0; i < len; i += 1) {
    const sample = mix[candPos + i];
    dot += mix[templatePos + i] * sample;
    energy += sample * sample;
  }
  if (energy < 1e-8) return 0;
  return dot / Math.sqrt(energy);
}

function templateEnergy(mix, templatePos, len) {
  let energy = 0;
  for (let i = 0; i < len; i += 1) {
    const sample = mix[templatePos + i];
    energy += sample * sample;
  }
  return energy;
}

/**
 * Escolhe o grão mais parecido com a cauda do anterior, perto da posição ideal.
 * Empate fica na posição ideal para não adiantar o clipe em silêncio.
 */
function seekGrain(mix, templatePos, ideal, overlap, search, maxPos) {
  const idealPos = Math.max(0, Math.min(maxPos, Math.round(ideal)));
  if (templatePos < 0 || templatePos + overlap > mix.length) return idealPos;
  if (templateEnergy(mix, templatePos, overlap) < 1e-8) return idealPos;

  let from = idealPos - search;
  let to = idealPos + search;
  if (from < 0) from = 0;
  if (to > maxPos) to = maxPos;
  if (to < from) return idealPos;

  const stride = 4;
  let bestPos = idealPos;
  let bestScore = correlation(mix, templatePos, idealPos, overlap);
  for (let pos = from; pos <= to; pos += stride) {
    const score = correlation(mix, templatePos, pos, overlap);
    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }
  const refineFrom = Math.max(from, bestPos - stride);
  const refineTo = Math.min(to, bestPos + stride);
  for (let pos = refineFrom; pos <= refineTo; pos += 1) {
    const score = correlation(mix, templatePos, pos, overlap);
    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }
  return bestPos;
}

function hann(win) {
  const window = new Float32Array(win);
  for (let i = 0; i < win; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / win));
  }
  return window;
}

function overlapAdd(channel, positions, outLen, win, hop, window) {
  const out = new Float32Array(outLen);
  const weight = new Float32Array(outLen);
  const srcLen = channel.length;
  for (let grain = 0; grain < positions.length; grain += 1) {
    const pos = positions[grain];
    const syn = grain * hop;
    const count = Math.min(win, outLen - syn, srcLen - pos);
    if (count <= 0) continue;
    for (let i = 0; i < count; i += 1) {
      const w = window[i];
      out[syn + i] += channel[pos + i] * w;
      weight[syn + i] += w;
    }
  }
  for (let i = 0; i < outLen; i += 1) {
    if (weight[i] > 1e-6) out[i] /= weight[i];
  }
  return out;
}

/**
 * Encurta (tempo > 1) ou alonga (tempo < 1) cada canal sem resample.
 * @param {ArrayLike<number>[]} channels
 * @param {number} tempo 1.25 deixa o clipe 1,25× mais curto, no mesmo tom
 * @param {number} [sampleRate]
 * @returns {Float32Array[]}
 */
export function timeStretchChannels(channels, tempo, sampleRate = 48000) {
  if (!Array.isArray(channels) || !channels.length) return [];
  const srcLen = channels[0]?.length || 0;
  const copies = () => channels.map((channel) => Float32Array.from(channel.subarray(0, srcLen)));
  if (!srcLen) return channels.map(() => new Float32Array(0));
  const rate = Number(tempo);
  if (!Number.isFinite(rate) || rate <= 0 || Math.abs(rate - 1) < 1e-4) return copies();

  const outLen = Math.max(1, Math.round(srcLen / rate));
  if (srcLen < 128) return channels.map((channel) => fitLength(channel, srcLen, outLen));

  const rateHz = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const win = evenCount(rateHz * 0.03, 32, srcLen);
  const hop = Math.max(1, Math.floor(win / 2));
  const search = Math.min(hop, Math.max(1, Math.round(rateHz * 0.015)));
  const maxPos = Math.max(0, srcLen - win);
  const grains = Math.max(1, Math.ceil(outLen / hop));
  const mix = mixdown(channels, srcLen);
  const positions = new Int32Array(grains);
  positions[0] = 0;
  const analysisHop = hop * rate;
  for (let grain = 1; grain < grains; grain += 1) {
    const ideal = grain * analysisHop;
    const templatePos = positions[grain - 1] + hop;
    positions[grain] = seekGrain(mix, templatePos, ideal, hop, search, maxPos);
  }

  const window = hann(win);
  return channels.map((channel) => overlapAdd(channel, positions, outLen, win, hop, window));
}
