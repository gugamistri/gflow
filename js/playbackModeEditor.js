/**
 * Editor: "Modo de exibição" do tour (Tour guiado | Galeria), só em ⚙ Preferências do projeto.
 * Trocar o rádio grava `playback.mode` e marca o projeto como alterado.
 * O selo no botão Preview só mostra que a prévia será a galeria; não troca o modo.
 */
import { playbackMode, setPlaybackMode } from "./tour-schema/playbackMode.js";

export const PLAYBACK_MODE_RADIO = 'input[name="playback-mode"]';

/** Pinta os rádios do ⚙ e o selo do Preview com o modo do tour. */
export function paintPlaybackMode(doc, demo, t = (k) => k) {
  const mode = playbackMode(demo?.playback);
  for (const input of doc.querySelectorAll(PLAYBACK_MODE_RADIO)) input.checked = input.value === mode;
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
}
