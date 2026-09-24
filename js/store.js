/**
 * Tema, imagens e import/export JSON
 */

import { darkenHex } from "./themes.js";

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

export function themeOverlayColor(alpha = 0.55) {
  const overlay =
    getComputedStyle(document.documentElement).getPropertyValue("--demo-overlay").trim() ||
    getComputedStyle(document.documentElement).getPropertyValue("--ns-overlay").trim() ||
    "#000000";
  return hexToRgba(overlay, alpha);
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

export function ensureClickPoint(step) {
  if (step?.clickPoint && Number.isFinite(step.clickPoint.x) && Number.isFinite(step.clickPoint.y)) {
    return step.clickPoint;
  }
  return clickPointFromHotspot(step?.hotspot);
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
  "demo/como-usar/04-player.png",
  "demo/como-usar/05-captura.png",
  "demo/como-usar/06-exportar.png",
];
