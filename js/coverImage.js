/**
 * Capa do link permanente (og:image): JPEG 1200×630 gerado no navegador.
 * why: o Cloud só guarda e serve; WhatsApp, LinkedIn e Slack mostram esta imagem no preview.
 */
import { resolveImageSrc } from "./store.js";
import { embedRatio } from "./embedSnippet.js";

export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 630;
export const COVER_MAX_BYTES = 300 * 1024;
export const COVER_STRIP_HEIGHT = 132;
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
const BRAND = "#1A4D6D";

function isCapture(step) {
  return Boolean(step && step.type !== "slide" && typeof step.image === "string" && step.image);
}

/**
 * Qual passo vira capa: o escolhido (coverStepId) ou o 1º.
 * Retorna { index, mode: "image" | "slide" | "title" }.
 * - captura → "image"; slide escolhido → "slide" (cartão do slide);
 * - padrão em slide → próxima captura; sem capturas → "title".
 */
export function pickCoverStep(steps, coverStepId = "") {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) return { index: -1, mode: "title" };
  const chosen = coverStepId ? list.findIndex((step) => step?.id === coverStepId) : -1;
  if (chosen >= 0) return { index: chosen, mode: isCapture(list[chosen]) ? "image" : "slide" };
  const first = list.findIndex(isCapture);
  if (first >= 0) return { index: first, mode: "image" };
  return { index: 0, mode: list[0]?.type === "slide" ? "slide" : "title" };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Recorte da imagem (sx, sy, sw, sh) para preencher a área acima da faixa sem distorcer.
 * focus (0..1) é o centro do destaque do passo; sem ele, centraliza na horizontal e fica no topo.
 */
export function coverLayout(imgW, imgH, { width = COVER_WIDTH, height = COVER_HEIGHT, strip = COVER_STRIP_HEIGHT, focus = null } = {}) {
  const areaW = width;
  const areaH = Math.max(1, height - strip);
  if (!(imgW > 0) || !(imgH > 0)) return null;
  const scale = Math.max(areaW / imgW, areaH / imgH);
  const sw = Math.min(imgW, areaW / scale);
  const sh = Math.min(imgH, areaH / scale);
  const fx = Number.isFinite(focus?.x) ? clamp(focus.x, 0, 1) : 0.5;
  const fy = Number.isFinite(focus?.y) ? clamp(focus.y, 0, 1) : null;
  const sx = clamp(fx * imgW - sw / 2, 0, imgW - sw);
  const sy = fy == null ? 0 : clamp(fy * imgH - sh / 2, 0, imgH - sh);
  return {
    sx: Math.round(sx),
    sy: Math.round(sy),
    sw: Math.round(sw),
    sh: Math.round(sh),
    dx: 0,
    dy: 0,
    dw: areaW,
    dh: areaH,
  };
}

/** Centro do destaque em 0..1 (hotspot em %). */
export function stepFocus(step) {
  const hs = step?.hotspot;
  if (!hs || !Number.isFinite(hs.x) || !Number.isFinite(hs.y)) return null;
  const w = Number.isFinite(hs.w) ? hs.w : 0;
  const h = Number.isFinite(hs.h) ? hs.h : 0;
  return { x: (hs.x + w / 2) / 100, y: (hs.y + h / 2) / 100 };
}

/** Corta o texto com "…" para caber em maxWidth. */
export function fitText(measure, text, maxWidth) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || measure(value) <= maxWidth) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${value.slice(0, mid).trimEnd()}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${value.slice(0, lo).trimEnd()}…`;
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fitText((s) => ctx.measureText(s).width, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxWidth);
  return kept;
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawBackdrop(ctx, theme, width, height) {
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, theme?.overlay || "#0F3248");
  g.addColorStop(1, theme?.accent || "#2A9D8F");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

function drawStrip(ctx, { name, badge, width, height, strip, accent }) {
  const top = height - strip;
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, top, width, strip);
  ctx.fillStyle = accent || "#2A9D8F";
  ctx.fillRect(0, top, width, 6);
  const pad = 48;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 46px ${FONT}`;
  const title = fitText((s) => ctx.measureText(s).width, name, width - pad * 2);
  ctx.fillText(title, pad, top + 66);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(badge, pad, top + 108);
}

