/**
 * Tema, imagens e import/export JSON
 */

import { darkenHex, fixedFormPalette } from "./themes.js";

export function applyTheme(theme) {
  const root = document.documentElement;
  if (!theme) return;
  // why: --demo-* isola o tema do tour do chrome do app (--ns-* via data-appearance)
  root.style.setProperty("--demo-accent", theme.accent);
  root.style.setProperty("--demo-accent-dark", theme.accentDark || theme.accent);
  root.style.setProperty("--demo-overlay", theme.overlay);
  root.style.setProperty("--demo-popover-bg", theme.popoverBg);
  root.style.setProperty("--demo-popover-title", theme.title);
  root.style.setProperty("--demo-popover-text", theme.text);
  root.style.setProperty("--demo-button", theme.button);
  root.style.setProperty("--demo-hotspot", theme.hotspot);
  for (const [name, value] of Object.entries(fixedFormPalette(theme))) root.style.setProperty(name, value);
  const darkDemo =
    theme.presetId === "social" ||
    theme.appearance === "social" ||
    isDarkHex(theme.popoverBg);
  root.style.setProperty(
    "--demo-font-display",
    darkDemo
      ? 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
      : 'Georgia, "Times New Roman", serif'
  );
}

function isDarkHex(hex) {
  const h = String(hex || "").replace("#", "").trim();
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

/** Converte #RRGGBB em rgba() para overlay do driver.js */
export function hexToRgba(hex, alpha = 0.55) {
  const h = String(hex || "").replace("#", "").trim();
  if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Véu fora do destaque. O vídeo exportado pinta `rgba(0,0,0,0.48)`.
 * O preview tem de usar a mesma tinta: cor sólida + este alpha.
 * hazard: rgba em overlayColor *e* overlayOpacity do Driver multiplicam e o véu fica fraco demais.
 * O tema (0.55 na cor do overlay, ou 0.90 no modo escuro) divergia do export e deixava o fundo mais claro.
 */
export const SPOTLIGHT_VEIL_OPACITY = 0.48;

export function spotlightVeilPaint() {
  return { color: "#000000", opacity: SPOTLIGHT_VEIL_OPACITY };
}

export function spotlightVeilFill() {
  return `rgba(0,0,0,${SPOTLIGHT_VEIL_OPACITY})`;
}

export function themeOverlayPaint() {
  return spotlightVeilPaint();
}

/** @deprecated prefer themeOverlayPaint — mantido para callers que só precisam de uma cor */
export function themeOverlayColor(alpha = 0.55) {
  const { color, opacity } = themeOverlayPaint(alpha);
  return hexToRgba(color, opacity);
}

export function themeToForm(theme) {
  const map = {
    accent: "theme-accent",
    overlay: "theme-overlay",
    popoverBg: "theme-popoverBg",
    title: "theme-title",
    text: "theme-text",
    button: "theme-button",
    hotspot: "theme-hotspot",
  };
  for (const [key, id] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el && theme[key]) el.value = normalizeHex(theme[key]);
  }
}

export function formToTheme(current = {}) {
  const accentEl = document.getElementById("theme-accent");
  const accent = accentEl?.value || current.accent;
  return {
    ...current,
    accent,
    accentDark: darkenHex(accent),
    overlay: document.getElementById("theme-overlay")?.value || current.overlay,
    popoverBg: document.getElementById("theme-popoverBg")?.value || current.popoverBg,
    title: document.getElementById("theme-title")?.value || current.title,
    text: document.getElementById("theme-text")?.value || current.text,
    button: document.getElementById("theme-button")?.value || current.button,
    hotspot: document.getElementById("theme-hotspot")?.value || current.hotspot,
  };
}

function normalizeHex(value) {
  if (!value) return "#000000";
  if (value.startsWith("#") && value.length === 7) return value;
  if (value.startsWith("#") && value.length === 4) {
    return (
      "#" +
      value
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  }
  return value;
}

export function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step.clickPoint && step.hotspot) {
      step.clickPoint = clickPointFromHotspot(step.hotspot);
    }
  }
}

