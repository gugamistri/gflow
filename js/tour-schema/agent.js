/**
 * Entrada da API pública / MCP → passo do editor.
 * why: agentes falam em coordenadas 0..1 (fração da imagem); o editor guarda % (0..100).
 *      Os erros são frases curtas que um LLM consegue corrigir sozinho.
 */

import { CLICK_INSET, clampClickToHotspot, hasHotspot, pointInHotspot } from "./geometry.js";
import { LIMITS as FIXED_LIMITS, isValidWhatsAppNumber, normalizeEndStep, normalizeStartStep } from "./fixedSteps.js";
import { THEME_COLOR_KEYS, THEME_PRESETS, cloneTheme, getPreset } from "./theme.js";
import { THEME_FONT_IDS, isThemeFontId } from "./fonts.js";
import { applyVideoToStep, normalizeStepVideo, parseVideoUrl, removeVideoFromStep, videoWatchUrl } from "./video.js";

export const STEP_LIMITS = Object.freeze({ title: 120, text: 1200, label: 120, caption: 3000, alt: 300, maxSteps: 200 });
export const POPOVER_SIDES = Object.freeze(["top", "bottom", "left", "right", "over"]);
export const POPOVER_ALIGNS = Object.freeze(["start", "center", "end"]);
/** Destaque padrão quando só vem o ponto de clique (mesmo tamanho do editor: 14% × 8%). */
export const AUTO_HIGHLIGHT = Object.freeze({ w: 14, h: 8 });

const round = (n) => Math.round(n * 1000) / 1000;
const isNum = (n) => typeof n === "number" && Number.isFinite(n);

function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

/** {x,y,width,height} em 0..1 → {x,y,w,h} em %. */
export function rectFromUnit(rect) {
  return { x: round(rect.x * 100), y: round(rect.y * 100), w: round(rect.width * 100), h: round(rect.height * 100) };
}

/** {x,y,w,h} em % → {x,y,width,height} em 0..1. */
export function rectToUnit(hotspot) {
  if (!hasHotspot(hotspot)) return null;
  return { x: round(hotspot.x / 100), y: round(hotspot.y / 100), width: round(hotspot.w / 100), height: round(hotspot.h / 100) };
}

export function pointFromUnit(point) {
  return { x: round(point.x * 100), y: round(point.y * 100) };
}

export function pointToUnit(point) {
  if (!point || !isNum(point.x) || !isNum(point.y)) return null;
  return { x: round(point.x / 100), y: round(point.y / 100) };
}

/** Destaque centrado no clique, sem passar das bordas da imagem (em %). */
export function autoHighlightAround(pointPct, size = AUTO_HIGHLIGHT) {
  const w = Math.min(100, size.w);
  const h = Math.min(100, size.h);
  const x = Math.min(Math.max(pointPct.x - w / 2, 0), 100 - w);
  const y = Math.min(Math.max(pointPct.y - h / 2, 0), 100 - h);
  return { x: round(x), y: round(y), w, h };
}

function issue(field, message, hint) {
  return hint ? { field, message, hint } : { field, message };
}

function readUnitPoint(raw, field, errors) {
  if (raw == null) return null;
  if (typeof raw !== "object" || !isNum(raw.x) || !isNum(raw.y)) {
    errors.push(issue(field, `${field} precisa ser {x, y} com números entre 0 e 1.`, "Ex.: {\"x\": 0.42, \"y\": 0.18} = 42% da largura e 18% da altura da imagem, a partir do canto superior esquerdo."));
    return null;
  }
  if (raw.x < 0 || raw.x > 1 || raw.y < 0 || raw.y > 1) {
    errors.push(issue(field, `${field} fora da imagem: x e y vão de 0 a 1 (recebi x=${raw.x}, y=${raw.y}).`, "Se você tem pixels, divida pela largura/altura da imagem."));
    return null;
  }
  return pointFromUnit(raw);
}