function drawSlideCard(ctx, step, fallbackTitle, { width, height, strip }) {
  const area = height - strip;
  const title = String(step?.popover?.title || fallbackTitle || "").trim();
  const desc = String(step?.popover?.description || "").replace(/<[^>]*>/g, " ").trim();
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.font = `700 60px ${FONT}`;
  const titleLines = wrapLines(ctx, title, width - 200, 2);
  ctx.font = `400 30px ${FONT}`;
  const descLines = desc ? wrapLines(ctx, desc, width - 240, 2) : [];
  const total = titleLines.length * 72 + (descLines.length ? 24 + descLines.length * 42 : 0);
  let y = Math.max(60, (area - total) / 2) + 56;
  ctx.font = `700 60px ${FONT}`;
  for (const line of titleLines) {
    ctx.fillText(line, width / 2, y);
    y += 72;
  }
  if (descLines.length) {
    y += 24 - 30;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `400 30px ${FONT}`;
    for (const line of descLines) {
      ctx.fillText(line, width / 2, y);
      y += 42;
    }
  }
  ctx.textAlign = "left";
}

function canvasToJpeg(canvas, maxBytes) {
  let quality = 0.86;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  // base64 → bytes ≈ 3/4
  while (dataUrl.length * 0.75 > maxBytes && quality > 0.4) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  if (dataUrl.length * 0.75 > maxBytes) return "";
  return dataUrl;
}

/** Proporção da 1ª captura ("16/10"…), usada pelo oEmbed e pelo link rel=iframely. */
export async function tourRatio(project) {
  const step = (project?.steps || []).find(isCapture);
  if (!step || typeof document === "undefined") return embedRatio(0, 0);
  const img = await loadImage(resolveImageSrc(project, step.image));
  return embedRatio(img?.naturalWidth || 0, img?.naturalHeight || 0);
}

/**
 * Gera a capa. Retorna { dataUrl, width, height, stepIndex } ou null se o canvas falhar.
 */
export async function renderCover(project, { badge = "Tour interativo · GuiaFlow", width = COVER_WIDTH, height = COVER_HEIGHT } = {}) {
  if (typeof document === "undefined") return null;
  const steps = project?.steps || [];
  const pick = pickCoverStep(steps, project?.coverStepId || "");
  const strip = COVER_STRIP_HEIGHT;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (document.fonts?.load) {
    try {
      await Promise.all([document.fonts.load(`700 46px ${FONT}`), document.fonts.load(`500 26px ${FONT}`)]);
    } catch {
      /* fonte do sistema serve */
    }
  }
  const theme = project?.theme || {};
  drawBackdrop(ctx, theme, width, height);
  const step = steps[pick.index];
  let drawn = false;
  if (pick.mode === "image") {
    const img = await loadImage(resolveImageSrc(project, step.image));
    const box = img && coverLayout(img.naturalWidth, img.naturalHeight, { width, height, strip, focus: stepFocus(step) });
    if (box) {
      ctx.drawImage(img, box.sx, box.sy, box.sw, box.sh, box.dx, box.dy, box.dw, box.dh);
      drawn = true;
    }
  }
  if (!drawn) drawSlideCard(ctx, pick.mode === "slide" ? step : null, project?.name || "", { width, height, strip });
  drawStrip(ctx, { name: project?.name || "GuiaFlow", badge, width, height, strip, accent: theme.accent });
  let dataUrl = "";
  try {
    dataUrl = canvasToJpeg(canvas, COVER_MAX_BYTES);
  } catch {
    return null; // canvas "tainted"
  }
  if (!dataUrl) return null;
  return { dataUrl, width, height, stepIndex: pick.index };
}
