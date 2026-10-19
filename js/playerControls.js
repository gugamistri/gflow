/**
 * Controles do player: pausar, silenciar, reprodução automática e legendas (WCAG 2.2.2 e 1.4.2).
 * why: o tour publicado avança sozinho e fala; o visitante precisa parar os dois.
 * A escolha vale para a sessão (sessionStorage).
 */
import { t } from "./i18n.js";

const PAUSE_KEY = "gf-player-paused";
const MUTE_KEY = "gf-player-muted";
const CC_KEY = "gf-player-cc";

const ICONS = {
  pause:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  sound:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  muted:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  cc: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11.5h3.5M12.5 11.5H17M7 15h6M15 15h2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  knobPlay: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 7v10l8-5z"/></svg>',
  knobPause: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="7" width="3" height="10" rx=".8"/><rect x="13" y="7" width="3" height="10" rx=".8"/></svg>',
};

/** Ícone da engrenagem (botão de configurações do menu de idioma). */
export const GEAR_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M10.3 3h3.4l.5 2.5 1.8 1 2.4-.9 1.7 2.9-1.9 1.7v2.1l1.9 1.7-1.7 2.9-2.4-.9-1.8 1-.5 2.5h-3.4l-.5-2.5-1.8-1-2.4.9-1.7-2.9 1.9-1.7v-2.1L3.9 9.5l1.7-2.9 2.4.9 1.8-1z"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

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

/* ---- Legendas (CC): estado único da página, usado pelo botão CC e pelo menu ⚙ › Legendas ---- */
let ccOn = (() => {
  try {
    return sessionStorage.getItem(CC_KEY) !== "0";
  } catch {
    return true;
  }
})();
const ccListeners = new Set();

export function captionsOn() {
  return ccOn;
}

/** Liga/desliga a legenda sem reiniciar o passo (a barra some por CSS: body.gf-cc-off). */
export function setCaptions(on) {
  const next = Boolean(on);
  if (typeof document !== "undefined") document.body?.classList.toggle("gf-cc-off", !next);
  if (next === ccOn) return;
  ccOn = next;
  writeFlag(CC_KEY, ccOn);
  for (const fn of [...ccListeners]) fn(ccOn);
}

export function onCaptionsChange(fn) {
  ccListeners.add(fn);
  return () => ccListeners.delete(fn);
}

/** Atalho do player (estilo YouTube)? Ignora campos, botões focados (Espaço) e combinações com modificadores. */
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
  if (key === "c") return "cc";
  return "";
}

function ctlButton(ctl, extra = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `gf-player-ctl${extra ? ` ${extra}` : ""}`;
  b.dataset.ctl = ctl;
  return b;
}

/**
 * Barra única do player (estilo YouTube): pausar · som | reprodução automática · legendas (CC) · ⚙ (menu de idioma).
 * why: WCAG 2.2.2 / 1.4.2 — pausar e silenciar ficam sempre à mão; o ⚙ entra pelo langMenu quando há idiomas.
 */
export function createPlayerControls({ onPauseChange, onMuteChange, onAutoplayChange } = {}) {
  let paused = readFlag(PAUSE_KEY);
  let muted = readFlag(MUTE_KEY);
  let autoplay = false;
  let hasCaptions = false;
  let root = null;
  let pauseBtn = null;
  let muteBtn = null;
  let autoBtn = null;
  let ccBtn = null;

  function paint() {
    if (!root) return;
    pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
    pauseBtn.innerHTML = paused ? ICONS.play : ICONS.pause;
    pauseBtn.setAttribute("aria-label", t("player.pause"));
    pauseBtn.title = `${paused ? t("player.play") : t("player.pause")} (k)`;
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.innerHTML = muted ? ICONS.muted : ICONS.sound;
    muteBtn.setAttribute("aria-label", t("player.muteSound"));
    muteBtn.title = `${muted ? t("player.unmuteSound") : t("player.muteSound")} (m)`;
    autoBtn.setAttribute("aria-pressed", autoplay ? "true" : "false");
    autoBtn.innerHTML = `<span class="gf-switch" aria-hidden="true"><span class="gf-switch-knob">${autoplay ? ICONS.knobPlay : ICONS.knobPause}</span></span>`;
    autoBtn.setAttribute("aria-label", t("player.autoplay"));
    autoBtn.title = `${t("player.autoplay")}: ${autoplay ? t("player.ccOn") : t("player.ccOff")}`;
    ccBtn.hidden = !hasCaptions;
    ccBtn.setAttribute("aria-pressed", ccOn ? "true" : "false");
    ccBtn.innerHTML = ICONS.cc;
    ccBtn.setAttribute("aria-label", t("player.captions"));
    ccBtn.title = `${t("player.captions")}: ${ccOn ? t("player.ccOn") : t("player.ccOff")} (c)`;
    root.setAttribute("aria-label", t("player.controls"));
  }

  function ensure() {
    if (root?.isConnected) return root;
    root = document.createElement("div");
    root.className = "gf-player-controls";
    root.setAttribute("role", "group");
    root.hidden = true;
    pauseBtn = ctlButton("pause");
    muteBtn = ctlButton("mute");
    autoBtn = ctlButton("autoplay", "gf-autoplay-btn");
    ccBtn = ctlButton("cc", "gf-cc-btn");
    const sep = document.createElement("span");
    sep.className = "gf-player-sep";
    sep.setAttribute("aria-hidden", "true");
    // why: pointerdown não pode chegar ao véu do Driver (fecharia o tour)
    // (toque/clique nos controles nunca conta como "fora do tour" nem como gesto de passo)
    for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
      root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    pauseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setPaused(!paused, { announce: true });
    });
    muteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMuted(!muted, { announce: true });
    });
    autoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setAutoplay(!autoplay, { announce: true });
    });
    ccBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCaptions();
    });
    root.append(pauseBtn, muteBtn, sep, autoBtn, ccBtn);
    document.body.append(root);
    onCaptionsChange(paint);
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

  function setAutoplay(value, { announce = false } = {}) {
    autoplay = Boolean(value);
    paint();
    onAutoplayChange?.(autoplay, { announce });
  }

  function toggleCaptions() {
    if (!hasCaptions) return;
    setCaptions(!ccOn);
    paint();
  }

  return {
    /** autoplay: estado inicial do toggle (Preview manual = desligado; Assistir/tour publicado = ligado). */
    show({ autoplay: auto = autoplay, captions = hasCaptions } = {}) {
      autoplay = Boolean(auto);
      hasCaptions = Boolean(captions);
      ensure().hidden = false;
      document.body.classList.add("gf-player-on");
      setCaptions(ccOn);
      paint();
    },
    hide() {
      if (root) root.hidden = true;
      document.body.classList.remove("gf-player-on");
    },
    togglePause() {
      setPaused(!paused, { announce: true });
    },
    toggleMute() {
      setMuted(!muted, { announce: true });
    },
    toggleCaptions,
    setAutoplay,
    isPaused: () => paused,
    isMuted: () => muted,
    isAutoplay: () => autoplay,
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
