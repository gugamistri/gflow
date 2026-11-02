/**
 * Mídia do passo de tela: OU imagem OU vídeo (YouTube/Vimeo). Lógica pura, sem DOM.
 *
 * - Vídeo: `step.video` + pôster em `step.image`; sem destaque, clique, zoom nem narração.
 * - Imagem: o comportamento de sempre.
 * why: alternar Imagem ⇄ Vídeo na mesma sessão não pode destruir dados — a memória guarda o
 * estado da imagem (antes do vídeo) e o vídeo + pôster (ao voltar para imagem).
 * Esquema intacto: um passo com imagem E vídeo continua sendo "vídeo" (a imagem é o pôster).
 */
import { applyVideoToStep, removeVideoFromStep, stepVideo } from "./tour-schema/video.js";

export const STEP_MEDIA_KINDS = Object.freeze(["image", "video"]);

const IMAGE_FIELDS = ["image", "hotspot", "clickPoint", "simulateClick", "zoomHighlight"];

const clone = (v) => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);
const keyOf = (step) => step?.id || step;

/** Memória da sessão (por passo). Não vai para o tour salvo. */
export function createStepMediaMemory() {
  return new Map();
}

function entry(memory, step, create = false) {
  if (!memory || !step) return null;
  const key = keyOf(step);
  let e = memory.get(key);
  if (!e && create) {
    e = {};
    memory.set(key, e);
  }
  return e || null;
}

function snapshotImage(step) {
  const snap = {};
  for (const f of IMAGE_FIELDS) if (f in step) snap[f] = clone(step[f]);
  return snap;
}

function restoreImage(step, snap) {
  for (const f of IMAGE_FIELDS) {
    if (f in snap) step[f] = clone(snap[f]);
    else delete step[f];
  }
}

/** "video" | "image" para passo de tela; null em slide. `pending` = escolheu Vídeo e ainda não colou o link. */
export function stepMediaKind(step, memory) {
  if (!step || step.type === "slide") return null;
  if (stepVideo(step)) return "video";
  return entry(memory, step)?.pending ? "video" : "image";
}

/** Chamar ANTES de aplicar um vídeo novo: guarda a imagem para o "voltar para Imagem". */
export function rememberStepImage(step, memory) {
  if (!step || stepVideo(step)) return;
  const e = entry(memory, step, true);
  e.image = snapshotImage(step);
}

/** Depois que um vídeo foi aplicado: sai do modo "pendente" e esquece o vídeo antigo guardado. */
export function settleStepVideo(step, memory) {
  const e = entry(memory, step);
  if (!e) return;
  e.pending = false;
  delete e.video;
}

/**
 * Troca a mídia do passo. Devolve `{ kind, changed }` — `changed` diz se o passo (dados) mudou;
 * escolher Vídeo sem vídeo guardado só muda a UI (pendente), não os dados.
 */
export function chooseStepMedia(step, kind, memory) {
  const current = stepMediaKind(step, memory);
  if (!current || !STEP_MEDIA_KINDS.includes(kind)) return { kind: current, changed: false };
  if (kind === "image") {
    const e = entry(memory, step, true);
    e.pending = false;
    const video = stepVideo(step);
    if (!video) return { kind: "image", changed: false };
    e.video = { video: clone(step.video), poster: step.image || "" };
    removeVideoFromStep(step);
    if (e.image) restoreImage(step, e.image);
    return { kind: "image", changed: true };
  }
  if (stepVideo(step)) return { kind: "video", changed: false };
  const e = entry(memory, step, true);
  if (e.video) {
    e.image = snapshotImage(step);
    applyVideoToStep(step, e.video.video, e.video.poster);
    e.pending = false;
    delete e.video;
    return { kind: "video", changed: true };
  }
  e.pending = true;
  return { kind: "video", changed: false };
}