export function slugifyFilename(name, fallback = "demo") {
  const slug = String(name || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

export function exportDemo(demo, { filename } = {}) {
  const blob = new Blob([JSON.stringify(demo, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugifyFilename(filename || demo?.name, "demo")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importDemoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.steps)) {
          reject(new Error("JSON inválido: falta steps[]"));
          return;
        }
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function encodeAssetPath(path) {
  if (!path) return "";
  if (
    path.startsWith("data:") ||
    path.startsWith("blob:") ||
    path.startsWith("http://") ||
    path.startsWith("https://")
  ) {
    return path;
  }
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function createStepId() {
  return "step-" + Math.random().toString(36).slice(2, 9);
}

/** Centro do retângulo de destaque — fallback do ponto de clique */
export function clickPointFromHotspot(hotspot) {
  const hs = hotspot || { x: 40, y: 40, w: 14, h: 8 };
  return {
    x: hs.x + hs.w / 2,
    y: hs.y + hs.h / 2,
  };
}

/** Margem (pontos percentuais da imagem) para o marcador não ficar metade fora do destaque */
export const CLICK_INSET = 1;

/** Destaque utilizável: retângulo finito com área positiva */
export function hasHotspot(hotspot) {
  return Boolean(
    hotspot &&
      Number.isFinite(hotspot.x) &&
      Number.isFinite(hotspot.y) &&
      Number.isFinite(hotspot.w) &&
      Number.isFinite(hotspot.h) &&
      hotspot.w > 0 &&
      hotspot.h > 0
  );
}

/**
 * Prende o clique simulado dentro do destaque (com margem).
 * Sem destaque válido, devolve o ponto como veio (posição livre).
 * Nunca muta o ponto recebido.
 */
export function clampClickToHotspot(point, hotspot, { inset = CLICK_INSET } = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return point;
  if (!hasHotspot(hotspot)) return { x: point.x, y: point.y };
  // why: destaque menor que 2× a margem → o centro é o único ponto "dentro"
  const ix = Math.min(Math.max(0, inset), hotspot.w / 2);
  const iy = Math.min(Math.max(0, inset), hotspot.h / 2);
  return {
    x: Math.min(Math.max(point.x, hotspot.x + ix), hotspot.x + hotspot.w - ix),
    y: Math.min(Math.max(point.y, hotspot.y + iy), hotspot.y + hotspot.h - iy),
  };
}

/** Ponto (em % da imagem) cai dentro do destaque, bordas incluídas */
export function pointInHotspot(point, hotspot) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !hasHotspot(hotspot)) return false;
  return (
    point.x >= hotspot.x &&
    point.x <= hotspot.x + hotspot.w &&
    point.y >= hotspot.y &&
    point.y <= hotspot.y + hotspot.h
  );
}

/**
 * Clique simples no canvas: novo ponto do clique simulado, ou null para não mexer.
 * Com destaque, só um clique dentro dele move o clique (fora dele é ignorado,
 * sem "pular" para a borda). Sem destaque, o clique continua livre.
 */
export function clickPointForCanvasClick(point, hotspot) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (!hasHotspot(hotspot)) return { x: point.x, y: point.y };
  if (!pointInHotspot(point, hotspot)) return null;
  return clampClickToHotspot(point, hotspot);
}

/**
 * Novo clique quando o destaque muda: se só moveu (mesmo tamanho), o clique
 * acompanha o deslocamento; se redimensionou, fica onde estava e é preso dentro.
 */
export function followHotspot(point, prevHotspot, nextHotspot) {
  if (!hasHotspot(nextHotspot)) return point;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return clickPointFromHotspot(nextHotspot);
  }
  let p = { x: point.x, y: point.y };
  if (
    hasHotspot(prevHotspot) &&
    Math.abs(prevHotspot.w - nextHotspot.w) < 0.05 &&
    Math.abs(prevHotspot.h - nextHotspot.h) < 0.05
  ) {
    p = { x: p.x + nextHotspot.x - prevHotspot.x, y: p.y + nextHotspot.y - prevHotspot.y };
  }
  return clampClickToHotspot(p, nextHotspot);
}

/**
 * Ponto de clique para exibir: o salvo (ou o centro do destaque), sempre preso
 * dentro do destaque. Não muta o passo — projetos antigos com clique fora só
 * são regravados quando o usuário edita o passo.
 */
export function ensureClickPoint(step) {
  const raw =
    step?.clickPoint && Number.isFinite(step.clickPoint.x) && Number.isFinite(step.clickPoint.y)
      ? step.clickPoint
      : clickPointFromHotspot(step?.hotspot);
  return clampClickToHotspot(raw, step?.hotspot);
}

/** Capturas novas (extensão): grava o clique já preso ao destaque. Muta os passos. */
export function clampStepClickPoints(steps) {
  if (!Array.isArray(steps)) return steps;
  for (const step of steps) {
    if (!step?.clickPoint || !hasHotspot(step.hotspot)) continue;
    const p = clampClickToHotspot(step.clickPoint, step.hotspot);
    if (p) step.clickPoint = p;
  }
  return steps;
}

/** Resolve image src: catalog path, custom:id, or data/blob URL */
export function resolveImageSrc(demo, imageRef) {
  if (!imageRef) return "";
  if (imageRef.startsWith("custom:")) {
    const id = imageRef.slice(7);
    return demo?.customImages?.[id]?.dataUrl || "";
  }
  return encodeAssetPath(imageRef);
}

/** Evita o ícone de imagem quebrada: esconde até carregar, some se 404. */
export function bindImage(img, src, onReady) {
  if (!img) return;
  const ok = () => {
    img.hidden = false;
    img.classList.remove("is-broken");
    onReady?.(true);
  };
  const fail = () => {
    img.removeAttribute("src");
    img.hidden = true;
    img.classList.add("is-broken");
    onReady?.(false);
  };
  img.onload = ok;
  img.onerror = fail;
  if (!src) {
    fail();
    return;
  }
  if (img.getAttribute("src") === src && img.complete) {
    if (img.naturalWidth > 0) ok();
    else fail();
    return;
  }
  img.hidden = true;
  img.src = src;
}

export function shortImageLabel(imageRef, demo) {
  if (!imageRef) return "Sem imagem";
  if (imageRef.startsWith("custom:")) {
    const id = imageRef.slice(7);
    return demo?.customImages?.[id]?.name || "Imagem enviada";
  }
  const parts = imageRef.split("/");
  return parts[parts.length - 1] || imageRef;
}

export function ensureCustomImages(demo) {
  if (!demo.customImages) demo.customImages = {};
  return demo;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const IMAGE_CATALOG = [
  "demo/como-usar/01-biblioteca.png",
  "demo/como-usar/02-editor.png",
  "demo/como-usar/03-destaque.png",
];
