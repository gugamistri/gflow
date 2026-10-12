/**
 * Controles do player: pausar o avanço automático e silenciar o som (WCAG 2.2.2 e 1.4.2).
 * why: o tour publicado avança sozinho e fala; o visitante precisa parar os dois.
 * A escolha vale para a sessão (sessionStorage).
 */
import { t } from "./i18n.js";

const PAUSE_KEY = "gf-player-paused";
const MUTE_KEY = "gf-player-muted";

const ICONS = {
  pause:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  sound:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  muted:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

function readFlag(key) {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key, on) {
  try {
    sessionStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* sessão privada: vale só nesta página */
  }
}

/** Atalho do player? Ignora campos, botões focados (Espaço) e combinações com modificadores. */
export function playerShortcut(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return "";
  const target = e.target;
  const tag = target?.tagName || "";
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || target?.isContentEditable) return "";
  const key = String(e.key || "").toLowerCase();
  if (key === "k") return "pause";
  if (key === " " || e.code === "Space") {
    if (/^(BUTTON|A|SUMMARY)$/.test(tag)) return "";
    return "pause";
  }
  if (key === "m") return "mute";
  return "";
}

export function createPlayerControls({ onPauseChange, onMuteChange } = {}) {
  let paused = readFlag(PAUSE_KEY);
  let muted = readFlag(MUTE_KEY);
  let root = null;
  let pauseBtn = null;
  let muteBtn = null;
  let canPause = true;

  function paint() {
    if (!root) return;
    pauseBtn.hidden = !canPause;
    pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
    pauseBtn.innerHTML = paused ? ICONS.play : ICONS.pause;
    const pauseLabel = paused ? t("player.resumeAuto") : t("player.pauseAuto");
    pauseBtn.setAttribute("aria-label", t("player.pauseAuto"));
    pauseBtn.title = `${pauseLabel} (K)`;
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.innerHTML = muted ? ICONS.muted : ICONS.sound;
    muteBtn.setAttribute("aria-label", t("player.muteSound"));
    muteBtn.title = `${muted ? t("player.unmuteSound") : t("player.muteSound")} (M)`;
    root.setAttribute("aria-label", t("player.controls"));
  }

  function ensure() {
    if (root?.isConnected) return root;
    root = document.createElement("div");
    root.className = "gf-player-controls";
    root.setAttribute("role", "group");
    root.hidden = true;
    pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.className = "gf-player-ctl";
    pauseBtn.dataset.ctl = "pause";
    muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.className = "gf-player-ctl";
    muteBtn.dataset.ctl = "mute";
    // why: pointerdown não pode chegar ao véu do Driver (fecharia o tour)
    for (const b of [pauseBtn, muteBtn]) b.addEventListener("pointerdown", (e) => e.stopPropagation());
    pauseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setPaused(!paused, { announce: true });
    });
    muteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMuted(!muted, { announce: true });
    });
    root.append(pauseBtn, muteBtn);
    document.body.append(root);
    paint();
    return root;
  }

  function setPaused(value, { announce = false } = {}) {
    paused = Boolean(value);
    writeFlag(PAUSE_KEY, paused);
    paint();
    onPauseChange?.(paused, { announce });
  }

  function setMuted(value, { announce = false } = {}) {
    muted = Boolean(value);
    writeFlag(MUTE_KEY, muted);
    paint();
    onMuteChange?.(muted, { announce });
  }

  return {
    show({ pausable = true } = {}) {
      canPause = pausable;
      ensure().hidden = false;
      paint();
    },
    hide() {
      if (root) root.hidden = true;
    },
    togglePause() {
      if (!canPause) return;
      setPaused(!paused, { announce: true });
    },
    toggleMute() {
      setMuted(!muted, { announce: true });
    },
    isPaused: () => paused,
    isMuted: () => muted,
    refresh: paint,
  };
}

/** Região aria-live educada para anunciar troca de passo e estado dos controles. */
export function createLiveAnnouncer() {
  let el = null;
  return function announce(text) {
    if (!el?.isConnected) {
      el = document.createElement("div");
      el.className = "gf-sr-only";
      el.setAttribute("aria-live", "polite");
      el.setAttribute("aria-atomic", "true");
      el.setAttribute("role", "status");
      document.body.append(el);
    }
    el.textContent = "";
    // why: limpar e escrever no próximo quadro faz o leitor repetir mesmo texto igual
    requestAnimationFrame(() => {
      el.textContent = String(text || "");
    });
  };
}
