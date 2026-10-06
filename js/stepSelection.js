/**
 * Seleção e operações em grupo sobre índices de passos.
 */

/**
 * @param {number[]} indices
 * @param {number} length
 * @returns {number[]}
 */
export function normalizeIndices(indices, length) {
  const max = Math.max(0, Number(length) || 0) - 1;
  if (max < 0) return [];
  return [...new Set((indices || []).map((i) => Number(i)).filter((i) => Number.isFinite(i) && i >= 0 && i <= max))].sort(
    (a, b) => a - b
  );
}

/**
 * @param {number[]} current
 * @param {number} index
 * @param {number} length
 * @returns {number[]}
 */
export function toggleIndex(current, index, length) {
  const list = normalizeIndices(current, length);
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0 || i >= length) return list;
  if (list.includes(i)) {
    const next = list.filter((x) => x !== i);
    return next.length ? next : [i];
  }
  return normalizeIndices([...list, i], length);
}

/**
 * @param {number} anchor
 * @param {number} index
 * @param {number} length
 * @returns {number[]}
 */
export function rangeIndices(anchor, index, length) {
  if (length <= 0) return [];
  const a = Math.max(0, Math.min(length - 1, Number(anchor) || 0));
  const b = Math.max(0, Math.min(length - 1, Number(index) || 0));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

function clampIndex(value, length) {
  const n = Number(value);
  const i = Number.isFinite(n) ? Math.trunc(n) : 0;
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, i));
}

/**
 * Seta no filmstrip.
 * Sem extend: seleção única no vizinho do ativo; a âncora vai junto.
 * Com extend: intervalo contíguo da âncora até o ativo ± 1; a âncora fica.
 * Na borda, o índice não passa do fim da lista.
 * @param {{ anchor?: number, active?: number, length?: number, delta?: number, extend?: boolean }} input
 * @returns {{ indices: number[], anchor: number, active: number }}
 */
export function arrowSelection({ anchor, active, length, delta, extend = false } = {}) {
  const len = Math.max(0, Number(length) || 0);
  if (len <= 0) return { indices: [], anchor: 0, active: 0 };
  const dir = Number(delta) < 0 ? -1 : 1;
  const current = clampIndex(active, len);
  const next = clampIndex(current + dir, len);
  if (!extend) return { indices: [next], anchor: next, active: next };
  const a = clampIndex(Number.isFinite(Number(anchor)) ? Number(anchor) : current, len);
  return { indices: rangeIndices(a, next, len), anchor: a, active: next };
}

/**
 * insertBefore para subir ou descer um bloco contíguo um passo.
 * null se a seleção estiver vazia, não for contígua, ou já estiver na borda.
 * @param {number[]} indices
 * @param {number} direction negativo sobe, positivo desce
 * @param {number} length
 * @returns {number | null}
 */
export function nudgeBlockInsert(indices, direction, length) {
  const len = Math.max(0, Number(length) || 0);
  const sorted = normalizeIndices(indices, len);
  if (!sorted.length) return null;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return null;
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (direction < 0) return first <= 0 ? null : first - 1;
  if (last >= len - 1) return null;
  return last + 2;
}

/**
 * Checkbox "mostrar texto" para vários passos.
 * Ausente conta como visível, igual ao painel (`showCaption !== false`).
 * @param {object[]} steps
 * @param {number[]} indices
 * @returns {"on" | "off" | "mixed"}
 */
export function captionVisibilityState(steps, indices) {
  const list = Array.isArray(steps) ? steps : [];
  const sorted = normalizeIndices(indices, list.length);
  if (!sorted.length) return "off";
  let on = 0;
  for (const i of sorted) {
    if (list[i]?.showCaption !== false) on += 1;
  }
  if (on === sorted.length) return "on";
  if (on === 0) return "off";
  return "mixed";
}

/**
 * Próximo valor ao acionar "mostrar texto" na seleção.
 * Tudo ligado desliga. Desligado ou misto liga todos.
 * @param {"on" | "off" | "mixed"} state
 * @returns {boolean}
 */
export function nextCaptionVisibility(state) {
  return state !== "on";
}

/**
 * Remove passos pelos índices; devolve o novo array e o índice primário sugerido.
 * @param {object[]} steps
 * @param {number[]} indices
 * @returns {{ steps: object[], primary: number }}
 */
export function deleteIndices(steps, indices) {
  const list = Array.isArray(steps) ? steps : [];
  const sorted = normalizeIndices(indices, list.length);
  if (!sorted.length) return { steps: list, primary: 0 };
  const next = list.filter((_, i) => !sorted.includes(i));
  const firstRemoved = sorted[0];
  const primary = next.length ? Math.max(0, Math.min(firstRemoved, next.length - 1)) : 0;
  return { steps: next, primary };
}

/**
 * Move o bloco selecionado para insertBefore (índice na lista atual, 0..length).
 * @param {object[]} steps
 * @param {number[]} indices
 * @param {number} insertBefore
 * @param {number | null} [scene]
 * @returns {{ steps: object[], selected: number[] }}
 */
export function moveIndices(steps, indices, insertBefore, scene = null) {
  const list = Array.isArray(steps) ? [...steps] : [];
  const sorted = normalizeIndices(indices, list.length);
  if (!sorted.length) return { steps: list, selected: [] };

  const block = sorted.map((i) => list[i]);
  const rest = list.filter((_, i) => !sorted.includes(i));
  const rawInsert = Number(insertBefore);
  const insertAt = Number.isFinite(rawInsert) ? rawInsert : rest.length;
  const removedBefore = sorted.filter((i) => i < insertAt).length;
  let dest = insertAt - removedBefore;
  dest = Math.max(0, Math.min(dest, rest.length));

  if (scene != null) {
    const nextScene = Number(scene) || 1;
    for (const step of block) step.scene = nextScene;
  }

  rest.splice(dest, 0, ...block);
  const selected = block.map((_, k) => dest + k);
  return { steps: rest, selected };
}

/**
 * Coleta passos e imagens custom referenciadas, na ordem dos índices.
 * @param {object[]} steps
 * @param {number[]} indices
 * @param {Record<string, object>} customImages
 * @returns {{ steps: object[], images: Record<string, object> }}
 */
export function collectStepsForClipboard(steps, indices, customImages = {}) {
  const sorted = normalizeIndices(indices, steps?.length || 0);
  const outSteps = [];
  const images = {};
  for (const i of sorted) {
    const step = steps[i];
    if (!step) continue;
    outSteps.push(structuredClone(step));
    const ref = typeof step.image === "string" ? step.image : "";
    if (ref.startsWith("custom:")) {
      const id = ref.slice(7);
      if (customImages[id] && !images[id]) images[id] = structuredClone(customImages[id]);
    }
  }
  return { steps: outSteps, images };
}
