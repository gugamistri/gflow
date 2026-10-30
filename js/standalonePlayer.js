
function gfT(key, vars) {
  const cat = (typeof window !== "undefined" && window.__GF_I18N) || {};
  let text = cat[key] || key;
  if (vars && typeof vars === "object") {
    text = String(text).replace(/\{(\w+)\}/g, (_, name) =>
      vars[name] != null ? String(vars[name]) : "{" + name + "}"
    );
  }
  return text;
}

/** Cópia de escapeHtml (js/htmlText.js): este arquivo é script clássico, sem imports. */
function gfEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* <gf-rich-text> cópia gerada de js/tour-schema/richText.js (node scripts/sync-rich-text.mjs) */
var gfRichText = (function () {
/**
 * Formatação leve dos textos do tour: texto do balão, corpo do slide e corpo dos passos inicial/final.
 * Guardado como marcadores de texto, nunca HTML:
 *   **negrito**   *itálico*   ++sublinhado++   "- " no começo da linha = item de lista (1 nível)
 * `\*`, `\+`, `\-` e `\\` mostram o caractere literal. Título e narração continuam texto puro.
 *
 * Regras que deixam texto antigo igual: marcador sem par fica literal ("*Imagens ilustrativas"),
 * `*` colado em letra/número não abre nem fecha itálico ("5*10*2"), o marcador não atravessa linhas
 * e precisa de texto (não espaço) logo depois de abrir e logo antes de fechar.
 *
 * Puro: o render monta nós com `doc.createElement`/`createTextNode` (sem innerHTML de texto do autor);
 * `richTextHtml` é só para APIs que exigem HTML (driver.js) e junta trechos já escapados.
 * O player do HTML offline (js/standalonePlayer.js) tem uma cópia inline, conferida em teste.
 */

const RICH_TEXT_MARKERS = Object.freeze({ bold: "**", italic: "*", underline: "++", list: "- " });

const OPENERS = [
  ["**", "b"],
  ["++", "u"],
  ["*", "i"],
];
const ESCAPABLE = "*+-\\";
const WORD_RE = /[\p{L}\p{N}]/u;
const LIST_RE = /^[ \t]{0,3}- (.*)$/;

const isSpace = (ch) => ch === undefined || /\s/.test(ch);
const isWord = (ch) => ch !== undefined && WORD_RE.test(ch);

function runLength(s, pos, ch) {
  let n = 0;
  while (s[pos + n] === ch) n++;
  return n;
}

function validOpener(s, pos, mark) {
  const next = s[pos + mark.length];
  if (isSpace(next)) return false;
  if (mark === "*") return !isWord(s[pos - 1]);
  return true;
}

function validCloser(s, pos, mark) {
  if (isSpace(s[pos - 1])) return false;
  if (mark === "*") {
    // "**" sozinho é negrito, não fecha itálico; "***" fecha o itálico e deixa "**" para o negrito
    if (runLength(s, pos, "*") === 2) return false;
    return !isWord(s[pos + 1]);
  }
  return true;
}

/** Só marcadores ("****") não formatam: precisa de algum caractere de verdade dentro. */
function hasContent(nodes) {
  return nodes.some((n) => (n.t === "text" ? /[^*+\s]/.test(n.v) : hasContent(n.c)));
}

function pushText(nodes, text) {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last && last.t === "text") last.v += text;
  else nodes.push({ t: "text", v: text });
}

/** Maior linha com formatação inline; acima disso a linha sai como texto (limita o custo do parser). */
const RICH_TEXT_MAX_LINE = 6000;

/**
 * Lê do índice `pos` até achar `stop` (fechamento válido) ou o fim.
 * why: `ctx.next[mark][i]` = primeiro fechamento válido ≥ i — abertura sem fechamento adiante nem é
 * tentada, e `ctx.failed` lembra tentativas que já falharam: o custo fica perto de linear.
 */
function parseRun(ctx, pos, stop, open) {
  const s = ctx.s;
  const nodes = [];
  let buf = "";
  while (pos < s.length) {
    const ch = s[pos];
    if (ch === "\\" && ESCAPABLE.includes(s[pos + 1] ?? "\u0000")) {
      buf += s[pos + 1];
      pos += 2;
      continue;
    }
    if (stop && s.startsWith(stop, pos) && validCloser(s, pos, stop)) {
      pushText(nodes, buf);
      return { nodes, pos, closed: true };
    }
    let matched = false;
    for (const [mark, type] of OPENERS) {
      if (open.includes(type) || !s.startsWith(mark, pos) || !validOpener(s, pos, mark)) continue;
      const from = pos + mark.length;
      if (ctx.next[mark][Math.min(from + 1, s.length)] === Infinity) continue;
      const key = `${from}|${mark}|${open}`;
      if (ctx.failed.has(key)) continue;
      const inner = parseRun(ctx, from, mark, open + type);
      if (inner.closed && hasContent(inner.nodes)) {
        pushText(nodes, buf);
        buf = "";
        nodes.push({ t: type, c: inner.nodes });
        pos = inner.pos + mark.length;
        matched = true;
        break;
      }
      ctx.failed.add(key);
    }
    if (matched) continue;
    buf += ch;
    pos += 1;
  }
  pushText(nodes, buf);
  return { nodes, pos, closed: false };
}

function closerIndex(s, mark) {
  const next = new Array(s.length + 1).fill(Infinity);
  for (let i = s.length - 1; i >= 0; i--) {
    next[i] = s.startsWith(mark, i) && validCloser(s, i, mark) ? i : next[i + 1];
  }
  return next;
}

/** Uma linha → nós inline: { t: "text", v } | { t: "b" | "i" | "u", c: [...] }. */
function parseInline(line) {
  const s = String(line ?? "");
  if (!s) return [];
  if (s.length > RICH_TEXT_MAX_LINE) return [{ t: "text", v: s }];
  const ctx = { s, failed: new Set(), next: { "**": closerIndex(s, "**"), "++": closerIndex(s, "++"), "*": closerIndex(s, "*") } };
  return parseRun(ctx, 0, "", "").nodes;
}

/** Literal "\-" no começo da linha não vira item. */
function listItem(line) {
  const m = LIST_RE.exec(line);
  return m ? m[1] : null;
}

/**
 * Texto → blocos: { t: "line", c: inline[] } (linhas soltas, separadas por quebra) e
 * { t: "list", items: inline[][] } (linhas seguidas que começam com "- ").
 */
function parseRichText(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (const line of lines) {
    const item = listItem(line);
    if (item !== null) {
      const last = blocks[blocks.length - 1];
      const nodes = parseInline(item);
      if (last && last.t === "list") last.items.push(nodes);
      else blocks.push({ t: "list", items: [nodes] });
      continue;
    }
    blocks.push({ t: "line", c: parseInline(line) });
  }
  if (blocks.length === 1 && blocks[0].t === "line" && !blocks[0].c.length) return [];
  return blocks;
}

/** O texto usa alguma formatação (negrito, itálico, sublinhado ou lista)? */
function hasRichFormatting(text) {
  const walk = (nodes) => nodes.some((n) => n.t !== "text");
  return parseRichText(text).some((b) => b.t === "list" || walk(b.c));
}

function inlinePlain(nodes) {
  return nodes.map((n) => (n.t === "text" ? n.v : inlinePlain(n.c))).join("");
}

/**
 * Texto sem marcadores, para narração (TTS), legendas, prompts de IA, alt, meta, contagem de tamanho.
 * Cada item de lista vira uma linha (com `bullet` na frente, ex.: "• ", para imagem/vídeo exportado);
 * com `{ sentences: true }` tudo vira uma linha só; linhas sem pontuação ganham ponto antes da
 * seguinte (a voz faz pausa entre os itens e nunca lê "asterisco"). A última fica como está.
 */
function stripRichText(text, { sentences = false, bullet = "" } = {}) {
  const lines = [];
  for (const b of parseRichText(text)) {
    if (b.t === "line") lines.push(inlinePlain(b.c));
    else for (const item of b.items) lines.push(sentences ? inlinePlain(item) : bullet + inlinePlain(item));
  }
  if (!sentences) return lines.join("\n");
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i, all) => (i === all.length - 1 || /[.!?…:;,]$/.test(l) ? l : `${l}.`))
    .join(" ");
}

