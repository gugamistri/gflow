/**
 * Colaboração (cliente): o projeto do editor vira um mapa de "campos" (chave → valor) que casa com
 * as ops do servidor (guiaflow-cloud `lib/collab-ops.js`). Puro, sem DOM nem rede.
 *
 * Por que diff em vez de instrumentar cada edição: o editor muta o projeto no lugar e chama
 * `onChange()` em ~60 pontos. O controlador tira um snapshot a cada mudança e a fila de ops
 * compara com o último estado confirmado. Assim nenhum ponto de edição precisa saber de colaboração.
 *
 * Chaves: `p:name|theme|playback|narration|coverStepId|sceneLabels` e `s:<stepId>:<campo>`; campos de passo:
 * title text label caption alt scene type layout side align simulateClick onNext showCaption
 * zoomHighlight holdSeconds pos hl img audio i18n.<lang>.<campo> new del.
 * Imagens e áudio ficam locais como data URL aqui; a camada de rede troca por `asset:<sha>`.
 */
import { comparePos, isValidPos, posBetween, sortStepsByPos } from "./tour-schema/collabSteps.js";

export const TEXT_FIELDS = Object.freeze({
  title: "popover.title",
  text: "popover.description",
  label: "label",
  caption: "caption",
  alt: "alt",
});
const PLAIN_FIELDS = ["scene", "type", "layout", "onNext", "holdSeconds", "simulateClick", "showCaption", "zoomHighlight"];
const I18N_FIELDS = ["title", "description", "caption", "label", "alt"];
const PROJECT_OBJECTS = ["theme", "playback", "narration"];
export const MAX_TOMBSTONES = 200;

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const getPath = (o, path) => path.split(".").reduce((n, k) => (n == null ? undefined : n[k]), o);
function setPath(obj, path, value) {
  const parts = path.split(".");
  let node = obj;
  for (const p of parts.slice(0, -1)) node = isObj(node[p]) ? node[p] : (node[p] = {});
  if (value === undefined) delete node[parts.at(-1)];
  else node[parts.at(-1)] = value;
}

export function parseKey(key) {
  if (typeof key !== "string") return null;
  if (key.startsWith("p:")) return { kind: "project", field: key.slice(2) };
  const m = /^s:([A-Za-z0-9_-]{1,64}):(.+)$/.exec(key);
  return m ? { kind: "step", stepId: m[1], field: m[2] } : null;
}
export const stepKey = (id, field) => `s:${id}:${field}`;
export const isStructuralKey = (key) => {
  const k = parseKey(key);
  return Boolean(k && k.kind === "step" && (k.field === "new" || k.field === "del" || k.field === "pos"));
};
export const stepIdOf = (key) => {
  const k = parseKey(key);
  return k?.kind === "step" ? k.stepId : null;
};

function imageValue(project, step) {
  const image = step.image ?? "";
  const out = { image };
  if (typeof image === "string" && image.startsWith("custom:")) {
    const id = image.slice(7);
    const ci = project.customImages?.[id];
    if (ci && typeof ci.dataUrl === "string") out.customImage = { id, name: ci.name || "", dataUrl: ci.dataUrl };
  }
  return out;
}

function stepFieldEntries(project, step) {
  const out = [];
  for (const [field, path] of Object.entries(TEXT_FIELDS)) {
    const v = getPath(step, path);
    if (typeof v === "string") out.push([field, v]);
  }
  for (const f of PLAIN_FIELDS) if (step[f] !== undefined && step[f] !== null) out.push([f, step[f]]);
  for (const f of ["side", "align"]) if (typeof step.popover?.[f] === "string") out.push([f, step.popover[f]]);
  if (isValidPos(step.pos)) out.push(["pos", step.pos]);
  out.push(["hl", { hotspot: step.hotspot ?? null, clickPoint: step.clickPoint ?? null }]);
  out.push(["img", imageValue(project, step)]);
  if (step.narrationAudio != null) out.push(["audio", step.narrationAudio]);
  if (isObj(step.i18n)) {
    for (const [lang, bag] of Object.entries(step.i18n)) {
      if (!isObj(bag)) continue;
      for (const f of I18N_FIELDS) if (typeof bag[f] === "string") out.push([`i18n.${lang}.${f}`, bag[f]]);
      if (bag.narrationAudio != null) out.push([`i18n.${lang}.narrationAudio`, bag.narrationAudio]);
    }
  }
  return out;
}

