/**
 * Exportar por idioma (PRD multi-idioma RF25–RF27).
 * why: o vídeo usa o idioma exportado (Q4); o HTML leva todos os idiomas habilitados e um seletor.
 */
import { baseLang, langLabel, matchLang, projectI18n, resolveContent } from "./tour-schema/i18n.js";

/** Idiomas exportáveis: origem + alvos habilitados. [] quando o projeto é monolíngue. */
export function exportLangs(project) {
  const cfg = projectI18n(project);
  if (!cfg) return [];
  const targets = cfg.langs.filter((l) => l.enabled !== false).map((l) => l.lang);
  if (!targets.length) return [];
  return [cfg.defaultLang, ...targets];
}

/** Tour do vídeo num idioma: texto e áudio nesse idioma (áudio cai para a origem), legenda opcional. */
export function videoDemoForLang(project, lang, { cc = true } = {}) {
  const view = lang ? resolveContent(project, lang, { audioLang: lang }) : { ...project };
  const out = { ...view };
  delete out.textLang;
  delete out.audioLang;
  delete out.fallback;
  delete out.audioFallback;
  if (!cc) out.steps = (out.steps || []).map((s) => ({ ...s, showCaption: false }));
  return out;
}

/** `tour-nome.pt-BR.mp4` (RF25); sem idioma, o nome de sempre. */
export function langFileName(base, lang, ext) {
  return lang ? `${base}.${lang}.${ext}` : `${base}.${ext}`;
}

const STEP_KEYS = ["popover", "caption", "label", "alt", "narrationAudio", "title", "text"];

/**
 * Sobreposições por idioma para o HTML exportado (RF26): só textos e áudio, sem imagens
 * (as capturas são compartilhadas). { defaultLang, langs: [{ lang, label }], overlays }
 */
export function htmlLangData(project) {
  const langs = exportLangs(project);
  if (!langs.length) return null;
  const cfg = projectI18n(project);
  const overlays = {};
  for (const lang of langs.slice(1)) {
    const v = resolveContent(project, lang, { audioLang: lang });
    const steps = {};
    for (const s of v.steps || []) {
      const o = {};
      for (const k of STEP_KEYS) if (s[k] !== undefined) o[k] = s[k];
      steps[s.id] = o;
    }
    overlays[lang] = { name: v.name, steps, startStep: v.startStep, endStep: v.endStep };
  }
  return { defaultLang: cfg.defaultLang, langs: langs.map((l) => ({ lang: l, label: langLabel(l) })), overlays };
}

/** Escolha do idioma no HTML exportado: ?lang= > sessão > navegador > origem (§4.2). */
export function pickHtmlLang(data, { query = "", stored = "", browser = [] } = {}) {
  const available = data.langs.map((l) => l.lang);
  for (const want of [query, stored, ...browser]) {
    const hit = want && matchLang(available, want);
    if (hit) return hit;
  }
  return data.defaultLang;
}

/**
 * Script clássico (sem módulos) que roda antes do player autônomo: aplica o idioma escolhido
 * em window.INTERACTIVE_DEMO e põe um seletor no topo. Trocar recarrega a página.
 */
export function htmlLangScript(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `(function(){
var D=${json};
var KEY="gf-html-lang";
function base(t){return String(t||"").toLowerCase().split("-")[0];}
function match(list,want){if(!want)return "";var w=String(want);for(var i=0;i<list.length;i++)if(list[i].toLowerCase()===w.toLowerCase())return list[i];for(var j=0;j<list.length;j++)if(base(list[j])===base(w))return list[j];return "";}
var av=D.langs.map(function(l){return l.lang;});
var q="";try{q=new URLSearchParams(location.search).get("lang")||"";}catch(e){}
var st="";try{st=sessionStorage.getItem(KEY)||"";}catch(e){}
var nav=(navigator.languages||[navigator.language||""]);
var lang=D.defaultLang;var cands=[q,st].concat(nav);
for(var k=0;k<cands.length;k++){var h=match(av,cands[k]);if(h){lang=h;break;}}
var demo=window.INTERACTIVE_DEMO;var ov=D.overlays[lang];
if(demo&&ov){if(ov.name)demo.name=ov.name;(demo.steps||[]).forEach(function(s){var o=ov.steps[s.id];if(o)for(var key in o)s[key]=o[key];});if(ov.startStep)demo.startStep=ov.startStep;if(ov.endStep)demo.endStep=ov.endStep;}
document.documentElement.lang=lang;
document.addEventListener("DOMContentLoaded",function(){var bar=document.querySelector(".topbar");if(!bar)return;var sel=document.createElement("select");sel.className="gf-html-lang";sel.setAttribute("aria-label","Idioma / Language");D.langs.forEach(function(l){var o=document.createElement("option");o.value=l.lang;o.textContent=l.label;if(l.lang===lang)o.selected=true;sel.appendChild(o);});sel.addEventListener("change",function(){try{sessionStorage.setItem(KEY,sel.value);}catch(e){}var u=new URL(location.href);u.searchParams.delete("lang");location.href=u.toString();});bar.appendChild(sel);});
})();`;
}

/** zh/ja/ko não usam espaço: a legenda queimada quebra por caractere (§10). */
export function isCjkText(text) {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(String(text || ""));
}

/** Quebra por largura medida; palavras longas sem espaço (CJK) quebram por caractere. */
export function wrapTextUnits(measure, text, maxWidth) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const units = isCjkText(clean) ? Array.from(clean.replace(/ /g, " ")) : clean.split(" ");
  const joiner = isCjkText(clean) ? "" : " ";
  const lines = [];
  let line = "";
  for (const u of units) {
    const test = line ? line + joiner + u : u;
    if (measure(test) > maxWidth && line) {
      lines.push(joiner ? line : line.trim());
      line = joiner ? u : u.trimStart();
    } else {
      line = test;
    }
  }
  if (line) lines.push(joiner ? line : line.trim());
  return lines;
}

/** WebVTT por idioma com os tempos por passo (RF27). steps: [{ caption, startMs, endMs }] */
export function buildVtt(cues) {
  const ts = (ms) => {
    const t = Math.max(0, Math.round(ms));
    const h = String(Math.floor(t / 3600000)).padStart(2, "0");
    const m = String(Math.floor((t % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((t % 60000) / 1000)).padStart(2, "0");
    return `${h}:${m}:${s}.${String(t % 1000).padStart(3, "0")}`;
  };
  const body = cues
    .filter((c) => String(c.text || "").trim())
    .map((c, i) => `${i + 1}\n${ts(c.startMs)} --> ${ts(c.endMs)}\n${String(c.text).trim()}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

export { baseLang };
