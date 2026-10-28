/** Presets de qualidade do vídeo exportado. Padrão para todos; os demais exigem GuiaFlow Pro. */
export const VIDEO_QUALITIES = {
  standard: { id: "standard", width: 1920, height: 1080, bitrate: 8_000_000, pro: false },
  high: { id: "high", width: 1920, height: 1080, bitrate: 12_000_000, pro: true },
  qhd: { id: "qhd", width: 2560, height: 1440, bitrate: 20_000_000, pro: true },
  uhd: { id: "uhd", width: 3840, height: 2160, bitrate: 40_000_000, pro: true },
};

export const VIDEO_FPS = [30, 60];

/** Layout do quadro é desenhado em 1920×1080 lógicos e escalado (vetorial) para a resolução alvo. */
export const LOGICAL_WIDTH = 1920;
export const LOGICAL_HEIGHT = 1080;

/** Resolve o pedido do usuário respeitando o plano: sem Pro cai no padrão 1080p30. */
export function resolveVideoQuality({ quality = "standard", fps = 30, pro = false } = {}) {
  let preset = VIDEO_QUALITIES[quality] || VIDEO_QUALITIES.standard;
  if (preset.pro && !pro) preset = VIDEO_QUALITIES.standard;
  let rate = VIDEO_FPS.includes(Number(fps)) ? Number(fps) : 30;
  if (rate !== 30 && !pro) rate = 30;
  // why: 60 fps precisa de ~1,5× bitrate para manter a nitidez (recomendação do YouTube)
  const bitrate = rate === 60 ? Math.round(preset.bitrate * 1.5) : preset.bitrate;
  return { ...preset, fps: rate, bitrate };
}

/**
 * O que o handler de export passa a `exportVideo`.
 * O plano entra só aqui, via `resolveVideoQuality`: sem Pro, ou com valor inválido, cai em standard/30.
 */
export function exportVideoOptions({ quality, fps, pro = false } = {}) {
  const resolved = resolveVideoQuality({ quality, fps, pro });
  return { quality: resolved.id, fps: resolved.fps, pro: Boolean(pro) };
}

/** Codecs H.264 candidatos com nível suficiente para resolução × fps (High primeiro). */
export function avcCodecCandidates(width, height, fps = 30) {
  const px = width * height;
  const hi = fps > 30;
  let level;
  if (px <= 1920 * 1088) level = hi ? "2a" : "28"; // 4.2 / 4.0
  else if (px <= 2560 * 1440) level = hi ? "33" : "32"; // 5.1 / 5.0
  else level = hi ? "34" : "33"; // 5.2 / 5.1
  return [`avc1.6400${level}`, `avc1.4d00${level}`, `avc1.4200${level}`];
}
