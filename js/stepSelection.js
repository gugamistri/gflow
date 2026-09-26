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
