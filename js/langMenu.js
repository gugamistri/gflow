/**
 * Player multi-idioma “como um filme” (PRD multi-idioma §4, §5.5, RF20–RF24).
 * Áudio, Texto (balões, passos fixos, legenda) e Legenda (CC) escolhidos pelo visitante.
 * Ordem: ?lang/?audio/?cc → sessionStorage → navigator.languages → idioma de origem.
 */
import { t } from "./i18n.js";
import { flagSvg } from "./flags.js";
import { GEAR_ICON, captionsOn, onCaptionsChange, setCaptions } from "./playerControls.js";
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
  // why: Q1 — sem áudio no idioma do texto cai para a origem; sem áudio na origem, fica sem áudio (não toca outro idioma)
  if (!audio) audio = pickAudio(text) || (audios.includes(source) ? source : "none");
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
 * Novo estado após um clique no menu. why: o 1º grupo é Áudio — quem escolhe "English" ali espera ver o
 * texto em inglês também; escolher o áudio leva o texto junto (se houver texto no idioma). Texto e legenda
 * continuam independentes (áudio pt + texto en: escolha o áudio e depois o texto).
 */
export function applyLangChoice(state, group, value, textLangs = []) {
  const s = { ...state };
  if (group === "cc") s.cc = value === "on";
  else s[group] = value;
  if (group === "audio" && value !== "none") {
    const text = matchLang(textLangs, value);
    if (text) s.text = text;
  }
  return s;
}

/**
 * Engrenagem ⚙ + menu de configurações estilo YouTube (RF20, #86): Legendas · Áudio · Texto, com o valor atual à
 * direita e › para o submenu de idiomas (bandeiras SVG). O botão CC da barra liga/desliga a legenda com um clique.
 */
