/** Layout do editor: painel recolhível e posição da barra flutuante do destaque. */

export const PROPS_PANEL_STORAGE_KEY = "guiaflow.propsPanelOpen";

/**
 * Painel começa aberto; só fica recolhido se o usuário recolheu antes.
 * @param {{ getItem(key: string): string | null } | null | undefined} storage
 */
export function readPropsPanelOpen(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(PROPS_PANEL_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * @param {{ setItem(key: string, value: string): void } | null | undefined} storage
 * @param {boolean} open
 */
export function writePropsPanelOpen(storage = globalThis.localStorage, open) {
  try {
    storage?.setItem(PROPS_PANEL_STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* modo privado: o estado vale só nesta aba */
  }
}

/**
 * Ctrl/⌘ + \ — no ABNT2 a tecla física pode vir como IntlBackslash.
 * @param {{ key?: string, code?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }} e
 */
export function isPropsPanelShortcut(e) {
  if (!e || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  return e.code === "Backslash" || e.code === "IntlBackslash" || e.key === "\\";
}

/**
 * @param {{ left: number, top: number, width: number, height: number }} a
 * @param {{ left: number, top: number, width: number, height: number }} b
 */
export function boxesOverlap(a, b) {
  if (!a || !b) return false;
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/**
 * Barra flutuante acima do destaque; sem espaço, vai para baixo dele (ou do balão, se o balão
 * estiver embaixo). Nunca sai das bordas do frame na horizontal.
 * @param {{ left: number, top: number, width: number, height: number }} anchor destaque, em px do frame
 * @param {{ width: number, height: number }} size barra
 * @param {{ width: number, height: number }} frame
 * @param {{ left: number, top: number, width: number, height: number } | null} [avoid] balão visível
 * @param {{ gapAbove?: number, gap?: number, pad?: number }} [opts]
 */
export function placeFloatToolbarBox(anchor, size, frame, avoid = null, opts = {}) {
  const gapAbove = opts.gapAbove ?? 26;
  const gap = opts.gap ?? 10;
  const pad = opts.pad ?? 4;
  const w = Math.max(0, size?.width || 0);
  const h = Math.max(0, size?.height || 0);
  const fw = Math.max(0, frame?.width || 0);
  const fh = Math.max(0, frame?.height || 0);
  const centerX = anchor.left + anchor.width / 2;
  const left = Math.max(pad, Math.min(centerX - w / 2, fw - w - pad));
  const fits = (top) => top >= pad && top + h <= fh - pad;
  const hits = (top) => boxesOverlap({ left, top, width: w, height: h }, avoid);

  const above = anchor.top - h - gapAbove;
  if (fits(above) && !hits(above)) return { left, top: above, placement: "above" };

  const below = anchor.top + anchor.height + gap;
  if (fits(below) && !hits(below)) return { left, top: below, placement: "below" };

  if (avoid) {
    const underAvoid = avoid.top + avoid.height + gap;
    if (fits(underAvoid)) return { left, top: underAvoid, placement: "below" };
    const overAvoid = avoid.top - h - gap;
    if (fits(overAvoid) && !boxesOverlap({ left, top: overAvoid, width: w, height: h }, anchor)) {
      return { left, top: overAvoid, placement: "above" };
    }
  }
  if (fits(above)) return { left, top: above, placement: "above" };
  if (fits(below)) return { left, top: below, placement: "below" };
  return { left, top: Math.max(pad, Math.min(anchor.top + pad, fh - h - pad)), placement: "inside" };
}