function readUnitRect(raw, field, errors, warnings) {
  if (raw == null) return null;
  const ok = raw && typeof raw === "object" && ["x", "y", "width", "height"].every((k) => isNum(raw[k]));
  if (!ok) {
    errors.push(issue(field, `${field} precisa ser {x, y, width, height} com números entre 0 e 1.`, "Ex.: {\"x\": 0.1, \"y\": 0.2, \"width\": 0.3, \"height\": 0.08}."));
    return null;
  }
  if (raw.x < 0 || raw.y < 0 || raw.x >= 1 || raw.y >= 1) {
    errors.push(issue(field, `${field}: x e y precisam estar entre 0 e 1 (canto superior esquerdo do retângulo).`));
    return null;
  }
  if (raw.width <= 0.005 || raw.height <= 0.005) {
    errors.push(issue(field, `${field} é pequeno demais (mínimo 0.005 de largura e altura).`, "Use um retângulo que cubra o botão ou campo inteiro."));
    return null;
  }
  const rect = { ...raw };
  if (rect.x + rect.width > 1 || rect.y + rect.height > 1) {
    rect.width = Math.min(rect.width, 1 - rect.x);
    rect.height = Math.min(rect.height, 1 - rect.y);
    warnings.push(`${field} passava da borda da imagem e foi cortado.`);
  }
  return rectFromUnit(rect);
}

/**
 * Aplica a entrada de um agente sobre um passo (novo ou existente).
 * @param {object} input {title, text, label, narrationScript, type, scene, highlight, click, popoverSide, popoverAlign, simulateClick, alt, altDecorative}
 * @param {object} [base] passo atual (update) — campos ausentes ficam como estão
 * @returns {{ ok: boolean, step: object|null, warnings: string[], errors: {field:string,message:string,hint?:string}[] }}
 */
