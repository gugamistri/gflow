/**
 * Ajudantes de acessibilidade do player e do editor (WCAG 2.1 AA).
 * why: texto alternativo das capturas e contraste do texto em cor de destaque.
 */

export const STEP_ALT_MAX = 300;

/** Texto alternativo da captura do passo: decorativa → "", senão alt do autor, senão título/texto do balão. */
export function stepImageAlt(step) {
  if (!step || step.altDecorative === true) return "";
  const own = String(step.alt || "").trim();
  if (own) return own.slice(0, STEP_ALT_MAX);
  const title = String(step.popover?.title || step.label || "").trim();
  const desc = String(step.popover?.description || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [title, desc].filter(Boolean).join(": ").slice(0, STEP_ALT_MAX);
}

function parseHex(hex) {
  let h = String(hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function toHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG entre duas cores #hex (null se inválidas). */
export function contrastRatio(a, b) {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return null;
  const l1 = luminance(x);
  const l2 = luminance(y);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Escurece (fundo claro) ou clareia (fundo escuro) `fg` até atingir `min` sobre `bg`.
 * why: o kicker usa a cor de destaque do tema; #2a9d8f sobre branco dava 3,3:1.
 */
export function ensureContrast(fg, bg, min = 4.5) {
  const f = parseHex(fg);
  const b = parseHex(bg);
  if (!f || !b) return fg;
  if (contrastRatio(fg, bg) >= min) return toHex(f);
  const target = luminance(b) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mixed = f.map((v, i) => v + (target[i] - v) * t);
    const hex = toHex(mixed);
    if (contrastRatio(hex, bg) >= min) return hex;
  }
  return toHex(target);
}

/** Pares de cor do tema que ficam abaixo do mínimo WCAG (texto 4,5:1). */
export function themeContrastIssues(theme, buttonText = "#ffffff") {
  if (!theme) return [];
  const pairs = [
    ["title", theme.title, theme.popoverBg],
    ["text", theme.text, theme.popoverBg],
    ["accent", theme.accent, theme.popoverBg],
    ["button", buttonText, theme.button],
  ];
  const out = [];
  for (const [key, fg, bg] of pairs) {
    const ratio = contrastRatio(fg, bg);
    if (ratio != null && ratio < 4.5) out.push({ key, ratio: Math.round(ratio * 100) / 100 });
  }
  return out;
}