export function createLangMenu({ demo, getState, onChange }) {
  const langs = playerLangs(demo);
  const audios = audioLangs(demo);
  let btn = null;
  let menu = null;
  let open = false;
  let view = "main";
  let outside = null;
  let offCc = null;
  let onResize = null;

  const groups = () => {
    const s = getState();
    const ccValue = s.cc && captionsOn() ? s.text : "off";
    return [
      {
        id: "cc",
        title: t("player.captions"),
        value: ccValue,
        valueLabel: ccValue === "off" ? t("player.ccOff") : langLabel(ccValue),
        options: [{ value: "off", label: t("player.ccOff") }, ...langs.map((l) => ({ value: l, label: langLabel(l), flag: l }))],
      },
      {
        id: "audio",
        title: t("player.langAudio"),
        value: s.audio,
        valueLabel: s.audio === "none" ? t("player.langNoAudio") : langLabel(s.audio),
        options: [
          ...audios.map((a) => ({ value: a.lang, label: `${langLabel(a.lang)}${a.partial ? ` ${t("player.langPartial")}` : ""}`, flag: a.lang })),
          { value: "none", label: t("player.langNoAudio") },
        ],
      },
      {
        id: "text",
        title: t("player.langText"),
        value: s.text,
        valueLabel: langLabel(s.text),
        options: langs.map((l) => ({ value: l, label: langLabel(l), flag: l })),
      },
    ];
  };

  function choose(group, value) {
    const cur = getState();
    let next;
    if (group === "cc") next = value === "off" ? { ...cur, cc: false } : { ...cur, cc: true, text: value };
    else next = applyLangChoice(cur, group, value, langs);
    onChange(next);
    setCaptions(next.cc);
    view = "main";
    close();
    btn?.focus();
  }

  function el(tag, cls, attrs = {}) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }

  function renderMain() {
    const list = el("div", "gf-set-list", { role: "none" });
    for (const g of groups()) {
      const b = el("button", "gf-set-item", { type: "button", role: "menuitem", "aria-haspopup": "menu", "data-group": g.id });
      const flag = g.value && g.value !== "off" && g.value !== "none" ? flagSvg(g.value) : "";
      b.innerHTML = `<span class="gf-set-label"></span><span class="gf-set-value">${flag}<span class="gf-set-value-text"></span></span><span class="gf-set-chev" aria-hidden="true">›</span>`;
      b.querySelector(".gf-set-label").textContent = g.title;
      b.querySelector(".gf-set-value-text").textContent = g.valueLabel;
      b.setAttribute("aria-label", `${g.title}: ${g.valueLabel}`);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        view = g.id;
        paint();
        focusFirst();
      });
      list.append(b);
    }
    return list;
  }

  function renderSub(g) {
    const wrap = el("div", "gf-set-list", { role: "none" });
    const back = el("button", "gf-set-back", { type: "button", role: "menuitem", "data-back": "1" });
    back.innerHTML = `<span class="gf-set-chev" aria-hidden="true">‹</span><span></span>`;
    back.lastChild.textContent = g.title;
    back.setAttribute("aria-label", `${t("player.back")}: ${g.title}`);
    back.addEventListener("click", (e) => {
      e.stopPropagation();
      const from = view;
      view = "main";
      paint();
      menu.querySelector(`[data-group="${from}"]`)?.focus();
    });
    wrap.append(back);
    for (const o of g.options) {
      const checked = o.value === g.value;
      const b = el("button", "gf-set-item gf-set-radio", { type: "button", role: "menuitemradio", "aria-checked": checked ? "true" : "false", "data-group": g.id, "data-value": o.value });
      b.innerHTML = `<span class="gf-set-check" aria-hidden="true">${checked ? "✓" : ""}</span>${o.flag ? flagSvg(o.flag) : '<span class="gf-flag-space" aria-hidden="true"></span>'}<span class="gf-set-label"></span>`;
      b.querySelector(".gf-set-label").textContent = o.label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        choose(g.id, o.value);
      });
      wrap.append(b);
    }
    return wrap;
  }

  function paint() {
    if (!btn) return;
    btn.innerHTML = GEAR_ICON;
    btn.setAttribute("aria-label", t("player.settings"));
    btn.title = t("player.settings");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!menu) return;
    menu.setAttribute("aria-label", t("player.settings"));
    const g = groups().find((x) => x.id === view);
    menu.replaceChildren(g ? renderSub(g) : renderMain());
  }

  function items() {
    return [...menu.querySelectorAll("button")];
  }

  function focusFirst() {
    (menu.querySelector('[aria-checked="true"]') || items()[view === "main" ? 0 : 1] || items()[0])?.focus();
  }

  function place() {
    if (!menu || !btn) return;
    const r = btn.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  }

  function close() {
    open = false;
    view = "main";
    if (menu) menu.hidden = true;
    btn?.setAttribute("aria-expanded", "false");
    btn?.classList.remove("is-open");
  }

  function toggle() {
    open = !open;
    view = "main";
    paint();
    menu.hidden = !open;
    btn.classList.toggle("is-open", open);
    if (open) {
      place();
      items()[0]?.focus();
    }
  }

  function mount(host) {
    if (btn?.isConnected) return;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gf-player-ctl gf-settings-btn";
    btn.setAttribute("aria-haspopup", "menu");
    btn.dataset.ctl = "settings";
    menu = document.createElement("div");
    menu.className = "gf-settings-menu";
    menu.setAttribute("role", "menu");
    menu.id = `gf-settings-${Math.random().toString(36).slice(2, 8)}`;
    btn.setAttribute("aria-controls", menu.id);
    menu.hidden = true;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    menu.addEventListener("keydown", (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      const cur = document.activeElement;
      if (e.key === "Escape" || (e.key === "ArrowLeft" && view !== "main")) {
        e.preventDefault();
        e.stopPropagation();
        if (view !== "main") menu.querySelector("[data-back]")?.click();
        else { close(); btn.focus(); }
      } else if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
      else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
      else if (e.key === "ArrowRight" && view === "main" && cur?.dataset.group) { e.preventDefault(); cur.click(); }
      else if (e.key === "Tab") { close(); }
    });
    menu.addEventListener("focusout", (e) => {
      if (open && e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== btn) close();
    });
    for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
      menu.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    outside = (e) => { if (open && !menu.contains(e.target) && !btn.contains(e.target)) close(); };
    document.addEventListener("click", outside);
    onResize = () => { if (open) place(); };
    window.addEventListener("resize", onResize);
    // why: o botão CC da barra muda a legenda; o estado do idioma (sessão/analytics) acompanha sem reiniciar o passo
    offCc = onCaptionsChange((on) => {
      const s = getState();
      if (s && s.cc !== on) onChange({ ...s, cc: on });
      paint();
    });
    host.append(btn);
    document.body.append(menu);
    paint();
  }

  function destroy() {
    if (outside) document.removeEventListener("click", outside);
    if (onResize) window.removeEventListener("resize", onResize);
    offCc?.();
    outside = null;
    onResize = null;
    offCc = null;
    btn?.remove();
    menu?.remove();
    btn = null;
    menu = null;
    open = false;
  }

  return { mount, paint, close, destroy, isMounted: () => Boolean(btn?.isConnected) };
}