/** Tamanho que quem lê vê (sem marcadores). */
function richTextLength(text) {
  return stripRichText(text).length;
}

const TAGS = { b: "strong", i: "em", u: "u" };

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(nodes) {
  return nodes.map((n) => (n.t === "text" ? escapeHtml(n.v) : `<${TAGS[n.t]}>${inlineHtml(n.c)}</${TAGS[n.t]}>`)).join("");
}

/**
 * HTML para APIs que só aceitam string (driver.js). Só sai strong/em/u/ul/li/br, montados aqui;
 * todo texto do autor passa por escapeHtml.
 */
function richTextHtml(text) {
  const out = [];
  let prevLine = false;
  for (const b of parseRichText(text)) {
    if (b.t === "list") {
      const items = b.items.filter((it) => inlinePlain(it).trim());
      if (items.length) out.push(`<ul class="gf-rt-list">${items.map((it) => `<li>${inlineHtml(it)}</li>`).join("")}</ul>`);
      prevLine = false;
    } else {
      if (prevLine) out.push("<br/>");
      out.push(inlineHtml(b.c));
      prevLine = true;
    }
  }
  return out.join("");
}

function appendInline(doc, parent, nodes) {
  for (const n of nodes) {
    if (n.t === "text") parent.appendChild(doc.createTextNode(n.v));
    else {
      const el = doc.createElement(TAGS[n.t]);
      appendInline(doc, el, n.c);
      parent.appendChild(el);
    }
  }
}

/** Monta o texto formatado dentro de `container` (substitui o conteúdo). Só createElement/createTextNode. */
function renderRichText(container, text, doc = container?.ownerDocument) {
  if (!container || !doc) return container;
  while (container.firstChild) container.removeChild(container.firstChild);
  let prevLine = false;
  for (const b of parseRichText(text)) {
    if (b.t === "list") {
      const ul = doc.createElement("ul");
      ul.className = "gf-rt-list";
      for (const item of b.items) {
        if (!inlinePlain(item).trim()) continue;
        const li = doc.createElement("li");
        appendInline(doc, li, item);
        ul.appendChild(li);
      }
      if (ul.firstChild) container.appendChild(ul);
      prevLine = false;
    } else {
      if (prevLine) container.appendChild(doc.createElement("br"));
      appendInline(doc, container, b.c);
      prevLine = true;
    }
  }
  return container;
}

/**
 * Texto vindo de IA, de agente (MCP/REST) ou colado de fora → só o subconjunto aceito.
 * <b>/<strong> → **, <i>/<em> → *, <u> → ++, <li> → "- "; "* " e "• " no começo da linha → "- ";
 * "#" de título some; p/div/ul/ol/span somem (viram quebra). Outras tags e marcadores desconhecidos
 * continuam literais (o render escapa).
 */
function normalizeRichText(text) {
  const TAG_MARK = { b: "**", strong: "**", i: "*", em: "*", u: "++" };
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/<(\/?)(b|strong|i|em|u|li|br|p|div|ul|ol|span)\b[^>]*>/gi, (_, close, name) => {
      const tag = name.toLowerCase();
      if (TAG_MARK[tag]) return TAG_MARK[tag];
      if (tag === "li") return close ? "" : "\n- ";
      if (tag === "br" || ((tag === "p" || tag === "div" || tag === "ul" || tag === "ol") && close)) return "\n";
      return "";
    })
    .split("\n")
    .map((line) => line.replace(/^[ \t]{0,3}[*•·▪◦]\s+/, "- ").replace(/^[ \t]{0,3}#{1,6}\s+/, "").replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

return { parseRichText, renderRichText, richTextHtml, stripRichText };
})();
/* </gf-rich-text> */

