import { t } from "./i18n.js";
/**
 * Monta o JSON que o editor importa (steps + customImages).
 * Sem APIs do Chrome, para o mesmo código rodar no service worker e nos testes.
 */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** Converte o clique em porcentagem da viewport, no mesmo sistema do editor. */
export function pointFromClick(click) {
  const vw = Number(click?.vw);
  const vh = Number(click?.vh);
  const x = Number(click?.x);
  const y = Number(click?.y);
  if (![vw, vh, x, y].every(Number.isFinite) || vw <= 0 || vh <= 0) return null;
  return {
    x: round1(clamp((x / vw) * 100, 0, 100)),
    y: round1(clamp((y / vh) * 100, 0, 100)),
  };
}

export function hotspotAround(point, w = 14, h = 8) {
  const p = point || { x: 47, y: 44 };
  return {
    x: round1(clamp(p.x - w / 2, 0, 100 - w)),
    y: round1(clamp(p.y - h / 2, 0, 100 - h)),
    w,
    h,
  };
}

/**
 * O último passo ainda sem clique só recebe o destaque.
 * Qualquer outro clique vira uma captura nova.
 */
export function nextClickAction(shots) {
  const last = shots?.[shots.length - 1];
  if (last?.awaitingHotspot) return "mark";
  return "capture";
}

const THEME = {
  presetId: "documento",
  accent: "#2A9D8F",
  accentDark: "#1F6B62",
  overlay: "#0F3248",
  popoverBg: "#FFFFFF",
  title: "#1A4D6D",
  text: "#3F3F46",
  button: "#1A4D6D",
  hotspot: "#2A9D8F",
};

export function buildDemoPayload({ name, shots }) {
  const customImages = {};
  const steps = [];

  for (const [index, shot] of shots.entries()) {
    if (!shot?.dataUrl || !shot.imageId || !shot.stepId) {
      throw new Error(t("ext.incompleteCapture"));
    }
    const label = shot.label || t("ext.defaultStep", { n: index + 1 });
    const point = shot.clickPoint || { x: 47, y: 44 };
    customImages[shot.imageId] = {
      name: shot.name || `passo-${index + 1}.jpg`,
      dataUrl: shot.dataUrl,
      addedAt: shot.addedAt || Date.now(),
    };
    steps.push({
      id: shot.stepId,
      scene: 1,
      label,
      type: "screen",
      image: `custom:${shot.imageId}`,
      hotspot: hotspotAround(point),
      clickPoint: { x: point.x, y: point.y },
      popover: {
        title: label,
        description: t("editor.editExplain"),
        side: "bottom",
        align: "center",
      },
      simulateClick: true,
      onNext: "advance",
    });
  }

  return {
    name: name || t("doc.title.capture"),
    theme: { ...THEME },
    customImages,
    steps,
    sceneLabels: { 1: t("doc.title.capture") },
  };
}
