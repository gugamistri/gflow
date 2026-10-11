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
 * Decide quais grupos da barra do passo vão para o menu "…" quando falta largura.
 * Sai primeiro o grupo com menor prioridade (empate: o mais à direita); os demais ficam na ordem.
 * @param {number[]} widths largura de cada grupo
 * @param {number[]} priorities prioridade de permanência de cada grupo (maior fica mais tempo)
 * @param {number} available largura disponível para os grupos
 * @param {number} sepWidth largura de cada separador entre grupos visíveis
 * @returns {Set<number>} índices dos grupos que vão para o menu
 */
export function planToolbarOverflow(widths, priorities, available, sepWidth = 0) {
  const out = new Set();
  const total = () => {
    const kept = widths.filter((_, i) => !out.has(i));
    if (!kept.length) return 0;
    return kept.reduce((a, b) => a + b, 0) + sepWidth * (kept.length - 1);
  };
  while (out.size < widths.length && total() > available + 0.5) {
    let pick = -1;
    for (let i = 0; i < widths.length; i += 1) {
      if (out.has(i)) continue;
      if (pick === -1 || (priorities[i] ?? 0) <= (priorities[pick] ?? 0)) pick = i;
    }
    out.add(pick);
  }
  return out;
}