/** Valor "completo" de um passo novo (vai na op `new`). Texto vem junto em `popover`. */
export function newStepValue(project, step) {
  const v = {
    pos: step.pos,
    type: step.type === "slide" ? "slide" : "screen",
    scene: Number.isFinite(Number(step.scene)) ? Number(step.scene) : 1,
    label: step.label ?? "",
    caption: step.caption ?? "",
    popover: {
      title: step.popover?.title ?? "",
      description: step.popover?.description ?? "",
      side: step.popover?.side,
      align: step.popover?.align,
    },
    hotspot: step.hotspot ?? null,
    clickPoint: step.clickPoint ?? null,
  };
  if (step.alt) v.alt = step.alt;
  for (const f of ["simulateClick", "showCaption", "zoomHighlight"]) if (typeof step[f] === "boolean") v[f] = step[f];
  if (typeof step.onNext === "string") v.onNext = step.onNext;
  if (Number.isFinite(Number(step.holdSeconds))) v.holdSeconds = Number(step.holdSeconds);
  const img = imageValue(project, step);
  v.image = img.image;
  if (img.customImage) v.customImage = img.customImage;
  return v;
}

/** Snapshot: Map(chave → valor) só com o que é colaborativo. */
export function snapshotProject(project) {
  const map = new Map();
  if (!project) return map;
  if (typeof project.name === "string") map.set("p:name", project.name);
  for (const f of PROJECT_OBJECTS) if (isObj(project[f])) map.set(`p:${f}`, clone(project[f]));
  if (typeof project.coverStepId === "string") map.set("p:coverStepId", project.coverStepId);
  // nomes das cenas ({ "1": "Bem-vindo" }): sem isto o rename ficava só no navegador de quem editou
  if (isObj(project.sceneLabels)) map.set("p:sceneLabels", clone(project.sceneLabels));
  for (const step of project.steps || []) {
    if (!step?.id) continue;
    map.set(stepKey(step.id, "new"), newStepValue(project, step)); // marca "existe"
    for (const [field, value] of stepFieldEntries(project, step)) map.set(stepKey(step.id, field), clone(value));
  }
  return map;
}

export const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Garante `pos` coerente com a ordem do array (o editor reordena o array e não conhece `pos`).
 * Mexe no mínimo de passos: quem já respeita a ordem fica; quem quebrou ganha uma chave entre vizinhos.
 */
export function normalizePositions(steps) {
  const list = Array.isArray(steps) ? steps : [];
  let prev = null;
  let changed = 0;
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i];
    const ok = isValidPos(s.pos) && (prev === null || s.pos > prev);
    if (ok) {
      prev = s.pos;
      continue;
    }
    let next = null;
    for (let j = i + 1; j < list.length; j += 1) {
      if (isValidPos(list[j].pos) && (prev === null || list[j].pos > prev)) {
        next = list[j].pos;
        break;
      }
    }
    s.pos = posBetween(prev, next);
    prev = s.pos;
    changed += 1;
  }
  return changed;
}

/** Diff de snapshots → ops `{key, value}` (sem baseRev). Passos novos viram uma única op `new`. */
export function diffSnapshots(prev, next, { project = null } = {}) {
  const ops = [];
  const prevSteps = new Set();
  const nextSteps = new Set();
  for (const key of prev.keys()) if (key.endsWith(":new")) prevSteps.add(stepIdOf(key));
  for (const key of next.keys()) if (key.endsWith(":new")) nextSteps.add(stepIdOf(key));
  for (const [key, value] of next) {
    const k = parseKey(key);
    if (k?.kind === "step") {
      if (k.field === "new") {
        if (!prevSteps.has(k.stepId)) ops.push({ key, value });
        continue;
      }
      if (!prevSteps.has(k.stepId)) continue; // vai dentro do `new`
    }
    if (!prev.has(key) || !sameValue(prev.get(key), value)) ops.push({ key, value });
  }
  for (const id of prevSteps) if (!nextSteps.has(id)) ops.push({ key: stepKey(id, "del"), value: true });
  void project;
  return ops;
}

/** Lê o valor atual do campo no projeto (mesma forma do snapshot). `undefined` = ausente. */
export function readField(project, key) {
  const k = parseKey(key);
  if (!k || !project) return undefined;
  if (k.kind === "project") {
    if (k.field === "name") return project.name;
    if (PROJECT_OBJECTS.includes(k.field) || k.field === "coverStepId" || k.field === "sceneLabels") return project[k.field];
    return undefined;
  }
  const step = (project.steps || []).find((s) => s?.id === k.stepId);
  if (k.field === "del") return !step && Boolean(project.collab?.tombstones?.[k.stepId]);
  if (!step) return undefined;
  if (k.field === "new") return newStepValue(project, step);
  return stepFieldEntries(project, step).find(([f]) => f === k.field)?.[1];
}

function ensureCollab(project) {
  if (!isObj(project.collab)) project.collab = { v: 1 };
  if (!isObj(project.collab.tombstones)) project.collab.tombstones = {};
  return project.collab;
}

