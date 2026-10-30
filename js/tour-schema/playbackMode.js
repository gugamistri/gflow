/**
 * Modo de exibição do tour: `playback.mode`.
 * - "guided" (padrão): balões, destaques, clique simulado, avanço sozinho e narração.
 * - "gallery": carrossel de fotos em tela cheia (imóveis): contador, legenda de 1 linha, "Detalhes",
 *   zoom, seções e miniaturas; sem balões, destaques, avanço sozinho nem voz.
 * why: `playback` viaja inteiro no payload (editor, sync, colaboração, snapshot do Cloud), então o campo
 * novo não some ao publicar; tours sem ele continuam guiados e com o mesmo hash.
 */

import { STICKY_WHATSAPP_MAX_STEP, setStickyWhatsAppFromStep, stickyWhatsAppFromStep } from "./fixedSteps.js";

export const PLAYBACK_MODES = Object.freeze(["guided", "gallery"]);
export const DEFAULT_PLAYBACK_MODE = "guided";

/** Modo do tour a partir de `demo.playback` (qualquer valor desconhecido = guiado). */
export function playbackMode(playback) {
  const raw = playback && typeof playback === "object" ? playback.mode : undefined;
  return raw === "gallery" ? "gallery" : DEFAULT_PLAYBACK_MODE;
}

export function isGalleryMode(demo) {
  return playbackMode(demo?.playback) === "gallery";
}

/** Normaliza o que vem de fora (MCP, API, editor): "gallery"/"galeria" → gallery; resto → guided; null se inválido. */
export function parsePlaybackMode(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "gallery" || raw === "galeria" || raw === "galería") return "gallery";
  if (raw === "guided" || raw === "guiado" || raw === "tour" || raw === "tour guiado") return "guided";
  return null;
}

/**
 * Grava o modo sem tocar no resto do playback. Guiado apaga o campo (o padrão não ocupa espaço
 * nem muda o hash de tours antigos).
 */
export function setPlaybackMode(playback, mode) {
  const out = playback && typeof playback === "object" ? { ...playback } : {};
  if (parsePlaybackMode(mode) === "gallery") out.mode = "gallery";
  else delete out.mode;
  return out;
}

/** Modo inicial de um tour novo pelo tipo de template ("empreendimento"/"imovel" = Galeria). */
export function defaultModeForTemplate(kind) {
  const k = String(kind ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return ["empreendimento", "imovel", "imoveis", "real-estate", "realestate", "property", "gallery", "galeria"].includes(k)
    ? "gallery"
    : DEFAULT_PLAYBACK_MODE;
}

export const SCENE_NAME_MAX = 40;

function issue(field, message, hint) {
  return hint ? { field, message, hint } : { field, message };
}

function plainName(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[*+]{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SCENE_NAME_MAX);
}

/** Como o agente vê o modo de exibição do tour (get_tour). */
export function displayForAgent(payload) {
  const labels = payload?.sceneLabels && typeof payload.sceneLabels === "object" ? payload.sceneLabels : {};
  const sceneNames = {};
  for (const key of Object.keys(labels)) {
    const n = Number(key);
    const name = plainName(labels[key]);
    if (Number.isInteger(n) && n >= 1 && n <= 99 && name) sceneNames[String(n)] = name;
  }
  return {
    mode: playbackMode(payload?.playback),
    stickyWhatsAppFromStep: stickyWhatsAppFromStep(payload?.playback) || 0,
    sceneNames,
  };
}

/**
 * Entrada do agente/API para o modo de exibição: { mode, stickyWhatsAppFromStep, sceneNames }.
 * Só os campos enviados mudam. sceneNames = { "1": "Fachada", "2": "Lazer" } (cenas dos passos; "" ou null apaga o nome).
 */
export function displayFromAgentInput(input = {}, current = {}) {
  const errors = [];
  let playback = current?.playback && typeof current.playback === "object" ? { ...current.playback } : {};
  const sceneLabels = current?.sceneLabels && typeof current.sceneLabels === "object" ? { ...current.sceneLabels } : {};
  if (!input || typeof input !== "object") return { ok: false, playback, sceneLabels, errors: [issue("display", "Envie um objeto com mode, stickyWhatsAppFromStep e/ou sceneNames.")] };
  if (input.mode !== undefined) {
    const mode = parsePlaybackMode(input.mode);
    if (!mode) errors.push(issue("mode", 'mode precisa ser "guided" (tour guiado, com balões) ou "gallery" (galeria de fotos em tela cheia).', 'Para imóveis use "gallery".'));
    else playback = setPlaybackMode(playback, mode);
  }
  if (input.stickyWhatsAppFromStep !== undefined) {
    const raw = input.stickyWhatsAppFromStep;
    const n = raw === null ? 0 : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > STICKY_WHATSAPP_MAX_STEP) {
      errors.push(issue("stickyWhatsAppFromStep", `stickyWhatsAppFromStep precisa ser um inteiro de 0 (desligado) a ${STICKY_WHATSAPP_MAX_STEP}.`, "1 = desde o primeiro passo. O botão usa o WhatsApp do set_end_cta."));
    } else playback = setStickyWhatsAppFromStep(playback, n);
  }
  if (input.sceneNames !== undefined) {
    const names = input.sceneNames;
    if (!names || typeof names !== "object" || Array.isArray(names)) {
      errors.push(issue("sceneNames", 'sceneNames precisa ser um objeto { "1": "Fachada", "2": "Lazer" } (número da cena → nome).'));
    } else {
      for (const key of Object.keys(names)) {
        const n = Number(key);
        if (!Number.isInteger(n) || n < 1 || n > 99) {
          errors.push(issue(`sceneNames.${key}`, "As chaves de sceneNames são números de cena de 1 a 99."));
          continue;
        }
        const name = names[key] == null ? "" : plainName(names[key]);
        if (name) sceneLabels[String(n)] = name;
        else delete sceneLabels[String(n)];
      }
    }
  }
  return { ok: errors.length === 0, playback, sceneLabels, errors };
}
