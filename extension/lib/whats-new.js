/**
 * Selo NOVO no ícone e bloco "Novidades" do popup.
 * why: sem rastreio; o estado é { lastSeen, lastSeenNotes, pending } em chrome.storage.local.
 * Os itens vêm de lib/releaseNotes.js (cópia de js/releaseNotes.js).
 * A extensão tenta ler /release-notes.json no editor (guiaflow.pro); se faltar rede, usa a cópia do pacote.
 */
import { RELEASE_NOTE_ENTRIES, RELEASE_NOTES_VERSION, buildReleaseNotesFeed, parseReleaseNotesFeed, releaseNotesFeedUrl, shouldShowReleaseNotes, sortReleaseNotes } from "./releaseNotes.js";

export const WHATS_NEW_KEY = "guiaWhatsNew";
export const RELEASE_NOTES_FEED_KEY = "guiaReleaseNotesFeed";
export const WHATS_NEW_PREVIEW = 2;
export const BADGE_COUNT_COLOR = "#1A4D6D";
export const BADGE_NEW_COLOR = "#2A9D8F";
export const FEED_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const PROD_RELEASE_NOTES_URL = releaseNotesFeedUrl("https://guiaflow.pro");

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

/** Itens da extensão que chegaram depois de `lastSeen` e até a versão instalada. */
export function unseenEntries(lastSeen, current, entries = RELEASE_NOTE_ENTRIES) {
  return entries.filter((e) => e.ext && compareVersions(e.ext, lastSeen || "0.0.0") > 0 && compareVersions(e.ext, current) <= 0);
}

function notesAreUnseen(lastSeenNotes, notesVersion) {
  return Boolean(notesVersion && shouldShowReleaseNotes({ dismissedVersion: lastSeenNotes, currentVersion: notesVersion }));
}

function pendingFor({ lastSeen, current, lastSeenNotes, notesVersion, entries }) {
  return unseenEntries(lastSeen, current, entries).length > 0 || notesAreUnseen(lastSeenNotes, notesVersion);
}

/**
 * Estado depois do onInstalled.
 * - install: nada a avisar (a pessoa acabou de chegar), marca a versão como vista.
 * - update: selo se a versão nova da extensão traz item que a pessoa não viu, ou se há novidades do editor ainda não vistas.
 * - outros motivos (atualização do Chrome): mantém o que estava.
 */
export function stateAfterInstall({ reason, previousVersion, current, notesVersion = "", stored, entries = RELEASE_NOTE_ENTRIES }) {
  if (reason === "install") return { lastSeen: current, lastSeenNotes: notesVersion, pending: false };
  if (reason !== "update") return stored || { lastSeen: current, lastSeenNotes: notesVersion, pending: false };
  const lastSeen = stored?.lastSeen || previousVersion || "0.0.0";
  const lastSeenNotes = stored?.lastSeenNotes ?? "";
  return { lastSeen, lastSeenNotes, pending: pendingFor({ lastSeen, current, lastSeenNotes, notesVersion, entries }) };
}

/** Ao abrir o popup: tudo visto, inclusive a versão das novidades do editor. */
export function stateAfterSeen(current, notesVersion = "") {
  return { lastSeen: current, lastSeenNotes: notesVersion, pending: false };
}

/** Depois de um fetch: acende o selo se o site tem versão de novidades que a pessoa ainda não viu. */
export function stateAfterFeed({ stored, current, notesVersion, entries = RELEASE_NOTE_ENTRIES }) {
  const lastSeen = stored?.lastSeen || current || "0.0.0";
  const lastSeenNotes = stored?.lastSeenNotes ?? "";
  return { lastSeen, lastSeenNotes, pending: pendingFor({ lastSeen, current, lastSeenNotes, notesVersion, entries }) };
}

/** O contador da captura vence o selo; sem captura, NOVO enquanto houver novidade. */
export function badgeFor({ count = 0, pending = false, newLabel = "NEW" } = {}) {
  if (count) return { text: String(count), color: BADGE_COUNT_COLOR };
  if (pending) return { text: String(newLabel).slice(0, 4), color: BADGE_NEW_COLOR };
  return { text: "", color: BADGE_COUNT_COLOR };
}

/** Itens do popup (editor e extensão), do mais novo; os `WHATS_NEW_PREVIEW` primeiros ficam à mostra. */
export function popupEntries(entries = RELEASE_NOTE_ENTRIES) {
  return sortReleaseNotes(entries.filter((e) => e.editor || e.ext));
}

export function bundledReleaseNotesFeed(texts) {
  return buildReleaseNotesFeed(texts);
}

/** Prefere o feed do site quando a versão é igual ou mais nova que a cópia do pacote. */
export function preferredFeed(bundled, remote) {
  if (!bundled) return remote || null;
  if (!remote) return bundled;
  return compareVersions(remote.version, bundled.version) >= 0 ? remote : bundled;
}

export async function fetchReleaseNotesFeed(url, fetchImpl = globalThis.fetch, timeoutMs = 4000) {
  if (typeof fetchImpl !== "function" || !url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "GET", credentials: "omit", cache: "no-cache", signal: ctrl.signal });
    if (!res?.ok) return null;
    return parseReleaseNotesFeed(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tenta a origem do editor e, se for outra, guiaflow.pro.
 * Devolve o feed mais novo entre o pacote e o que veio da rede.
 */
export async function loadPreferredFeed({ bundled, editorOrigin, fetchImpl, prodUrl = PROD_RELEASE_NOTES_URL } = {}) {
  const urls = [];
  if (editorOrigin) {
    const url = releaseNotesFeedUrl(editorOrigin);
    if (url) urls.push(url);
  }
  if (prodUrl && !urls.includes(prodUrl)) urls.push(prodUrl);
  let best = bundled || null;
  for (const url of urls) {
    const remote = await fetchReleaseNotesFeed(url, fetchImpl);
    best = preferredFeed(best, remote);
  }
  return best;
}

export function feedCacheIsFresh(fetchedAt, now = Date.now(), maxAge = FEED_MAX_AGE_MS) {
  return Number(fetchedAt) > 0 && now - Number(fetchedAt) < maxAge;
}

export { parseReleaseNotesFeed, releaseNotesFeedUrl, RELEASE_NOTES_VERSION };