/** Aplica um valor vindo do servidor no projeto local (mutando). `value` já hidratado (data URL). */
export function applyField(project, key, value) {
  const k = parseKey(key);
  if (!k || !project) return false;
  if (!Array.isArray(project.steps)) project.steps = [];
  if (k.kind === "project") {
    if (k.field === "name") project.name = value;
    else if (k.field === "coverStepId") {
      if (value == null) delete project.coverStepId;
      else project.coverStepId = value;
    } else if (PROJECT_OBJECTS.includes(k.field) || k.field === "sceneLabels") project[k.field] = isObj(value) ? clone(value) : {};
    else return false;
    return true;
  }
  const { stepId: id, field } = k;
  const idx = project.steps.findIndex((s) => s?.id === id);
  if (field === "new") {
    if (idx >= 0) return false;
    const step = {
      id, scene: value.scene ?? 1, label: value.label ?? "", type: value.type || "screen", image: value.image || "",
      hotspot: value.hotspot ?? undefined, clickPoint: value.clickPoint ?? undefined,
      popover: { ...(value.popover || {}) }, caption: value.caption ?? "", pos: value.pos,
    };
    for (const f of ["alt", "simulateClick", "showCaption", "zoomHighlight", "onNext", "holdSeconds", "layout"]) if (value[f] !== undefined) step[f] = clone(value[f]);
    if (value.customImage) {
      project.customImages = isObj(project.customImages) ? project.customImages : {};
      project.customImages[value.customImage.id] = { name: value.customImage.name, dataUrl: value.customImage.dataUrl, addedAt: Date.now() };
    }
    delete ensureCollab(project).tombstones[id];
    project.steps.push(step);
    project.steps = sortStepsByPos(project.steps);
    return true;
  }
  if (field === "del") {
    const c = ensureCollab(project);
    if (value) {
      if (idx < 0) return false;
      c.tombstones[id] = project.steps[idx];
      project.steps.splice(idx, 1);
      if (project.coverStepId === id) delete project.coverStepId;
    } else {
      const saved = c.tombstones[id];
      if (!saved) return false;
      delete c.tombstones[id];
      project.steps.push(saved);
      project.steps = sortStepsByPos(project.steps);
    }
    return true;
  }
  const step = project.steps[idx];
  if (!step) return false;
  if (TEXT_FIELDS[field]) setPath(step, TEXT_FIELDS[field], value);
  else if (PLAIN_FIELDS.includes(field)) step[field] = clone(value);
  else if (field === "side" || field === "align") {
    step.popover = isObj(step.popover) ? step.popover : {};
    step.popover[field] = value;
  } else if (field === "pos") {
    step.pos = value;
    project.steps = sortStepsByPos(project.steps);
  } else if (field === "hl") {
    if (value?.hotspot) step.hotspot = clone(value.hotspot);
    else delete step.hotspot;
    if (value?.clickPoint) step.clickPoint = clone(value.clickPoint);
    else delete step.clickPoint;
  } else if (field === "img") {
    step.image = value.image;
    if (value.customImage) {
      project.customImages = isObj(project.customImages) ? project.customImages : {};
      const prev = project.customImages[value.customImage.id];
      project.customImages[value.customImage.id] = { ...(prev || {}), name: value.customImage.name, dataUrl: value.customImage.dataUrl, addedAt: prev?.addedAt || Date.now() };
    }
  } else if (field === "audio") {
    if (value == null) delete step.narrationAudio;
    else step.narrationAudio = clone(value);
  } else {
    const t = /^i18n\.([^.]+)\.(.+)$/.exec(field);
    if (!t) return false;
    step.i18n = isObj(step.i18n) ? step.i18n : {};
    step.i18n[t[1]] = isObj(step.i18n[t[1]]) ? step.i18n[t[1]] : {};
    if (value == null) delete step.i18n[t[1]][t[2]];
    else step.i18n[t[1]][t[2]] = clone(value);
  }
  return true;
}

/** Qual elemento do inspetor mostra este campo (indicador "Ana está editando" e somente leitura). */
export const FIELD_INPUT_IDS = Object.freeze({
  title: "prop-title",
  text: "prop-description",
  caption: "prop-caption",
  alt: "prop-alt",
});
export const inputIdForKey = (key) => {
  const k = parseKey(key);
  return k?.kind === "step" ? FIELD_INPUT_IDS[k.field] || null : null;
};
export const keyForInputId = (stepId, inputId) => {
  const field = Object.entries(FIELD_INPUT_IDS).find(([, id]) => id === inputId)?.[0];
  return field ? stepKey(stepId, field) : null;
};

/** Nome curto do campo para toasts. Chaves de i18n: `collab.field.<nome>`. */
export function fieldLabelKey(key) {
  const k = parseKey(key);
  if (!k) return "collab.field.other";
  if (k.kind === "project") return k.field === "name" ? "collab.field.projectName" : k.field === "sceneLabels" ? "collab.field.sceneName" : "collab.field.other";
  if (k.field === "new") return "collab.field.stepNew";
  if (k.field === "del") return "collab.field.stepDel";
  if (TEXT_FIELDS[k.field]) return `collab.field.${k.field}`;
  if (k.field === "pos") return "collab.field.pos";
  if (k.field === "img") return "collab.field.img";
  if (k.field === "hl") return "collab.field.hl";
  return "collab.field.other";
}

export { comparePos };
