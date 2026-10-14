/**
 * Player multi-idioma “como um filme” (PRD multi-idioma §4, §5.5, RF20–RF24).
 * Áudio, Texto (balões, passos fixos, legenda) e Legenda (CC) escolhidos pelo visitante.
 * Ordem: ?lang/?audio/?cc → sessionStorage → navigator.languages → idioma de origem.
 */
import { t } from "./i18n.js";
import { baseLang, langLabel, matchLang, normalizeLangTag, playerLangs, projectI18n } from "./tour-schema/i18n.js";

export const LANG_SESSION_PREFIX = "guiaflow.lang.";

/** Idiomas com algum áudio gravado; `partial` quando falta em algum passo com narração. */
export function audioLangs(demo) {
  const cfg = projectI18n(demo);
  if (!cfg) return [];
  const steps = Array.isArray(demo.steps) ? demo.steps : [];
  const narrated = steps.filter((s) => String(s.caption || "").trim() || s.narrationAudio?.clips?.length);
  const out = [];
  const srcCount = steps.filter((s) => s.narrationAudio?.clips?.length).length;
  if (srcCount) out.push({ lang: cfg.defaultLang, partial: srcCount < narrated.length });
  for (const l of cfg.langs) {
    if (!l.enabled) continue;
    const n = steps.filter((s) => s.i18n?.[l.lang]?.narrationAudio?.clips?.length).length;
    if (n) out.push({ lang: l.lang, partial: n < narrated.length });
  }
  return out;
}

function parseParams(search) {
  const p = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const cc = p.get("cc");
  return {
    lang: p.get("lang") || "",
    audio: p.get("audio") || "",
    cc: cc === "0" ? false : cc === "1" ? true : null,
  };
}

/** Estado inicial { text, audio, cc } (§4.2; Q1: texto e áudio seguem o navegador). */
export function resolvePlayerLangs(demo, { search = "", stored = null, languages = [] } = {}) {
  const langs = playerLangs(demo);
  if (langs.length < 2) return null;
  const source = langs[0];
  const audios = audioLangs(demo).map((a) => a.lang);
  const params = parseParams(search);
  const pickText = (v) => matchLang(langs, v);
  const pickAudio = (v) => (v === "none" ? "none" : matchLang(audios, v));
  let text = pickText(params.lang) || pickText(stored?.text);
  if (!text) for (const l of languages) if ((text = pickText(l))) break;
  text = text || source;
  let audio = pickAudio(params.audio) || (params.lang ? pickAudio(params.lang) : "") || pickAudio(stored?.audio);
  if (!audio) audio = pickAudio(text) || (audios.includes(source) ? source : audios[0] || source);
  const cc = params.cc ?? (typeof stored?.cc === "boolean" ? stored.cc : true);
  return { text, audio, cc };
}

export function readStoredLangs(id) {
  try {
    const raw = sessionStorage.getItem(LANG_SESSION_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function storeLangs(id, state) {
  try {
    sessionStorage.setItem(LANG_SESSION_PREFIX + id, JSON.stringify({ text: state.text, audio: state.audio, cc: state.cc }));
  } catch {
    /* sessão privada */
  }
}

export function shortTag(lang) {
  return baseLang(lang).toUpperCase();
}

/** `<html lang>` e `dir` do player seguem o idioma do texto (RF23). */
export function applyDocumentLang(lang) {
  const tag = normalizeLangTag(lang);
  if (!tag || typeof document === "undefined") return;
  document.documentElement.lang = tag;
  document.documentElement.dir = "ltr";
}

/**
 * Botão 🌐 + menu (Áudio · Texto · Legenda), com radios `aria-checked` e teclado (RF20, #86).
 */
export function createLangMenu({ demo, getState, onChange }) {
  const langs = playerLangs(demo);
  const audios = audioLangs(demo);
  let btn = null;
  let menu = null;
  let open = false;

  function item(group, value, label, checked) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gf-lang-item";
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", checked ? "true" : "false");
    b.dataset.group = group;
    b.dataset.value = value;
    b.textContent = `${checked ? "✓ " : ""}${label}`;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const s = { ...getState() };
      if (group === "cc") s.cc = value === "on";
      else s[group] = value;
      onChange(s);
      paint();
      btn?.focus();
      close();
    });
    return b;
  }

  function section(title, children) {
    const g = document.createElement("div");
    g.className = "gf-lang-group";
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", title);
    const h = document.createElement("div");
    h.className = "gf-lang-head";
    h.textContent = title;
    g.append(h, ...children);
    return g;
  }

  function paint() {
    if (!btn) return;
    const s = getState();
    btn.textContent = `🌐 ${shortTag(s.text)}`;
    btn.setAttribute("aria-label", t("player.langMenu"));
    btn.title = t("player.langMenu");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!menu) return;
    menu.replaceChildren(
      section(t("player.langAudio"), [
        ...audios.map((a) => item("audio", a.lang, `${langLabel(a.lang)}${a.partial ? ` ${t("player.langPartial")}` : ""}`, s.audio === a.lang)),
        item("audio", "none", t("player.langNoAudio"), s.audio === "none"),
      ]),
      section(t("player.langText"), langs.map((l) => item("text", l, langLabel(l), s.text === l))),
      section(t("player.langCc"), [item("cc", "on", t("player.ccOn"), s.cc), item("cc", "off", t("player.ccOff"), !s.cc)]),
    );
  }

  function close() {
    open = false;
    if (menu) menu.hidden = true;
    btn?.setAttribute("aria-expanded", "false");
  }

  function toggle() {
    open = !open;
    paint();
    menu.hidden = !open;
    if (open) menu.querySelector('[aria-checked="true"]')?.focus();
  }

  function mount(host) {
    if (btn?.isConnected) return;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gf-player-ctl gf-lang-btn";
    btn.setAttribute("aria-haspopup", "menu");
    btn.dataset.ctl = "lang";
    menu = document.createElement("div");
    menu.className = "gf-lang-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll(".gf-lang-item")];
      const i = items.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    });
    for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
      menu.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    document.addEventListener("click", (e) => { if (open && !menu.contains(e.target) && e.target !== btn) close(); });
    host.prepend(btn);
    document.body.append(menu);
    paint();
  }

  return { mount, paint, close, isMounted: () => Boolean(btn?.isConnected) };
}
