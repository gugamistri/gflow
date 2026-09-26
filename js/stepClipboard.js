/**
 * Clipboard de passos entre abas do mesmo origin (IndexedDB).
 */

import { createStepId } from "./store.js";

/**
 * Clona um passo para colar noutro projeto: ids novos e custom: remapeado.
 * @param {object} step
 * @param {Record<string, object>} sourceImages
 * @param {(prefix?: string) => string} [makeImageId]
 * @returns {{ step: object, images: Record<string, object> }}
 */
export function cloneStepForPaste(step, sourceImages = {}, makeImageId = () => "img-" + Math.random().toString(36).slice(2, 9)) {
  const copy = structuredClone(step);
  copy.id = createStepId();
  const images = {};
  const ref = typeof copy.image === "string" ? copy.image : "";
  if (ref.startsWith("custom:")) {
    const oldId = ref.slice(7);
    const meta = sourceImages[oldId];
    if (meta) {
      const newId = makeImageId();
      images[newId] = structuredClone(meta);
      copy.image = `custom:${newId}`;
    }
  }
  return { step: copy, images };
}

/**
 * Anexa passos (e imagens) a um projeto existente numa cena nova no fim.
 * @param {object} project
 * @param {{ steps?: object[], customImages?: Record<string, object>, sceneLabels?: Record<string, string> }} payload
 * @param {{ createStepId?: () => string, makeImageId?: () => string, sceneLabel?: string }} [opts]
 * @returns {{ inserted: number, startIndex: number }}
 */
export function appendCaptureToProject(project, payload, opts = {}) {
  if (!project || !Array.isArray(payload?.steps) || !payload.steps.length) {
    throw new Error("empty");
  }
  if (!Array.isArray(project.steps)) project.steps = [];
  if (!project.customImages || typeof project.customImages !== "object") project.customImages = {};
  if (!project.sceneLabels || typeof project.sceneLabels !== "object") project.sceneLabels = {};

  const makeStepId = opts.createStepId || createStepId;
  const makeImageId =
    opts.makeImageId || (() => "img-" + Math.random().toString(36).slice(2, 9));
  const sourceImages = payload.customImages || {};
  const nextScene =
    Math.max(0, ...project.steps.map((s) => Number(s.scene) || 0), 0) + 1;
  const label =
    opts.sceneLabel ||
    payload.sceneLabels?.[1] ||
    payload.sceneLabels?.["1"] ||
    payload.name ||
    "";

  const startIndex = project.steps.length;
  for (const raw of payload.steps) {
    const { step, images } = cloneStepForPaste(raw, sourceImages, makeImageId);
    step.id = makeStepId();
    step.scene = nextScene;
    Object.assign(project.customImages, images);
    project.steps.push(step);
  }
  if (label) project.sceneLabels[String(nextScene)] = String(label);
  return { inserted: payload.steps.length, startIndex };
}