/**
 * Player autônomo (arquivo HTML exportado). Script clássico — sem modules.
 * Espera window.INTERACTIVE_DEMO já definido.
 */
(function () {
  const demo = window.INTERACTIVE_DEMO;
  if (!demo || !Array.isArray(demo.steps)) {
    console.error("INTERACTIVE_DEMO ausente ou inválido");
    return;
  }

  const PREV_ARROW_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.5 8L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 3.5L2.5 8L7 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const NEXT_ARROW_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2.5 8H13.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 3.5L13.5 8L9 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    const appearance =
      theme.appearance ||
      (theme.presetId === "social" ? "social" : "documento");
    // Export HTML já traz data-appearance do pack; tema do tour fica em --demo-*
    root.style.setProperty("--demo-accent", theme.accent);
    root.style.setProperty("--demo-accent-dark", theme.accentDark || theme.accent);
    root.style.setProperty("--demo-overlay", theme.overlay);
    root.style.setProperty("--demo-popover-bg", theme.popoverBg);
    root.style.setProperty("--demo-popover-title", theme.title);
    root.style.setProperty("--demo-popover-text", theme.text);
    root.style.setProperty("--demo-button", theme.button);
    root.style.setProperty("--demo-hotspot", theme.hotspot);
    // a fonte do tema (--demo-font) vem no CSS exportado; não sobrescrever aqui
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clickPointFromHotspot(hotspot) {
    const hs = hotspot || { x: 40, y: 40, w: 14, h: 8 };
    return { x: hs.x + hs.w / 2, y: hs.y + hs.h / 2 };
  }

  // why: espelha clampClickToHotspot de store.js — o HTML exportado não importa módulos
  function clampClickToHotspot(point, hs) {
    const ok =
      hs && [hs.x, hs.y, hs.w, hs.h].every(Number.isFinite) && hs.w > 0 && hs.h > 0;
    if (!ok) return point;
    const ix = Math.min(1, hs.w / 2);
    const iy = Math.min(1, hs.h / 2);
    return {
      x: Math.min(Math.max(point.x, hs.x + ix), hs.x + hs.w - ix),
      y: Math.min(Math.max(point.y, hs.y + iy), hs.y + hs.h - iy),
    };
  }

  function ensureClickPoint(step) {
    const raw =
      step?.clickPoint && Number.isFinite(step.clickPoint.x) && Number.isFinite(step.clickPoint.y)
        ? step.clickPoint
        : clickPointFromHotspot(step?.hotspot);
    return clampClickToHotspot(raw, step?.hotspot);
  }

  function clampCover(translate, scaledSize, stageSize) {
    if (scaledSize <= stageSize) return 0;
    const max = (scaledSize - stageSize) / 2;
    return Math.min(max, Math.max(-max, translate));
  }

  function computeZoomCamera(hotspot, imageSize, stageSize, enabled) {
    if (!enabled) return { scale: 1, translateX: 0, translateY: 0 };
    const imgW = Number(imageSize?.w) || 0;
    const imgH = Number(imageSize?.h) || 0;
    const stageW = Number(stageSize?.w) || 0;
    const stageH = Number(stageSize?.h) || 0;
    if (imgW <= 0 || imgH <= 0 || stageW <= 0 || stageH <= 0) {
      return { scale: 1, translateX: 0, translateY: 0 };
    }
    const hs = hotspot || { x: 40, y: 40, w: 12, h: 8 };
    const hsW = Math.max(1, ((Number(hs.w) || 0) / 100) * imgW);
    const hsH = Math.max(1, ((Number(hs.h) || 0) / 100) * imgH);
    const hsCx = (((Number(hs.x) || 0) + (Number(hs.w) || 0) / 2) / 100) * imgW;
    const hsCy = (((Number(hs.y) || 0) + (Number(hs.h) || 0) / 2) / 100) * imgH;
    const fit = Math.min(stageW / hsW, stageH / hsH) * 0.55;
    const scale = Math.min(3.2, Math.max(1, fit));
    const imgCx = imgW / 2;
    const imgCy = imgH / 2;
    let translateX = scale * (imgCx - hsCx);
    let translateY = scale * (imgCy - hsCy);
    translateX = clampCover(translateX, scale * imgW, stageW);
    translateY = clampCover(translateY, scale * imgH, stageH);
    return { scale, translateX, translateY };
  }

  function zoomCameraStyle(camera) {
    const scale = camera?.scale ?? 1;
    const tx = camera?.translateX ?? 0;
    const ty = camera?.translateY ?? 0;
    if (scale === 1 && tx === 0 && ty === 0) {
      return { transform: "none", transformOrigin: "center center" };
    }
    return {
      transform: "translate(" + tx + "px, " + ty + "px) scale(" + scale + ")",
      transformOrigin: "center center",
    };
  }

  function resolveImageSrc(imageRef) {
    if (!imageRef) return "";
    if (imageRef.startsWith("custom:")) {
      const id = imageRef.slice(7);
      return demo.customImages?.[id]?.dataUrl || "";
    }
    return imageRef;
  }

  function hexToRgba(hex, alpha) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const DEFAULT_HOLD_SECONDS = 6;
  const BG_VOLUME = 0.22;
  const BG_DUCK_VOLUME = 0.06;
  const CAPTION_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

  if (!demo.playback || typeof demo.playback !== "object") {
    demo.playback = { defaultHoldSeconds: DEFAULT_HOLD_SECONDS };
  }
  if (!Number.isFinite(Number(demo.playback.defaultHoldSeconds)) || Number(demo.playback.defaultHoldSeconds) <= 0) {
    demo.playback.defaultHoldSeconds = DEFAULT_HOLD_SECONDS;
  }
  if (!demo.narration || typeof demo.narration !== "object") {
    demo.narration = { enabled: true, voiceURI: "", rate: 1, background: null };
  }

  function captionPlaybackRate(rate) {
    const n = Number(rate);
    return CAPTION_PLAYBACK_RATES.includes(n) ? n : 1;
  }

  function resolveHoldSeconds(step) {
    const fromStep = Number(step?.holdSeconds);
    let hold;
    if (Number.isFinite(fromStep) && fromStep > 0) hold = fromStep;
    else {
      const fromDemo = Number(demo.playback.defaultHoldSeconds);
      hold = Number.isFinite(fromDemo) && fromDemo > 0 ? fromDemo : DEFAULT_HOLD_SECONDS;
    }
    const audio = step?.narrationAudio;
    const duration = Number(audio?.durationSeconds);
    const clips = Array.isArray(audio?.clips)
      ? audio.clips.filter((url) => typeof url === "string" && url.startsWith("data:audio/"))
      : [];
    let clipsOk = false;
    if (clips.length && audio?.source === "upload") {
      clipsOk = true;
    } else if (clips.length) {
      const caption = String(step?.caption || "").trim();
      const rate = Number(audio?.rate);
      const projectRate = Number(demo.narration?.rate);
      clipsOk =
        !!caption &&
        audio.caption === caption &&
        (audio.voiceURI || "") === (demo.narration?.voiceURI || "") &&
        Number.isFinite(rate) &&
        Math.abs(rate - projectRate) <= 0.001;
    }
    if (clipsOk && Number.isFinite(duration) && duration > 0) {
      const floor = Math.max(1, Math.ceil(duration / captionPlaybackRate(audio.playbackRate) - 1e-9));
      hold = Math.max(hold, floor);
    }
    return hold;
  }

  function holdMs(step) {
    return Math.round(resolveHoldSeconds(step) * 1000);
  }

  let speakToken = 0;
  let currentSpeech = null;

  function stopSpeech() {
    speakToken += 1;
    if (currentSpeech) {
      currentSpeech.pause();
      currentSpeech.removeAttribute("src");
      currentSpeech.load();
      currentSpeech = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function splitForSpeech(text) {
    const max = 180;
    const parts = [];
    let rest = String(text || "").trim();
    while (rest.length > max) {
      let cut = rest.lastIndexOf(" ", max);
      if (cut < 40) cut = max;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }

  function playSpeechUrl(url, rate, token) {
    return new Promise((resolve, reject) => {
      if (token !== speakToken) {
        resolve();
        return;
      }
      const audio = new Audio();
      currentSpeech = audio;
      const speed = Math.min(2, Math.max(0.7, Number(rate) || 1));
      audio.referrerPolicy = "no-referrer";
      audio.preload = "auto";
      const applyRate = () => {
        audio.playbackRate = speed;
      };
      audio.addEventListener("loadedmetadata", applyRate);
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("tts")), { once: true });
      audio.src = url;
      applyRate();
      audio.play().catch(reject);
    });
  }

  function speakText(text, voiceURI, rate) {
    stopSpeech();
    const token = speakToken;
    const trimmed = String(text || "").trim();
    if (!trimmed) return Promise.resolve();
    const langMap = {
      "pt-BR": "pt-BR",
      "pt-PT": "pt-PT",
      "es-ES": "es-ES",
      "es-MX": "es-MX",
      "en-US": "en-US",
      "en-GB": "en-GB",
    };
    const lang = langMap[voiceURI] || "pt-BR";
    const parts = splitForSpeech(trimmed);
    return (async () => {
      let played = false;
      try {
        for (const part of parts) {
          if (token !== speakToken) return;
          const url =
            "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
            encodeURIComponent(lang) +
            "&q=" +
            encodeURIComponent(part);
          await playSpeechUrl(url, rate, token);
          played = true;
        }
      } catch {
        if (token !== speakToken || played || !window.speechSynthesis) return;
        await new Promise((resolve) => {
          const utterance = new SpeechSynthesisUtterance(trimmed);
          utterance.lang = lang;
          utterance.rate = Math.min(1.4, Math.max(0.7, Number(rate) || 1));
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });
      }
    })();
  }

  function savedCaptionClips(step) {
    const audio = step?.narrationAudio;
    if (!audio || !Array.isArray(audio.clips)) return [];
    const clips = audio.clips.filter((url) => typeof url === "string" && url.startsWith("data:audio/"));
    if (!clips.length) return [];
    if (audio.source === "upload") return clips;
    const caption = String(step?.caption || "").trim();
    if (!caption || audio.caption !== caption) return [];
    if ((audio.voiceURI || "") !== (demo.narration?.voiceURI || "")) return [];
    const savedRate = Number(audio.rate);
    const rate = Number(demo.narration?.rate);
    if (!Number.isFinite(savedRate) || Math.abs(savedRate - rate) > 0.001) return [];
    return clips;
  }

  function playableCaptionClips(step) {
    const saved = savedCaptionClips(step);
    if (saved.length) return saved;
    const audio = step?.narrationAudio;
    if (!Array.isArray(audio?.clips)) return [];
    return audio.clips.filter((url) => typeof url === "string" && url.startsWith("data:audio/"));
  }

  function playSavedClips(clips, rate) {
    stopSpeech();
    const token = speakToken;
    const speed = captionPlaybackRate(rate);
    return (async () => {
      for (const url of clips) {
        if (token !== speakToken || !url) return;
        await playSpeechUrl(url, speed, token);
      }
    })();
  }

  function createNarrationController(captionEl) {
    let bgAudio = null;
    let speakToken = 0;
    let speakDone = Promise.resolve();

    function setCaption(text, visible) {
      if (!captionEl) return;
      const trimmed = String(text || "").trim();
      captionEl.textContent = trimmed;
      captionEl.hidden = !visible || !trimmed;
    }

    function duck(active) {
      if (!bgAudio) return;
      bgAudio.volume = active ? BG_DUCK_VOLUME : BG_VOLUME;
    }

    function stopBackground() {
      if (!bgAudio) return;
      bgAudio.pause();
      bgAudio.src = "";
      bgAudio = null;
    }

    return {
      async startTour() {
        const src = demo.narration.background?.dataUrl;
        if (!src) {
          stopBackground();
          return;
        }
        if (bgAudio && bgAudio.dataset.src === src) {
          if (bgAudio.paused) {
            try {
              await bgAudio.play();
            } catch {
              /* ignore */
            }
          }
          return;
        }
        stopBackground();
        bgAudio = new Audio(src);
        bgAudio.dataset.src = src;
        bgAudio.loop = true;
        bgAudio.volume = BG_VOLUME;
        try {
          await bgAudio.play();
        } catch {
          /* ignore */
        }
      },
      enterStep(step, speak) {
        const caption = String(step?.caption || "").trim();
        setCaption(caption, step?.showCaption !== false);
        const runId = ++speakToken;
        stopSpeech();
        duck(false);
        const clips = playableCaptionClips(step);
        // why: HTML exportado também respeita narration.enabled do tour
        const narrationOn = demo?.narration?.enabled !== false;
        if (!speak || !narrationOn || !clips.length) {
          speakDone = Promise.resolve();
          return speakDone;
        }
        duck(true);
        speakDone = playSavedClips(clips, step?.narrationAudio?.playbackRate).then(() => {
          if (runId === speakToken) duck(false);
        });
        return speakDone;
      },
      whenSpeechDone() {
        return speakDone;
      },
      stop() {
        speakToken += 1;
        stopSpeech();
        stopBackground();
        setCaption("", false);
        speakDone = Promise.resolve();
      },
    };
  }

  function createClickFxController(els) {
    function reset() {
      if (els.clickFx) {
        els.clickFx.hidden = true;
        els.clickFx.classList.remove("is-active");
      }
      if (els.hotspot) els.hotspot.classList.remove("is-pressed");
      if (els.cursor) {
        els.cursor.classList.remove("is-visible", "is-click");
        els.cursor.hidden = true;
      }
    }

    function playRippleAt(x, y) {
      if (!els.clickFx) return;
      els.clickFx.hidden = false;
      els.clickFx.classList.remove("is-active");
      els.clickFx.style.left = x + "px";
      els.clickFx.style.top = y + "px";
      void els.clickFx.offsetWidth;
      els.clickFx.classList.add("is-active");
    }

    async function animateTo(target, opts) {
      const pressHotspot = !opts || opts.pressHotspot !== false;
      const startX = Math.max(16, target.x - 90);
      const startY = Math.max(16, target.y - 70);
      reset();
      els.cursor.hidden = false;
      els.cursor.style.left = startX + "px";
      els.cursor.style.top = startY + "px";
      await wait(30);
      els.cursor.classList.add("is-visible");
      els.cursor.style.left = target.x + "px";
      els.cursor.style.top = target.y + "px";
      await wait(520);
      els.cursor.classList.add("is-click");
      if (pressHotspot && els.hotspot) els.hotspot.classList.add("is-pressed");
      playRippleAt(target.x, target.y);
      await wait(220);
      els.cursor.classList.remove("is-click");
      await wait(380);
      els.cursor.classList.remove("is-visible");
      if (els.hotspot) els.hotspot.classList.remove("is-pressed");
      await wait(160);
      reset();
    }

    return { reset, animateTo };
  }

  function renderDemoPopoverFooter(popover) {
    const { footer, progress, previousButton, nextButton, footerButtons } = popover;
    if (previousButton) {
      previousButton.innerHTML = PREV_ARROW_SVG;
      previousButton.setAttribute("aria-label", gfT("player.prev"));
      previousButton.title = gfT("player.prev");
    }
    if (nextButton) {
      const label = (nextButton.textContent || "").trim() || gfT("player.next");
      const isDone = label === gfT("player.done");
      nextButton.classList.toggle("is-icon", !isDone);
      if (!isDone) nextButton.innerHTML = NEXT_ARROW_SVG;
      nextButton.setAttribute("aria-label", isDone ? label : gfT("player.next"));
      nextButton.title = isDone ? label : gfT("player.next");
    }
    if (footer && previousButton && progress && nextButton) {
      footer.appendChild(previousButton);
      footer.appendChild(progress);
      footer.appendChild(nextButton);
      if (footerButtons && footerButtons !== footer && !footerButtons.children.length) {
        footerButtons.remove();
      }
    }
  }

  const els = {
    stage: document.getElementById("player-stage"),
    image: document.getElementById("player-image"),
    slide: document.getElementById("player-slide"),
    slideKicker: document.getElementById("player-slide-kicker"),
    slideTitle: document.getElementById("player-slide-title"),
    slideBody: document.getElementById("player-slide-body"),
    hotspot: document.getElementById("player-hotspot"),
    clickPoint: document.getElementById("player-click-point"),
    clickFx: document.getElementById("click-fx"),
    cursor: document.getElementById("sim-cursor"),
    progress: document.getElementById("player-progress"),
    frame: document.getElementById("player-frame"),
    caption: document.getElementById("player-caption"),
  };

  const clickFx = createClickFxController(els);
  const narration = createNarrationController(els.caption);
  const chkAutoplay = document.getElementById("chk-autoplay");
  // why: igual a spotlightVeilPaint() em store.js — o HTML exportado não importa módulos.
  const SPOTLIGHT_VEIL_OPACITY = 0.48;
  let captionHome = null;

  function elevateCaption() {
    const el = els.caption;
    if (!el) return;
    el.classList.add("is-above-overlay");
    if (captionHome || el.parentElement === document.body) return;
    captionHome = el.parentElement;
    document.body.appendChild(el);
  }

  function restoreCaption() {
    const el = els.caption;
    if (el) el.classList.remove("is-above-overlay");
    if (el && captionHome && el.parentElement !== captionHome) captionHome.appendChild(el);
    captionHome = null;
  }

  let driverObj = null;
  let activeIndex = 0;
  let animating = false;
  let autoplayTimer = null;

  function setProgress(text) {
    if (els.progress) els.progress.textContent = text;
  }

  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function autoplayOn() {
    return !!chkAutoplay?.checked;
  }

  let presentProgressAnim = null;

  function hidePresentProgress() {
    presentProgressAnim?.cancel?.();
    presentProgressAnim = null;
    const el = document.getElementById("present-progress");
    const bar = document.getElementById("present-progress-fill");
    if (el) el.hidden = true;
    if (bar) {
      bar.style.transform = "scaleX(0)";
      bar.getAnimations?.().forEach((a) => a.cancel());
    }
  }

  function startPresentProgress(durationMs) {
    const el = document.getElementById("present-progress");
    const bar = document.getElementById("present-progress-fill");
    const ms = Math.max(0, Number(durationMs) || 0);
    if (!el || !bar || ms <= 0) {
      hidePresentProgress();
      return;
    }
    presentProgressAnim?.cancel?.();
    bar.getAnimations?.().forEach((a) => a.cancel());
    el.hidden = false;
    bar.style.transform = "scaleX(0)";
    void bar.offsetWidth;
    presentProgressAnim = bar.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: ms, easing: "linear", fill: "forwards" }
    );
  }

  function clearAutoplay() {
    clearTimeout(autoplayTimer);
    autoplayTimer = null;
    hidePresentProgress();
  }

  function armAutoplay() {
    clearAutoplay();
    if (!autoplayOn() || !driverObj) return;
    const step = demo.steps[activeIndex];
    if (!step) return;
    const speechDone = narration.whenSpeechDone();
    const delay = holdMs(step);
    startPresentProgress(delay);
    autoplayTimer = setTimeout(async () => {
      await speechDone;
      const btn = document.querySelector(".driver-popover-next-btn");
      if (btn) btn.click();
    }, delay);
  }

  function placeHotspot(hotspot) {
    const hs = hotspot || { x: 40, y: 40, w: 12, h: 8 };
    const w = els.image.clientWidth;
    const h = els.image.clientHeight;
    els.hotspot.style.left = (hs.x / 100) * w + "px";
    els.hotspot.style.top = (hs.y / 100) * h + "px";
    els.hotspot.style.width = (hs.w / 100) * w + "px";
    els.hotspot.style.height = (hs.h / 100) * h + "px";
  }

  function placeClickPoint(point) {
    const cp = point || { x: 50, y: 50 };
    const w = els.image.clientWidth;
    const h = els.image.clientHeight;
    els.clickPoint.style.left = (cp.x / 100) * w + "px";
    els.clickPoint.style.top = (cp.y / 100) * h + "px";
  }

  function clearZoom(animate) {
    if (!els.frame) return;
    if (!animate) {
      const prev = els.frame.style.transition;
      els.frame.style.transition = "none";
      els.frame.style.transform = "";
      els.frame.style.transformOrigin = "";
      void els.frame.offsetWidth;
      els.frame.style.transition = prev;
    } else {
      els.frame.style.transform = "";
      els.frame.style.transformOrigin = "";
    }
    els.stage?.classList.remove("is-zooming");
  }

  function waitZoomTransition() {
    return new Promise((resolve) => {
      if (!els.frame) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        els.frame.removeEventListener("transitionend", onEnd);
        clearTimeout(timer);
        resolve();
      };
      const onEnd = (e) => {
        if (e.target !== els.frame || e.propertyName !== "transform") return;
        finish();
      };
      els.frame.addEventListener("transitionend", onEnd);
      const timer = setTimeout(finish, 850);
    });
  }

  function refreshDriver() {
    try {
      driverObj?.refresh?.();
    } catch {
      /* ignore */
    }
  }

  // why: refresh() cancela o frame anterior; o tick entra depois para o recorte acompanhar o transform
  function trackDriverDuringZoom() {
    let stopped = false;
    let raf = 0;
    const tick = () => {
      if (stopped) return;
      refreshDriver();
      raf = requestAnimationFrame(tick);
    };
    refreshDriver();
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }

  function zoomEnabled(step) {
    return step?.type !== "slide" && step?.zoomHighlight === true && !stepVideoLink(step) && els.image && !els.image.hidden;
  }

  // why: espelha tour-schema/video.js — o HTML exportado pode abrir sem rede (ou em file://, onde o
  // YouTube recusa o embed), então o vídeo vira pôster + link que abre o YouTube/Vimeo em outra aba.
  function stepVideoLink(step) {
    const v = step && step.type !== "slide" ? step.video : null;
    if (!v || typeof v !== "object") return null;
    const id = String(v.id == null ? "" : v.id);
    if (v.kind === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return { provider: "YouTube", href: "https://www.youtube.com/watch?v=" + id };
    }
    if (v.kind === "vimeo" && /^\d{1,12}$/.test(id)) {
      const h = typeof v.h === "string" && /^[0-9a-f]{6,32}$/i.test(v.h) ? "/" + v.h.toLowerCase() : "";
      return { provider: "Vimeo", href: "https://vimeo.com/" + id + h };
    }
    return null;
  }

  function videoLinkEl() {
    let a = document.getElementById("player-video");
    if (!a && els.frame) {
      a = document.createElement("a");
      a.id = "player-video";
      a.className = "gf-video-link";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.hidden = true;
      a.innerHTML =
        '<span class="gf-video-play"><span class="gf-video-play-ico"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg></span><span class="gf-video-play-text"></span></span>';
      els.frame.insertBefore(a, els.image ? els.image.nextSibling : null);
    }
    return a;
  }

  function syncVideoLink(step) {
    const link = stepVideoLink(step);
    const a = link ? videoLinkEl() : document.getElementById("player-video");
    if (!a) return null;
    if (!link) {
      a.hidden = true;
      a.removeAttribute("href");
      return null;
    }
    a.href = link.href;
    const label = gfT("video.openOn", { provider: link.provider });
    a.setAttribute("aria-label", label);
    a.title = label;
    a.querySelector(".gf-video-play-text").textContent = label;
    a.hidden = false;
    return link;
  }

  async function applyStepZoom(step) {
    if (!els.frame || !els.stage) return;
    if (!zoomEnabled(step)) {
      const hadZoom = Boolean(els.frame.style.transform);
      const stopTrack = hadZoom ? trackDriverDuringZoom() : null;
      clearZoom(hadZoom);
      if (hadZoom) await waitZoomTransition();
      stopTrack?.();
      refreshDriver();
      return;
    }
    const cam = computeZoomCamera(
      step.hotspot,
      { w: els.image.clientWidth, h: els.image.clientHeight },
      { w: els.stage.clientWidth, h: els.stage.clientHeight },
      true
    );
    const style = zoomCameraStyle(cam);
    const next = style.transform === "none" ? "" : style.transform;
    els.stage.classList.add("is-zooming");
    els.frame.style.transformOrigin = style.transformOrigin;
    if (els.frame.style.transform === next) return;
    const stopTrack = trackDriverDuringZoom();
    els.frame.style.transform = next;
    await waitZoomTransition();
    stopTrack();
    refreshDriver();
  }

  async function prepareStepCamera() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (els.frame?.style.transform) clearZoom(false);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function zoomAfterHighlightVisible(step) {
    if (!zoomEnabled(step)) return;
    // why: o driver precisa pintar o recorte em 1× antes da câmera começar a andar
    await delay(550);
    await applyStepZoom(step);
    try {
      driverObj?.refresh?.();
    } catch {
      /* ignore */
    }
  }

  function clickTarget(step) {
    const cp = ensureClickPoint(step);
    return {
      x: (cp.x / 100) * els.image.clientWidth,
      y: (cp.y / 100) * els.image.clientHeight,
    };
  }

  function applySlideLayout(slideEl, step) {
    if (!slideEl) return;
    const align = step && step.layout && step.layout.align;
    const valign = step && step.layout && step.layout.valign;
    slideEl.dataset.align = align === "center" || align === "end" ? align : "start";
    slideEl.dataset.valign = valign === "top" || valign === "bottom" ? valign : "center";
  }

  async function showStepVisual(step, speak) {
    return new Promise((resolve) => {
      narration.enterStep(step, !!speak);
      if (step.type === "slide") {
        els.image.hidden = true;
        els.image.removeAttribute("src");
        const missing = document.getElementById("player-missing");
        if (missing) missing.hidden = true;
        els.slide.hidden = false;
        // mesma regra de slideKickerText (playback.js): sem "Cena N" quando o slide tem título
        const slideTitle = String(step.popover?.title || step.label || "").trim();
        const sceneN = Number(step.scene) || 1;
        const sceneName = String(demo.sceneLabels?.[sceneN] ?? demo.sceneLabels?.[String(sceneN)] ?? "").trim();
        const kicker = slideTitle ? "" : sceneName || gfT("player.scene", { n: sceneN });
        els.slideKicker.textContent = kicker;
        els.slideKicker.hidden = !kicker;
        els.slideTitle.textContent = step.popover?.title || step.label || "";
        gfRichText.renderRichText(els.slideBody, step.popover?.description || "");
        applySlideLayout(els.slide, step);
        els.hotspot.style.display = "none";
        els.clickPoint.hidden = true;
        syncVideoLink(null);
        resolve();
        return;
      }

      els.slide.hidden = true;
      els.hotspot.style.display = "block";
      els.clickPoint.hidden = false;

      const src = resolveImageSrc(step.image);
      const missing = document.getElementById("player-missing");
      const done = (ok) => {
        if (missing) missing.hidden = !!ok;
        if (!ok) {
          els.image.hidden = true;
          els.hotspot.style.display = "none";
        }
        requestAnimationFrame(() => {
          if (syncVideoLink(step)) {
            els.hotspot.style.display = "none";
            els.clickPoint.hidden = true;
          } else if (ok) {
            placeHotspot(step.hotspot);
            placeClickPoint(ensureClickPoint(step));
          }
          resolve();
        });
      };

      if (!src) {
        done(false);
        return;
      }
      els.image.onload = () => {
        els.image.hidden = false;
        done(true);
      };
      els.image.onerror = () => done(false);
      if (els.image.getAttribute("src") === src && els.image.complete && els.image.naturalWidth) {
        els.image.hidden = false;
        done(true);
      } else {
        els.image.hidden = true;
        els.image.src = src;
      }
    });
  }

  async function animateClick(step) {
    if (step.type === "slide" || step.simulateClick === false || stepVideoLink(step)) return;
    await clickFx.animateTo(clickTarget(step), { pressHotspot: true });
  }

  function stop() {
    clearAutoplay();
    narration.stop();
    if (driverObj) {
      try {
        driverObj.destroy();
      } catch {
        /* ignore */
      }
      driverObj = null;
    }
    clickFx.reset();
    clearZoom(false);
    restoreCaption();
    animating = false;
  }

  async function buildAndDrive(startIndex, opts) {
    stop();
    if (opts && typeof opts.autoplay === "boolean" && chkAutoplay) {
      chkAutoplay.checked = opts.autoplay;
    }

    const steps = demo.steps;
    if (!steps.length) {
      toast(gfT("player.noSteps"));
      return;
    }

    const factory = window.driver?.js?.driver || window.driver;
    if (!factory) {
      toast(gfT("player.driverMissing"));
      return;
    }

    activeIndex = startIndex;
    await narration.startTour();
    elevateCaption();
    await showStepVisual(steps[activeIndex], true);
    await prepareStepCamera();

    const overlay = "#000000";
    const overlayOpacity = SPOTLIGHT_VEIL_OPACITY;

    driverObj = factory({
      popoverClass: "demo-popover",
      showProgress: true,
      animate: true,
      allowClose: true,
      // why: setas no keydown abaixo; o keyup nativo do driver falhava no próximo com onNextClick async.
      allowKeyboardControl: false,
      overlayColor: overlay,
      overlayOpacity,
      stagePadding: 6,
      disableActiveInteraction: false,
      nextBtnText: gfT("player.next"),
      prevBtnText: "",
      doneBtnText: gfT("player.done"),
      progressText: gfT("player.progress"),
      onPopoverRender: (popover) => {
        renderDemoPopoverFooter(popover);
        if (popover?.closeButton) {
          popover.closeButton.setAttribute("aria-label", gfT("player.closeTour"));
          popover.closeButton.title = gfT("player.closeTour");
        }
        setPopoverHiddenForSlide(steps[activeIndex]?.type === "slide");
        armAutoplay();
      },
      steps: steps.map((step) => ({
        element: step.type === "slide" ? "#player-slide" : stepVideoLink(step) ? "#player-video" : "#player-hotspot",
        popover: {
          // why: driver.js usa innerHTML; o texto do autor entra escapado (mesma regra de htmlText.js)
          title: gfEscapeHtml(step.popover?.title || step.label || ""),
          // formatação leve montada em tags fixas; o texto do autor sai escapado (cópia de richText.js)
          description: gfRichText.richTextHtml(step.popover?.description || ""),
          side: step.popover?.side || "bottom",
          align: step.popover?.align || "center",
          onNextClick: async (_el, _step, optsNext) => {
            if (animating) return;
            animating = true;
            clearAutoplay();
            const current = steps[activeIndex];
            const drv = optsNext.driver;
            try {
              await animateClick(current);
              const nextIndex = activeIndex + 1;
              if (nextIndex >= steps.length) {
                drv.destroy();
                driverObj = null;
                narration.stop();
                setProgress(gfT("player.doneStatus"));
                return;
              }
              activeIndex = nextIndex;
              setProgress(gfT("player.stepOf", { current: activeIndex + 1, total: steps.length }));
              await showStepVisual(steps[activeIndex], true);
              await prepareStepCamera();
              drv.moveNext();
              await zoomAfterHighlightVisible(steps[activeIndex]);
            } finally {
              animating = false;
            }
          },
          onPrevClick: async (_el, _step, optsPrev) => {
            if (animating || activeIndex <= 0) return;
            animating = true;
            clearAutoplay();
            const drv = optsPrev.driver;
            try {
              activeIndex -= 1;
              setProgress(gfT("player.stepOf", { current: activeIndex + 1, total: steps.length }));
              await showStepVisual(steps[activeIndex], true);
              await prepareStepCamera();
              drv.movePrevious();
              await zoomAfterHighlightVisible(steps[activeIndex]);
            } finally {
              animating = false;
            }
          },
        },
      })),
      onDestroyed: () => {
        clearAutoplay();
        narration.stop();
        setProgress(gfT("player.stopped"));
        clickFx.reset();
        clearZoom(false);
      },
    });

    setProgress(gfT("player.stepOf", { current: activeIndex + 1, total: steps.length }));
    driverObj.drive(activeIndex);
    await zoomAfterHighlightVisible(steps[activeIndex]);
  }

  applyTheme(demo.theme);

  const startSel = document.getElementById("start-step");
  if (startSel) {
    startSel.innerHTML = demo.steps
      .map((step, i) => {
        const label = gfEscapeHtml(step.popover?.title || step.label || gfT("editor.stepFallback"));
        return `<option value="${i}">${i + 1}. ${label}</option>`;
      })
      .join("");
  }

  function startIndex() {
    return Number(startSel?.value || 0);
  }

  document.getElementById("btn-play")?.addEventListener("click", () => {
    buildAndDrive(startIndex(), { autoplay: false });
  });
  document.getElementById("btn-watch")?.addEventListener("click", () => {
    buildAndDrive(startIndex(), { autoplay: true });
  });
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    buildAndDrive(0, { autoplay: autoplayOn() });
  });
  document.getElementById("btn-stop")?.addEventListener("click", () => {
    stop();
    setProgress(gfT("player.stopped"));
  });

  function setPopoverHiddenForSlide(hidden) {
    document.querySelectorAll(".driver-popover").forEach((el) => {
      el.classList.toggle("is-slide-hidden", !!hidden);
    });
  }

  function clickDriverNext() {
    const btn = document.querySelector(".driver-popover-next-btn");
    if (btn && !btn.disabled) btn.click();
  }

  function clickDriverPrev() {
    const btn = document.querySelector(".driver-popover-prev-btn");
    if (btn && !btn.disabled) btn.click();
  }

  function onHighlightClick(e) {
    if (!driverObj) return;
    if (e.target.closest(".slide-card-play, .slide-card-close")) return;
    e.preventDefault();
    e.stopPropagation();
    clickDriverNext();
  }
  els.hotspot.addEventListener("click", onHighlightClick);
  // why: fechar/sair da página não pode deixar a narração tocando
  window.addEventListener("pagehide", () => {
    clearAutoplay();
    narration.stop();
  });
  els.slide.addEventListener("click", onHighlightClick);
  document.getElementById("player-slide-play")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (driverObj) clickDriverNext();
    else buildAndDrive(Number(document.getElementById("start-step")?.value || activeIndex), { autoplay: false });
  });
  document.getElementById("player-slide-close")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!driverObj) return;
    stop();
    setProgress(gfT("player.stopped"));
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      stop();
      setProgress(gfT("player.stopped"));
      return;
    }
    if (!driverObj || animating) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      clickDriverNext();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      clickDriverPrev();
    }
  });

  window.addEventListener("resize", () => {
    const step = demo.steps[activeIndex];
    if (step && step.type !== "slide" && !els.image.hidden && !stepVideoLink(step)) {
      placeHotspot(step.hotspot);
      placeClickPoint(ensureClickPoint(step));
      applyStepZoom(step).then(() => {
        try {
          driverObj?.refresh?.();
        } catch {
          /* ignore */
        }
      });
    }
  });

  setProgress(gfT("player.readyHint"));
})();
