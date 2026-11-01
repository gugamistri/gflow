/**
 * Selo NOVO no ícone e bloco "Novidades" do popup.
 * why: sem rede e sem rastreio; o estado é só { lastSeen, pending } em chrome.storage.local.
 * Os itens vêm de lib/releaseNotes.js (cópia de js/releaseNotes.js, a mesma fonte do pop-up do editor).
 */
import { RELEASE_NOTE_ENTRIES, sortReleaseNotes } from "./releaseNotes.js";

export const WHATS_NEW_KEY = "guiaWhatsNew";
export const WHATS_NEW_PREVIEW = 2;
export const BADGE_COUNT_COLOR = "#1A4D6D";
export const BADGE_NEW_COLOR = "#2A9D8F";

/** Compara x.y.z (sem sufixo). Negativo se a < b. */
export function compareVersions(a, b) {
  const pa = String(a ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Itens que chegaram depois de `lastSeen` e até a versão instalada. */
export function unseenEntries(lastSeen, current, entries = RELEASE_NOTE_ENTRIES) {
  return entries.filter((e) => e.ext && compareVersions(e.ext, lastSeen || "0.0.0") > 0 && compareVersions(e.ext, current) <= 0);
}

/**
 * Estado depois do onInstalled.
 * - install: nada a avisar (a pessoa acabou de chegar), marca a versão como vista.
 * - update: selo só se a versão nova traz item que a pessoa não viu (patch sem item não acende).
 * - outros motivos (atualização do Chrome): mantém o que estava.
 */
export function stateAfterInstall({ reason, previousVersion, current, stored, entries = RELEASE_NOTE_ENTRIES }) {
  if (reason === "install") return { lastSeen: current, pending: false };
  if (reason !== "update") return stored || { lastSeen: current, pending: false };
  const lastSeen = stored?.lastSeen || previousVersion || "0.0.0";
  return { lastSeen, pending: unseenEntries(lastSeen, current, entries).length > 0 };
}

/** Ao abrir o popup: tudo visto. */
export function stateAfterSeen(current) {
  return { lastSeen: current, pending: false };
}

/** O contador da captura vence o selo; sem captura, NOVO enquanto houver novidade. */
export function badgeFor({ count = 0, pending = false, newLabel = "NEW" } = {}) {
  if (count) return { text: String(count), color: BADGE_COUNT_COLOR };
  if (pending) return { text: String(newLabel).slice(0, 4), color: BADGE_NEW_COLOR };
  return { text: "", color: BADGE_COUNT_COLOR };
}

/** Itens do popup, do mais novo; os `WHATS_NEW_PREVIEW` primeiros ficam à mostra. */
export function popupEntries(entries = RELEASE_NOTE_ENTRIES) {
  return sortReleaseNotes(entries.filter((e) => e.ext));
}
