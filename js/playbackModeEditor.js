/**
 * Editor: "Modo de exibição" do tour (Tour guiado | Galeria), em ⚙ Preferências do projeto e no menu ▾ do Preview.
 * Os dois controles mostram o mesmo valor (`playback.mode`); trocar marca o projeto como alterado.
 */
import { playbackMode, setPlaybackMode } from "./tour-schema/playbackMode.js";

export const PLAYBACK_MODE_RADIO = 'input[name="playback-mode"]';
export const PLAYBACK_MODE_MENU = "[data-playback-mode]";

/** Pinta rádios, itens do menu e o aviso da Galeria com o modo do tour. */
export function paintPlaybackMode(doc, demo, t = (k) => k) {
  const mode = playbackMode(demo?.playback);
  for (const input of doc.querySelectorAll(PLAYBACK_MODE_RADIO)) input.checked = input.value === mode;
  for (const item of doc.querySelectorAll(PLAYBACK_MODE_MENU)) item.setAttribute("aria-checked", item.dataset.playbackMode === mode ? "true" : "false");
  const note = doc.getElementById("playback-mode-note");
  if (note) note.hidden = mode !== "gallery";
  const badge = doc.getElementById("preview-mode-badge");
  if (badge) {
    badge.hidden = mode !== "gallery";
    badge.textContent = t("mode.gallery");
  }
  return mode;
}

/** Aplica o modo ao tour. true = mudou. */
export function applyPlaybackMode(demo, mode) {
  if (!demo) return false;
  const before = playbackMode(demo.playback);
  demo.playback = setPlaybackMode(demo.playback, mode);
  return playbackMode(demo.playback) !== before;
}

/** Liga os controles. `onChanged(mode)` roda depois de gravar (salvar/undo/colaboração ficam com o editor). */
export function bindPlaybackModeControls(doc, { getDemo, onChanged, t = (k) => k } = {}) {
  const set = (mode) => {
    const demo = getDemo?.();
    if (!applyPlaybackMode(demo, mode)) {
      paintPlaybackMode(doc, demo, t);
      return;
    }
    paintPlaybackMode(doc, demo, t);
    onChanged?.(playbackMode(demo.playback));
  };
  for (const input of doc.querySelectorAll(PLAYBACK_MODE_RADIO)) {
    input.addEventListener("change", () => {
      if (input.checked) set(input.value);
    });
  }
  for (const item of doc.querySelectorAll(PLAYBACK_MODE_MENU)) {
    item.addEventListener("click", () => {
      set(item.dataset.playbackMode);
      item.closest("details")?.removeAttribute("open");
    });
  }
}
