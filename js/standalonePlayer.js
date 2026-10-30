
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

/* <gf-gallery> cópia gerada de js/gallery.js (node scripts/sync-gallery.mjs) */
var gfGallery = (function () {
/**
 * Modo Galeria (playback.mode = "gallery"): carrossel de fotos em tela cheia, como nos portais de imóveis, veículos e lojas.
 * Sem imports de propósito: este arquivo é copiado inteiro para o HTML offline (js/standalonePlayer.js,
 * `node scripts/sync-gallery.mjs`; o teste falha se a cópia divergir). Tudo que depende do app chega em `opts`.
 *
 * Segurança (#174): todo texto do tour entra com textContent; o texto formatado (#175) entra pelo
 * `richText.render` (nós DOM, nunca innerHTML). Só SVG fixo deste arquivo usa innerHTML.
 */

const GALLERY_CAPTION_MAX = 140;
const ZOOM_MAX = 4;
const ZOOM_STEP = 2.5;
const SWIPE_MIN_PX = 48;

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  done: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 8v6M8 11h6M16 16l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11h6M16 16l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function plainText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampText(text, max) {
  const s = plainText(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Tipo de slide do passo na galeria. */
function gallerySlideKind(step, hasVideo) {
  if (step?.type === "slide") return "card";
  if (hasVideo) return "video";
  return "photo";
}

/**
 * Legenda de 1 linha + "Detalhes".
 * Legenda = título (ou rótulo); sem título, o começo do texto sem marcadores. "Detalhes" mostra o texto
 * inteiro (formatado) quando há título e texto, ou quando o texto não cabe numa linha.
 */
function galleryCaption(step, strip = (s) => String(s ?? "")) {
  const title = plainText(step?.popover?.title || step?.label || "");
  const raw = String(step?.popover?.description || "").trim();
  const flat = plainText(strip(raw, { sentences: true }));
  if (title) return { caption: clampText(title, GALLERY_CAPTION_MAX), details: raw, hasDetails: Boolean(raw) };
  const long = flat.length > 90 || /\n/.test(raw) || flat !== plainText(raw);
  return { caption: clampText(flat, GALLERY_CAPTION_MAX), details: raw, hasDetails: Boolean(raw) && long };
}

/**
 * Seções (chips) a partir das cenas: um chip por bloco contíguo de cena, com o nome da cena.
 * Só aparece com 2+ seções e pelo menos uma com nome (sem nomes, "Seção 1, 2…" não ajuda ninguém).
 */
function gallerySections(demo) {
  const steps = Array.isArray(demo?.steps) ? demo.steps : [];
  const labels = demo?.sceneLabels && typeof demo.sceneLabels === "object" ? demo.sceneLabels : {};
  const out = [];
  steps.forEach((step, index) => {
    const n = Number(step?.scene);
    const scene = Number.isFinite(n) && n > 0 ? n : 1;
    const last = out[out.length - 1];
    if (last && last.scene === scene) {
      last.count += 1;
      return;
    }
    out.push({ scene, label: plainText(labels[scene] ?? labels[String(scene)] ?? "").slice(0, 40), start: index, count: 1 });
  });
  if (out.length < 2 || !out.some((s) => s.label)) return [];
  return out;
}

/** Seção do passo `index` (índice na lista de seções) ou -1. */
function sectionIndexAt(sections, index) {
  for (let i = sections.length - 1; i >= 0; i--) if (index >= sections[i].start) return i;
  return -1;
}

/** Próximo índice (sem dar a volta). */
function galleryStep(index, total, delta) {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(total - 1, (Number(index) || 0) + delta));
}

/** Prende o deslocamento da foto ampliada para ela nunca descolar da borda. */
function clampGalleryPan(cam, box) {
  const s = Math.max(1, Math.min(ZOOM_MAX, Number(cam?.scale) || 1));
  const maxX = Math.max(0, ((s - 1) * (box?.width || 0)) / 2);
  const maxY = Math.max(0, ((s - 1) * (box?.height || 0)) / 2);
  const x = Math.max(-maxX, Math.min(maxX, Number(cam?.x) || 0));
  const y = Math.max(-maxY, Math.min(maxY, Number(cam?.y) || 0));
  return { scale: s, x: s === 1 ? 0 : x, y: s === 1 ? 0 : y };
}

/** Zoom mantendo fixo o ponto (px, py) relativo ao centro da caixa. */
function zoomAt(cam, nextScale, px, py, box) {
  const s0 = Math.max(1, Number(cam?.scale) || 1);
  const s1 = Math.max(1, Math.min(ZOOM_MAX, Number(nextScale) || 1));
  const k = s1 / s0;
  return clampGalleryPan({ scale: s1, x: px - (px - (cam?.x || 0)) * k, y: py - (py - (cam?.y || 0)) * k }, box);
}

/**
 * Monta a galeria. Devolve { open(demo,{from}), close(reason), go(i), next(), prev(), closeLayer(), isOpen(), index(), root }.
 * opts: doc, t(key, vars), richText { render(el, text), strip(text, opts) }, imageSrc(step, demo), altOf(step),
 *       videoOf(step) → truthy se o passo tem vídeo, mountVideo(host, step, index) → { teardown() } | null,
 *       videoLink(step) → { href, label } | null (offline), renderCta(slot, index), onChange(index), onFinish(), onClose(reason),
 *       focus (padrão true), reducedMotion() → bool, mountInto (padrão body).
 */
function createGallery(opts = {}) {
  const doc = opts.doc || document;
  const t = opts.t || ((k) => k);
  const strip = opts.richText?.strip || ((s) => String(s ?? ""));
  const renderRich = opts.richText?.render || ((el, s) => { el.textContent = String(s ?? ""); });
  let demo = null;
  let steps = [];
  let sections = [];
  let current = -1;
  let open = false;
  let root = null;
  let ui = null;
  let cam = { scale: 1, x: 0, y: 0 };
  let videoHandle = null;
  let detailsOpen = false;
  let gridOpen = false;
  let thumbsFilled = false;
  let lastFocus = null;
  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  let touchZoomAt = 0;
  let detailsSeq = 0;

  function el(tag, cls, attrs) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (attrs) for (const k of Object.keys(attrs)) node.setAttribute(k, attrs[k]);
    return node;
  }

  function iconButton(cls, icon, label) {
    const b = el("button", cls, { type: "button", "aria-label": label, title: label });
    b.innerHTML = ICONS[icon];
    return b;
  }

  function build() {
    root = el("div", "gf-gallery", { role: "region", "aria-roledescription": t("gallery.roledesc"), tabindex: "-1" });
    root.hidden = true;
    const top = el("div", "gf-gal-top");
    const close = iconButton("gf-gal-btn gf-gal-close", "close", t("gallery.close"));
    const head = el("div", "gf-gal-head");
    const title = el("span", "gf-gal-title");
    const section = el("span", "gf-gal-section");
    head.append(title, section);
    const tools = el("div", "gf-gal-tools");
    const counter = el("button", "gf-gal-counter", { type: "button", "aria-expanded": "false" });
    const counterIco = el("span", "gf-gal-counter-ico", { "aria-hidden": "true" });
    counterIco.innerHTML = ICONS.grid;
    const counterText = el("span", "gf-gal-counter-text");
    counter.append(counterIco, counterText);
    tools.append(counter);
    top.append(close, head, tools);

    const stage = el("div", "gf-gal-stage");
    const backdrop = el("img", "gf-gal-backdrop", { alt: "", "aria-hidden": "true", decoding: "async" });
    const slide = el("div", "gf-gal-slide", { role: "group", "aria-roledescription": t("gallery.slideRole") });
    const prev = iconButton("gf-gal-btn gf-gal-nav gf-gal-prev", "prev", t("gallery.prev"));
    const next = iconButton("gf-gal-btn gf-gal-nav gf-gal-next", "next", t("gallery.next"));
    const zoom = iconButton("gf-gal-btn gf-gal-zoom", "zoomIn", t("gallery.zoomIn"));
    zoom.setAttribute("aria-pressed", "false");
    stage.append(backdrop, slide, prev, next, zoom);

    const info = el("div", "gf-gal-info");
    const capRow = el("div", "gf-gal-caprow");
    const caption = el("p", "gf-gal-caption");
    const detailsId = `gf-gal-details-${++detailsSeq}`;
    const detailsBtn = el("button", "gf-gal-details-btn", { type: "button", "aria-expanded": "false", "aria-controls": detailsId });
    const detailsLabel = el("span", "gf-gal-details-label");
    const chev = el("span", "gf-gal-chev", { "aria-hidden": "true" });
    chev.innerHTML = ICONS.chevron;
    detailsBtn.append(detailsLabel, chev);
    const cta = el("div", "gf-gal-cta");
    capRow.append(caption, detailsBtn, cta);
    const details = el("div", "gf-gal-details", { id: detailsId });
    details.hidden = true;
    info.append(details, capRow);

    const chips = el("div", "gf-gal-chips", { role: "group", "aria-label": t("gallery.sections") });
    const thumbs = el("div", "gf-gal-thumbs", { role: "group", "aria-label": t("gallery.allPhotos") });
    const live = el("div", "gf-gal-live", { "aria-live": "polite", "aria-atomic": "true" });

    root.append(top, stage, info, chips, thumbs, live);
    ui = { top, close, title, section, counter, counterText, stage, backdrop, slide, prev, next, zoom, info, caption, detailsBtn, detailsLabel, details, cta, chips, thumbs, live };

    close.addEventListener("click", () => closeGallery("close"));
    prev.addEventListener("click", () => prevSlide());
    next.addEventListener("click", () => nextSlide());
    zoom.addEventListener("click", () => toggleZoom());
    counter.addEventListener("click", () => setGrid(!gridOpen));
    detailsBtn.addEventListener("click", () => setDetails(!detailsOpen));
    // why: no documento (não só na galeria) — o foco pode estar no body depois de um clique na foto
    doc.addEventListener(
      "keydown",
      (e) => {
        if (open) onKey(e);
      },
      true
    );
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerCancel);
    stage.addEventListener("dblclick", (e) => {
      if (e.target.closest?.("button, a, iframe")) return;
      // why: no toque o navegador também manda dblclick depois do toque duplo (que já alternou o zoom)
      if (Date.now() - touchZoomAt < 600) return;
      if (currentKind() !== "photo") return;
      toggleZoom(pointInBox(e.clientX, e.clientY));
    });
    stage.addEventListener("wheel", onWheel, { passive: false });
    (opts.mountInto || doc.body).append(root);
  }

  function currentKind() {
    const step = steps[current];
    return gallerySlideKind(step, Boolean(step && opts.videoOf?.(step)));
  }

  function mediaEl() {
    return ui?.slide.querySelector(".gf-gal-photo");
  }

  function mediaBox() {
    const img = mediaEl();
    const r = img?.getBoundingClientRect?.();
    if (!r || !r.width) return { width: 0, height: 0, left: 0, top: 0 };
    // why: o rect já vem com a escala aplicada; a caixa base é a da foto sem zoom
    return { width: r.width / cam.scale, height: r.height / cam.scale, left: r.left, top: r.top, sw: r.width, sh: r.height };
  }

  function pointInBox(x, y) {
    const r = ui.stage.getBoundingClientRect();
    return { x: x - (r.left + r.width / 2), y: y - (r.top + r.height / 2) };
  }

  function applyCam(next, { animate = false } = {}) {
    const img = mediaEl();
    cam = clampGalleryPan(next, mediaBox());
    root.classList.toggle("is-zoomed", cam.scale > 1.01);
    if (img) {
      img.classList.toggle("is-animating", animate && !reduced());
      img.style.transform = cam.scale > 1.01 ? `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})` : "";
    }
    const zoomed = cam.scale > 1.01;
    ui.zoom.innerHTML = ICONS[zoomed ? "zoomOut" : "zoomIn"];
    const label = t(zoomed ? "gallery.zoomOut" : "gallery.zoomIn");
    ui.zoom.setAttribute("aria-label", label);
    ui.zoom.title = label;
    ui.zoom.setAttribute("aria-pressed", zoomed ? "true" : "false");
  }

  function resetZoom(animate = false) {
    if (cam.scale === 1 && !cam.x && !cam.y) return false;
    applyCam({ scale: 1, x: 0, y: 0 }, { animate });
    return true;
  }

  function toggleZoom(point) {
    if (currentKind() !== "photo") return;
    if (cam.scale > 1.01) resetZoom(true);
    else {
      const p = point || { x: 0, y: 0 };
      applyCam(zoomAt(cam, ZOOM_STEP, p.x, p.y, mediaBox()), { animate: true });
    }
  }

  function reduced() {
    try {
      return Boolean(opts.reducedMotion?.());
    } catch {
      return false;
    }
  }

  // ---- gestos: deslizar troca de foto; com zoom, um dedo arrasta; pinça amplia; toque duplo alterna ----
  function onPointerDown(e) {
    if (e.target.closest?.("button, a, iframe, .gf-video")) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      ui.stage.setPointerCapture?.(e.pointerId);
    } catch {
      /* ponteiro já saiu */
    }
    if (pointers.size === 2 && currentKind() === "photo") {
      const [a, b] = [...pointers.values()];
      gesture = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cam: { ...cam }, mid: pointInBox((a.x + b.x) / 2, (a.y + b.y) / 2) };
      return;
    }
    if (pointers.size === 1) gesture = { kind: cam.scale > 1.01 ? "pan" : "swipe", x: e.clientX, y: e.clientY, at: Date.now(), cam: { ...cam }, moved: false };
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.kind === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      applyCam(zoomAt(gesture.cam, (gesture.cam.scale * dist) / gesture.dist, gesture.mid.x, gesture.mid.y, mediaBox()));
      return;
    }
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (Math.hypot(dx, dy) > 8) gesture.moved = true;
    if (gesture.kind === "pan") applyCam({ scale: cam.scale, x: gesture.cam.x + dx, y: gesture.cam.y + dy });
    else if (gesture.kind === "swipe" && !reduced()) {
      ui.slide.style.transform = Math.abs(dx) > Math.abs(dy) ? `translateX(${dx * 0.35}px)` : "";
    }
  }

  function onPointerUp(e) {
    const g = gesture;
    pointers.delete(e.pointerId);
    ui.slide.style.transform = "";
    if (!g) return;
    if (g.kind === "pinch") {
      if (pointers.size === 0) gesture = null;
      else gesture = null;
      if (cam.scale < 1.05) resetZoom(true);
      return;
    }
    gesture = null;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.kind === "swipe" && Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - g.at < 900) {
      if (dx < 0) nextSlide({ fromGesture: true });
      else prevSlide();
      return;
    }
    if (!g.moved && e.pointerType === "touch" && currentKind() === "photo") {
      const tap = { x: e.clientX, y: e.clientY, at: Date.now() };
      if (lastTap && tap.at - lastTap.at < 320 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 32) {
        lastTap = null;
        touchZoomAt = Date.now();
        toggleZoom(pointInBox(tap.x, tap.y));
        return;
      }
      lastTap = tap;
    }
  }

  function onPointerCancel(e) {
    pointers.delete(e.pointerId);
    gesture = null;
    ui.slide.style.transform = "";
  }

  function onWheel(e) {
    if (!e.ctrlKey || currentKind() !== "photo") return;
    // why: pinça no trackpad chega como wheel + ctrlKey; sem isso o navegador amplia a página inteira
    e.preventDefault();
    const p = pointInBox(e.clientX, e.clientY);
    applyCam(zoomAt(cam, cam.scale * Math.exp(-e.deltaY / 200), p.x, p.y, mediaBox()));
  }

  function onKey(e) {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let handled = true;
    if (e.key === "ArrowRight") nextSlide({ fromGesture: true });
    else if (e.key === "ArrowLeft") prevSlide();
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(steps.length - 1);
    else if (e.key === "Escape") {
      if (!closeLayer()) closeGallery("esc");
    } else if ((e.key === "+" || e.key === "=") && currentKind() === "photo") applyCam(zoomAt(cam, cam.scale * 1.5, 0, 0, mediaBox()), { animate: true });
    else if (e.key === "-" && currentKind() === "photo") applyCam(zoomAt(cam, cam.scale / 1.5, 0, 0, mediaBox()), { animate: true });
    else handled = false;
    if (handled) {
      // why: atalhos do editor (setas na tira de passos, P) e do player guiado não podem rodar por trás
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  // ---- camadas: grade de miniaturas e "Detalhes" ----
  function setDetails(next, { focusBtn = false } = {}) {
    const want = Boolean(next) && !ui.detailsBtn.hidden;
    detailsOpen = want;
    ui.details.hidden = !want;
    root.classList.toggle("is-details-open", want);
    ui.detailsBtn.setAttribute("aria-expanded", want ? "true" : "false");
    ui.detailsLabel.textContent = t(want ? "gallery.detailsHide" : "gallery.details");
    if (want) ui.details.scrollTop = 0;
    if (focusBtn) ui.detailsBtn.focus({ preventScroll: true });
  }

  function setGrid(next, { focusCounter = false } = {}) {
    gridOpen = Boolean(next) && steps.length > 1;
    root.classList.toggle("is-grid-open", gridOpen);
    ui.counter.setAttribute("aria-expanded", gridOpen ? "true" : "false");
    ui.counter.setAttribute("aria-label", t(gridOpen ? "gallery.hideAll" : "gallery.showAll", { n: current + 1, total: steps.length }));
    if (gridOpen) {
      fillThumbs();
      const cur = ui.thumbs.querySelector('[aria-current="true"]');
      cur?.focus({ preventScroll: true });
      cur?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } else if (focusCounter) ui.counter.focus({ preventScroll: true });
  }

  /** Fecha a camada de cima (grade, Detalhes, zoom). true = fechou alguma. */
  function closeLayer() {
    if (!open) return false;
    if (gridOpen) {
      setGrid(false, { focusCounter: true });
      return true;
    }
    if (detailsOpen) {
      setDetails(false, { focusBtn: true });
      return true;
    }
    return resetZoom(true);
  }

  // ---- miniaturas e seções ----
  function thumbLabel(i) {
    const { caption } = galleryCaption(steps[i], strip);
    return t("gallery.thumb", { n: i + 1, total: steps.length, caption: caption || "" }).replace(/[:\s—-]+$/, "");
  }

  function buildThumbs() {
    ui.thumbs.replaceChildren();
    thumbsFilled = false;
    steps.forEach((step, i) => {
      const b = el("button", "gf-gal-thumb", { type: "button", "aria-label": thumbLabel(i) });
      b.dataset.index = String(i);
      const kind = gallerySlideKind(step, Boolean(opts.videoOf?.(step)));
      b.dataset.kind = kind;
      const src = kind === "card" ? "" : opts.imageSrc?.(step, demo) || "";
      if (src) {
        const img = el("img", "", { alt: "", loading: "lazy", decoding: "async", draggable: "false" });
        img.dataset.src = src;
        b.append(img);
      } else {
        const label = el("span", "gf-gal-thumb-text");
        label.textContent = clampText(step?.popover?.title || step?.label || "", 40);
        b.append(label);
      }
      if (kind === "video") {
        const badge = el("span", "gf-gal-thumb-play", { "aria-hidden": "true" });
        badge.innerHTML = ICONS.play;
        b.append(badge);
      }
      b.addEventListener("click", () => {
        go(i);
        if (gridOpen) setGrid(false);
        root.focus({ preventScroll: true });
      });
      ui.thumbs.append(b);
    });
  }

  /** Miniaturas só baixam quando aparecem (fileira do desktop ou grade): no celular a fileira fica escondida. */
  function fillThumbs() {
    if (thumbsFilled || !ui) return;
    thumbsFilled = true;
    for (const img of ui.thumbs.querySelectorAll("img[data-src]")) {
      img.src = img.dataset.src;
      img.removeAttribute("data-src");
    }
  }

  function thumbsVisible() {
    const view = doc.defaultView;
    return Boolean(view && ui.thumbs.offsetParent !== null && view.getComputedStyle?.(ui.thumbs).display !== "none");
  }

  function buildChips() {
    ui.chips.replaceChildren();
    ui.chips.hidden = !sections.length;
    sections.forEach((s, i) => {
      const b = el("button", "gf-gal-chip", { type: "button" });
      b.dataset.section = String(i);
      b.textContent = s.label || t("gallery.sectionN", { n: i + 1 });
      b.addEventListener("click", () => go(s.start));
      ui.chips.append(b);
    });
  }

  // ---- slide atual ----
  function teardownVideo() {
    try {
      videoHandle?.teardown?.();
    } catch {
      /* fachada já removida */
    }
    videoHandle = null;
  }

  function renderPhoto(step) {
    const src = opts.imageSrc?.(step, demo) || "";
    const wrap = el("div", "gf-gal-media is-loading");
    const img = el("img", "gf-gal-photo", { decoding: "async", draggable: "false" });
    img.alt = opts.altOf?.(step) ?? "";
    const fail = el("div", "gf-gal-error", { role: "status" });
    fail.hidden = true;
    const msg = el("p");
    msg.textContent = t("gallery.loadFailed");
    const retry = el("button", "gf-gal-retry", { type: "button" });
    retry.textContent = t("gallery.retry");
    retry.addEventListener("click", () => {
      fail.hidden = true;
      wrap.classList.add("is-loading");
      const s = img.src;
      img.removeAttribute("src");
      img.src = s;
    });
    fail.append(msg, retry);
    img.addEventListener("load", () => wrap.classList.remove("is-loading"));
    img.addEventListener("error", () => {
      wrap.classList.remove("is-loading");
      fail.hidden = !src;
    });
    if (src) img.src = src;
    else {
      wrap.classList.remove("is-loading");
      fail.hidden = false;
      retry.hidden = true;
    }
    wrap.append(img, fail);
    ui.backdrop.hidden = !src;
    if (src) ui.backdrop.src = src;
    return wrap;
  }

  function renderCard(step) {
    const card = el("div", "gf-gal-card");
    const h = el("h2", "gf-gal-card-title");
    h.textContent = plainText(step?.popover?.title || step?.label || "");
    const body = el("div", "gf-gal-card-body");
    renderRich(body, String(step?.popover?.description || ""));
    if (h.textContent) card.append(h);
    card.append(body);
    ui.backdrop.hidden = true;
    return card;
  }

  function renderVideo(step, index) {
    const wrap = el("div", "gf-gal-media gf-gal-videohost");
    const src = opts.imageSrc?.(step, demo) || "";
    if (src) {
      const poster = el("img", "gf-gal-poster", { alt: "", decoding: "async", draggable: "false" });
      poster.src = src;
      wrap.append(poster);
    }
    ui.backdrop.hidden = !src;
    if (src) ui.backdrop.src = src;
    videoHandle = opts.mountVideo?.(wrap, step, index) || null;
    if (!videoHandle) {
      const link = opts.videoLink?.(step);
      if (link?.href) {
        const a = el("a", "gf-gal-videolink", { target: "_blank", rel: "noopener noreferrer" });
        a.href = link.href;
        const ico = el("span", "gf-gal-videolink-ico", { "aria-hidden": "true" });
        ico.innerHTML = ICONS.play;
        const label = el("span");
        label.textContent = link.label || "";
        a.append(ico, label);
        wrap.append(a);
      }
    }
    return wrap;
  }

  function preload(i) {
    const step = steps[i];
    if (!step || step.type === "slide") return;
    const src = opts.imageSrc?.(step, demo);
    if (!src || typeof Image === "undefined") return;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }

  function paint() {
    const step = steps[current];
    const total = steps.length;
    const kind = currentKind();
    teardownVideo();
    cam = { scale: 1, x: 0, y: 0 };
    root.classList.remove("is-zoomed");
    root.dataset.kind = kind;
    let node;
    if (kind === "card") node = renderCard(step);
    else if (kind === "video") node = renderVideo(step, current);
    else node = renderPhoto(step);
    ui.slide.replaceChildren(node);
    if (!reduced()) {
      ui.slide.classList.remove("is-entering");
      void ui.slide.offsetWidth;
      ui.slide.classList.add("is-entering");
    }
    applyCam(cam);
    ui.zoom.hidden = kind !== "photo";

    const many = total > 1;
    root.classList.toggle("is-single", !many);
    ui.counter.hidden = !many;
    ui.counterText.textContent = t("gallery.counter", { n: current + 1, total });
    ui.counter.setAttribute("aria-label", t(gridOpen ? "gallery.hideAll" : "gallery.showAll", { n: current + 1, total }));
    ui.prev.hidden = !many;
    ui.next.hidden = !many;
    ui.prev.disabled = current === 0;
    const last = current === total - 1;
    ui.next.innerHTML = ICONS[last ? "done" : "next"];
    const nextLabel = t(last ? "gallery.finish" : "gallery.next");
    ui.next.setAttribute("aria-label", nextLabel);
    ui.next.title = nextLabel;
    ui.next.classList.toggle("is-finish", last);

    const sec = sectionIndexAt(sections, current);
    const secLabel = sec >= 0 ? sections[sec].label : "";
    ui.section.textContent = secLabel;
    ui.section.hidden = !secLabel;
    ui.slide.setAttribute("aria-label", t("gallery.counter", { n: current + 1, total }));
    for (const chip of ui.chips.children) {
      const on = Number(chip.dataset.section) === sec;
      if (on) chip.setAttribute("aria-current", "true");
      else chip.removeAttribute("aria-current");
    }
    ui.chips.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    for (const th of ui.thumbs.children) {
      if (Number(th.dataset.index) === current) th.setAttribute("aria-current", "true");
      else th.removeAttribute("aria-current");
    }
    if (thumbsVisible()) {
      fillThumbs();
      ui.thumbs.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }

    const cap = galleryCaption(step, strip);
    ui.caption.textContent = kind === "card" ? "" : cap.caption;
    ui.caption.hidden = kind === "card" || !cap.caption;
    ui.detailsBtn.hidden = kind === "card" || !cap.hasDetails;
    ui.details.replaceChildren();
    if (!ui.detailsBtn.hidden) renderRich(ui.details, cap.details);
    setDetails(false);
    ui.info.hidden = ui.caption.hidden && ui.detailsBtn.hidden && !ui.cta.childElementCount && kind === "card";

    opts.renderCta?.(ui.cta, current);
    root.classList.toggle("has-cta", Boolean(ui.cta.querySelector("a:not([hidden]), button:not([hidden])")));

    // why: 4.1.3 — "Foto 3 de 12, Plantas" anunciado a cada troca (o contador visível não é live)
    const say = t(kind === "photo" ? "gallery.announce" : "gallery.announceCard", { n: current + 1, total, section: secLabel ? `, ${secLabel}` : "", caption: kind === "card" ? plainText(step?.popover?.title || "") : cap.caption });
    ui.live.textContent = say.replace(/[,:\s]+$/, "");

    preload(current + 1);
    preload(current - 1);
  }

  function go(i, { report = true } = {}) {
    if (!open || !steps.length) return;
    const next = galleryStep(i, steps.length, 0);
    if (next === current) return;
    current = next;
    paint();
    if (report) opts.onChange?.(current);
  }

  function nextSlide({ fromGesture = false } = {}) {
    if (!open) return;
    if (current >= steps.length - 1) {
      // why: o último "›" do botão conclui (cartão final / analytics); deslizar ou → no fim não sai sem querer
      if (!fromGesture) finish();
      return;
    }
    go(current + 1);
  }

  function prevSlide() {
    if (!open || current <= 0) return;
    go(current - 1);
  }

  function finish() {
    if (!open) return;
    teardown();
    opts.onFinish?.();
  }

  function teardown() {
    open = false;
    teardownVideo();
    if (root) {
      root.hidden = true;
      root.classList.remove("is-grid-open", "is-details-open", "is-zoomed");
    }
    gridOpen = false;
    detailsOpen = false;
    doc.documentElement.classList.remove("gf-gallery-open");
  }

  function closeGallery(reason = "close") {
    if (!open) return;
    teardown();
    opts.onClose?.(reason);
  }

  function openGallery(nextDemo, { from = 0 } = {}) {
    demo = nextDemo;
    steps = Array.isArray(demo?.steps) ? demo.steps : [];
    if (!steps.length) return false;
    if (!root) build();
    sections = gallerySections(demo);
    const name = plainText(demo?.name || "");
    ui.title.textContent = name;
    root.setAttribute("aria-label", name ? t("gallery.regionNamed", { name }) : t("gallery.region"));
    buildChips();
    buildThumbs();
    root.classList.toggle("has-sections", sections.length > 0);
    open = true;
    root.hidden = false;
    doc.documentElement.classList.add("gf-gallery-open");
    current = -1;
    gridOpen = false;
    setGrid(false);
    go(galleryStep(from, steps.length, 0));
    if (opts.focus !== false) {
      lastFocus = doc.activeElement;
      root.focus({ preventScroll: true });
    }
    return true;
  }

  return {
    open: openGallery,
    close: closeGallery,
    /** Fecha sem avisar (stop do player, troca de idioma). */
    teardown,
    go,
    next: () => nextSlide(),
    prev: () => prevSlide(),
    closeLayer,
    isOpen: () => open,
    index: () => current,
    lastFocus: () => lastFocus,
    get root() {
      return root;
    },
  };
}

return { createGallery, galleryCaption, gallerySections };
})();
/* </gf-gallery> */

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

  // ---- Modo Galeria (playback.mode = "gallery"): carrossel de fotos, sem balões, destaques, avanço nem voz ----
  const galleryMode = Boolean(demo.playback && demo.playback.mode === "gallery");
  let gallery = null;

  function galleryAlt(step) {
    if (!step || step.altDecorative === true) return "";
    const own = String(step.alt || "").trim();
    if (own) return own.slice(0, 300);
    const title = String(step.popover?.title || step.label || "").trim();
    const desc = gfRichText.stripRichText(step.popover?.description || "", { sentences: true }).replace(/\s+/g, " ").trim();
    return [title, desc].filter(Boolean).join(": ").slice(0, 300);
  }

  function openGallery(from) {
    stop();
    if (!gallery) {
      gallery = gfGallery.createGallery({
        doc: document,
        t: gfT,
        richText: { render: (el, text) => gfRichText.renderRichText(el, text, document), strip: gfRichText.stripRichText },
        imageSrc: (step) => (step && step.image ? resolveImageSrc(step.image) : ""),
        altOf: galleryAlt,
        videoOf: (step) => stepVideoLink(step),
        // why: offline/file:// o YouTube recusa o embed — o vídeo vira pôster + link (igual ao modo guiado)
        videoLink: (step) => {
          const link = stepVideoLink(step);
          return link ? { href: link.href, label: gfT("video.openOn", { provider: link.provider }) } : null;
        },
        onChange: (i) => {
          activeIndex = i;
          if (startSel) startSel.value = String(i);
        },
        onFinish: () => setProgress(gfT("player.doneStatus")),
        onClose: () => setProgress(gfT("player.stopped")),
        reducedMotion: () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
      });
    }
    gallery.open(demo, { from });
  }

  document.getElementById("btn-play")?.addEventListener("click", () => {
    if (galleryMode) return openGallery(startIndex());
    buildAndDrive(startIndex(), { autoplay: false });
  });
  document.getElementById("btn-watch")?.addEventListener("click", () => {
    if (galleryMode) return openGallery(startIndex());
    buildAndDrive(startIndex(), { autoplay: true });
  });
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    if (galleryMode) return openGallery(0);
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
  // why: a Galeria abre direto na primeira foto (é um álbum, não um passo a passo com botão "Assistir")
  if (galleryMode && demo.steps.length) openGallery(0);
})();