export function applyAgentStepInput(input = {}, base = null) {
  const errors = [];
  const warnings = [];
  const step = base
    ? structuredClone(base)
    : {
        id: "",
        scene: 1,
        label: "",
        type: "screen",
        image: "",
        hotspot: { x: 40, y: 40, w: 14, h: 8 },
        clickPoint: { x: 47, y: 44 },
        popover: { title: "", description: "", side: "bottom", align: "center" },
        caption: "",
        simulateClick: true,
        onNext: "advance",
      };
  step.popover = { side: "bottom", align: "center", ...(step.popover || {}) };
  if (input == null || typeof input !== "object") {
    return { ok: false, step: null, warnings, errors: [issue("step", "Envie um objeto com os campos do passo.")] };
  }

  if (input.type != null) {
    if (input.type !== "screen" && input.type !== "slide") errors.push(issue("type", "type precisa ser \"screen\" (captura com destaque) ou \"slide\" (cartão de texto)."));
    else step.type = input.type;
  }
  if (input.title != null) {
    const title = clean(input.title, STEP_LIMITS.title + 1);
    if (title.length > STEP_LIMITS.title) warnings.push(`title cortado em ${STEP_LIMITS.title} caracteres.`);
    step.popover.title = title.slice(0, STEP_LIMITS.title);
    if (input.label == null && !base) step.label = step.popover.title;
  }
  if (input.text != null) {
    const text = clean(input.text, STEP_LIMITS.text + 1);
    if (text.length > STEP_LIMITS.text) warnings.push(`text cortado em ${STEP_LIMITS.text} caracteres.`);
    step.popover.description = text.slice(0, STEP_LIMITS.text);
  }
  if (input.label != null) step.label = clean(input.label, STEP_LIMITS.label);
  if (input.narrationScript != null) step.caption = clean(input.narrationScript, STEP_LIMITS.caption);
  // why: WCAG 1.1.1 — texto alternativo da captura; vazio cai no título/texto do balão no player
  if (input.alt != null) {
    const alt = clean(input.alt, STEP_LIMITS.alt + 1);
    if (alt.length > STEP_LIMITS.alt) warnings.push(`alt cortado em ${STEP_LIMITS.alt} caracteres.`);
    if (alt) step.alt = alt.slice(0, STEP_LIMITS.alt);
    else delete step.alt;
  }
  if (input.altDecorative != null) {
    if (input.altDecorative === true) step.altDecorative = true;
    else delete step.altDecorative;
  }
  if (input.scene != null) {
    if (!Number.isInteger(input.scene) || input.scene < 1 || input.scene > 99) errors.push(issue("scene", "scene precisa ser um inteiro de 1 a 99."));
    else step.scene = input.scene;
  }
  if (input.popoverSide != null) {
    if (!POPOVER_SIDES.includes(input.popoverSide)) errors.push(issue("popoverSide", `popoverSide aceita: ${POPOVER_SIDES.join(", ")}.`));
    else step.popover.side = input.popoverSide;
  }
  if (input.popoverAlign != null) {
    if (!POPOVER_ALIGNS.includes(input.popoverAlign)) errors.push(issue("popoverAlign", `popoverAlign aceita: ${POPOVER_ALIGNS.join(", ")}.`));
    else step.popover.align = input.popoverAlign;
  }
  if (input.simulateClick != null) step.simulateClick = input.simulateClick !== false;

  const rect = readUnitRect(input.highlight, "highlight", errors, warnings);
  const click = readUnitPoint(input.click, "click", errors);
  if (rect) step.hotspot = rect;
  if (click && !rect && input.highlight == null && !base) {
    step.hotspot = autoHighlightAround(click);
    warnings.push("Sem highlight: criei um destaque de 14% × 8% em volta do clique. Envie highlight para cobrir o elemento inteiro.");
  }
  if (click) {
    const clamped = clampClickToHotspot(click, step.hotspot);
    if (!pointInHotspot(click, step.hotspot) || clamped.x !== click.x || clamped.y !== click.y) {
      warnings.push(`click ficava fora do destaque (ou colado na borda) e foi movido para dentro (margem de ${CLICK_INSET}%).`);
    }
    step.clickPoint = clamped;
  } else if (rect) {
    // destaque novo sem clique: clique no centro (o player nunca mostra clique fora do destaque)
    step.clickPoint = clampClickToHotspot(step.clickPoint || { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, step.hotspot);
  }

  readVideoInput(input, step, errors, warnings);

  if (!step.popover.title && step.type === "screen" && !base) warnings.push("Passo sem title: o balão fica só com o texto.");
  return { ok: errors.length === 0, step: errors.length ? null : step, warnings, errors };
}

/**
 * video: link do YouTube/Vimeo (string) liga o vídeo; null ou "" tira.
 * why: só o link fica no tour (nada de upload do vídeo); a capa é a imagem do passo.
 *      Passo com vídeo ocupa a tela toda: destaque/clique do agente são ignorados.
 */
function readVideoInput(input, step, errors, warnings) {
  if (input.video !== undefined) {
    if (input.video === null || input.video === "") {
      removeVideoFromStep(step);
    } else {
      const video = typeof input.video === "string" ? parseVideoUrl(input.video) : normalizeStepVideo(input.video);
      if (!video) {
        errors.push(
          issue(
            "video",
            "video precisa ser um link do YouTube ou do Vimeo (ex.: https://youtu.be/ID, https://www.youtube.com/watch?v=ID ou https://vimeo.com/ID).",
            "Envie null para tirar o vídeo do passo."
          )
        );
        return;
      }
      if (input.type === "slide") {
        errors.push(issue("video", "Passo do tipo \"slide\" não tem vídeo.", "Use type \"screen\": a capa do vídeo vira a imagem do passo."));
        return;
      }
      applyVideoToStep(step, video);
    }
  }
  if (!step.video) return;
  if (step.type === "slide") {
    // why: virar slide tira o vídeo (o slide não tem imagem nem palco)
    removeVideoFromStep(step);
    warnings.push("O passo virou slide e o vídeo saiu.");
    return;
  }
  if (input.highlight != null || input.click != null) {
    warnings.push("Passo com vídeo ocupa a tela toda: highlight e click foram ignorados.");
  }
  applyVideoToStep(step, step.video);
}

/** Passo como o agente vê: coordenadas 0..1, sem mídia embutida. */
export function stepForAgent(step, index) {
  return {
    id: step.id,
    index,
    type: step.type === "slide" ? "slide" : "screen",
    scene: Number(step.scene) || 1,
    title: step.popover?.title || "",
    text: step.popover?.description || "",
    label: step.label || "",
    narrationScript: step.caption || "",
    alt: step.alt || "",
    altDecorative: step.altDecorative === true,
    hasNarrationAudio: Boolean(step.narrationAudio),
    hasImage: Boolean(step.image),
    highlight: rectToUnit(step.hotspot),
    click: pointToUnit(step.clickPoint),
    popoverSide: step.popover?.side || "bottom",
    popoverAlign: step.popover?.align || "center",
    ...videoForAgent(step),
  };
}

function videoForAgent(step) {
  const video = step.type === "slide" ? null : normalizeStepVideo(step.video);
  return video ? { video: { kind: video.kind, id: video.id, url: videoWatchUrl(video) } } : {};
}

/** Tema: preset por id ou cores (#hex). */
export function themeFromAgentInput(input = {}, current = null) {
  const errors = [];
  // why: fonte do tema (id da lista curada); vale com preset, com cores ou sozinha
  let font;
  if (input.font != null) {
    if (!isThemeFontId(input.font)) {
      errors.push(issue("font", `Fonte desconhecida. Use uma destas: ${THEME_FONT_IDS.join(", ")}.`));
      return { ok: false, errors };
    }
    font = input.font;
  }
  const withFont = (theme) => {
    const keep = font ?? current?.font;
    if (keep && keep !== "default") theme.font = keep;
    else delete theme.font;
    return theme;
  };
  if (!input.preset && !input.colors && font != null) {
    const base = current || cloneTheme(THEME_PRESETS[0].colors, { presetId: THEME_PRESETS[0].id });
    return { ok: true, theme: withFont(cloneTheme(base)), errors };
  }
  if (input.preset) {
    const preset = getPreset(input.preset);
    if (!preset) {
      errors.push(issue("preset", `Tema desconhecido. Use um destes: ${THEME_PRESETS.map((p) => p.id).join(", ")}.`));
      return { ok: false, errors };
    }
    return { ok: true, theme: withFont(cloneTheme(preset.colors, { presetId: preset.id })), errors };
  }
  const colors = input.colors && typeof input.colors === "object" ? input.colors : null;
  if (!colors) return { ok: false, errors: [issue("theme", "Envie preset (id), colors {accent, overlay, popoverBg, title, text, button, hotspot} e/ou font.")] };
  const base = current || cloneTheme(THEME_PRESETS[0].colors, { presetId: THEME_PRESETS[0].id });
  const next = { ...base };
  for (const [key, value] of Object.entries(colors)) {
    if (!THEME_COLOR_KEYS.includes(key)) {
      errors.push(issue(`colors.${key}`, `Cor desconhecida. Chaves aceitas: ${THEME_COLOR_KEYS.join(", ")}.`));
      continue;
    }
    if (!/^#[0-9a-f]{6}$/i.test(String(value))) {
      errors.push(issue(`colors.${key}`, "Use #RRGGBB (ex.: #2A9D8F)."));
      continue;
    }
    next[key] = String(value);
  }
  if (errors.length) return { ok: false, errors };
  delete next.presetId;
  return { ok: true, theme: withFont(cloneTheme(next)), errors };
}

/** Passo inicial (captura de lead) a partir da entrada do agente. */
export function startStepFromAgentInput(input = {}) {
  const fields = {};
  for (const key of ["name", "email", "phone"]) {
    const raw = input.fields?.[key];
    if (raw === "required") fields[key] = { show: true, required: true };
    else if (raw === "optional") fields[key] = { show: true, required: false };
    else if (raw === "hidden") fields[key] = { show: false, required: false };
  }
  const step = normalizeStartStep({ ...input, enabled: input.enabled !== false, fields: { ...{ name: { show: true, required: true }, email: { show: true, required: true }, phone: { show: false, required: false } }, ...fields } });
  const errors = [];
  if (step.enabled && !["name", "email", "phone"].some((k) => step.fields[k].show)) {
    errors.push(issue("fields", "Mostre ao menos um campo (name, email ou phone) — ou envie enabled: false."));
  }
  return { ok: errors.length === 0, step, errors };
}

/** Passo final (CTAs) a partir da entrada do agente. WhatsApp em E.164 (ex.: +5511999998888). */
export function endStepFromAgentInput(input = {}) {
  const errors = [];
  const raw = {
    enabled: input.enabled !== false,
    title: input.title,
    body: input.text,
    whatsapp: input.whatsapp ? { enabled: true, phone: input.whatsapp.phone, message: input.whatsapp.message, label: input.whatsapp.label } : { enabled: false },
    contact: input.link ? { enabled: true, mode: "link", url: input.link.url, label: input.link.label } : { enabled: false },
    showReplay: input.showReplay !== false,
  };
  const step = normalizeEndStep(raw);
  if (input.whatsapp && !isValidWhatsAppNumber(step.whatsapp.phone)) {
    errors.push(issue("whatsapp.phone", "Número de WhatsApp inválido. Use E.164 com DDI: +55 11 99999-8888 → \"+5511999998888\".", "8 a 15 dígitos, começando pelo código do país."));
  }
  if (input.link && !step.contact.url) {
    errors.push(issue("link.url", "link.url precisa ser https://… (ou mailto:)."));
  }
  if (step.title.length >= FIXED_LIMITS.title && String(input.title || "").length > FIXED_LIMITS.title) {
    errors.push(issue("title", `title do passo final tem no máximo ${FIXED_LIMITS.title} caracteres.`));
  }
  return { ok: errors.length === 0, step, errors };
}

/** Confere o tour antes de publicar. Erros bloqueiam; avisos não. */
export function checkTourForPublish(tour) {
  const errors = [];
  const warnings = [];
  const steps = Array.isArray(tour?.steps) ? tour.steps : [];
  if (!steps.length) errors.push(issue("steps", "O tour não tem passos. Use add_step antes de publicar."));
  if (steps.length > STEP_LIMITS.maxSteps) errors.push(issue("steps", `No máximo ${STEP_LIMITS.maxSteps} passos.`));
  steps.forEach((step, i) => {
    if (step.type !== "slide" && !step.image) errors.push(issue(`steps[${i}].image`, `O passo ${i + 1} ("${step.popover?.title || step.id}") é uma captura sem imagem.`, "Envie a imagem com update_step ou mude type para \"slide\"."));
    if (step.type !== "slide" && hasHotspot(step.hotspot) && step.clickPoint && !pointInHotspot(step.clickPoint, step.hotspot)) {
      warnings.push(`Passo ${i + 1}: clique fora do destaque — o player mostra o clique preso ao destaque.`);
    }
    if (step.video != null && step.type !== "slide" && !normalizeStepVideo(step.video)) {
      errors.push(issue(`steps[${i}].video`, `O passo ${i + 1} tem um vídeo inválido.`, "video precisa ser { kind: \"youtube\" | \"vimeo\", id } — ou remova o campo."));
    }
    if (!step.popover?.title && !step.popover?.description) warnings.push(`Passo ${i + 1} sem título e sem texto.`);
  });
  if (tour?.endStep?.enabled && tour.endStep.whatsapp?.enabled && !isValidWhatsAppNumber(tour.endStep.whatsapp.phone)) {
    errors.push(issue("endStep.whatsapp.phone", "WhatsApp do passo final inválido (E.164)."));
  }
  return { ok: errors.length === 0, errors, warnings };
}
