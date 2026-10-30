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

export const RICH_TEXT_MARKERS = Object.freeze({ bold: "**", italic: "*", underline: "++", list: "- " });

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
export const RICH_TEXT_MAX_LINE = 6000;

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
export function parseInline(line) {
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
export function parseRichText(text) {
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
export function hasRichFormatting(text) {
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
export function stripRichText(text, { sentences = false, bullet = "" } = {}) {
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
export function richTextLength(text) {
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
export function richTextHtml(text) {
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
export function renderRichText(container, text, doc = container?.ownerDocument) {
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
export function normalizeRichText(text) {
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

// ---- edição (barra B / I / U / lista e atalhos): funções puras sobre texto + seleção ----

/**
 * Liga/desliga um marcador em volta da seleção [start, end).
 * Seleção vazia: insere o par e põe o cursor no meio (o que for digitado sai formatado).
 * Já marcado (marcador dentro ou logo fora da seleção): tira.
 */
export function toggleWrap(value, start, end, marker) {
  const v = String(value ?? "");
  const m = marker;
  let a = Math.max(0, Math.min(start, end, v.length));
  let b = Math.max(a, Math.min(Math.max(start, end), v.length));
  // não leva espaços das pontas para dentro do marcador ("**texto **" não fecharia)
  while (a < b && /\s/.test(v[a])) a++;
  while (b > a && /\s/.test(v[b - 1])) b--;
  const sel = v.slice(a, b);
  const ch = m[0];
  const lead = (s) => runLength(s, 0, ch);
  const trail = (s) => runLength([...s].reverse().join(""), 0, ch);
  const has = (l, t) => (m === "*" ? l % 2 === 1 && t % 2 === 1 : l >= m.length && t >= m.length);
  if (sel.length > m.length * 2 && has(lead(sel), trail(sel))) {
    const inner = sel.slice(m.length, sel.length - m.length);
    return { value: v.slice(0, a) + inner + v.slice(b), start: a, end: a + inner.length };
  }
  const before = trail(v.slice(0, a));
  const after = lead(v.slice(b));
  if (sel && has(before, after)) {
    return { value: v.slice(0, a - m.length) + sel + v.slice(b + m.length), start: a - m.length, end: b - m.length };
  }
  if (!sel) {
    // cursor: entra o par e o cursor fica no meio (o que for digitado sai formatado)
    return { value: v.slice(0, a) + m + m + v.slice(a), start: a + m.length, end: a + m.length };
  }
  // várias linhas: marca cada linha (o marcador não atravessa linha); "- " do item fica de fora
  const wrapped = sel
    .split("\n")
    .map((line) => {
      const item = /^([ \t]{0,3}- )(.*)$/.exec(line);
      const head = item ? item[1] : "";
      const body = item ? item[2] : line;
      const l = body.match(/^\s*/)[0];
      const t = body.match(/\s*$/)[0];
      const core = body.slice(l.length, body.length - t.length);
      return core ? `${head}${l}${m}${core}${m}${t}` : line;
    })
    .join("\n");
  return { value: v.slice(0, a) + wrapped + v.slice(b), start: a, end: a + wrapped.length };
}

/** Marca/desmarca como lista as linhas tocadas pela seleção. Todas já são itens → tira; senão põe "- ". */
export function toggleList(value, start, end) {
  const v = String(value ?? "");
  const s = Math.max(0, Math.min(start, end, v.length));
  const e = Math.max(s, Math.min(Math.max(start, end), v.length));
  const lineStart = v.lastIndexOf("\n", s - 1) + 1;
  let lineEnd = v.indexOf("\n", e > s && v[e - 1] === "\n" ? e - 1 : e);
  if (lineEnd < 0) lineEnd = v.length;
  const lines = v.slice(lineStart, lineEnd).split("\n");
  const allItems = lines.every((l) => !l.trim() || LIST_RE.test(l)) && lines.some((l) => LIST_RE.test(l));
  const next = lines.map((l) => {
    if (allItems) return l.replace(/^[ \t]{0,3}- /, "");
    if (!l.trim() || LIST_RE.test(l)) return l;
    return `- ${l}`;
  });
  const block = next.join("\n");
  if (lines.length === 1 && !lines[0].trim() && !allItems) {
    const out = v.slice(0, lineStart) + "- " + v.slice(lineEnd);
    return { value: out, start: lineStart + 2, end: lineStart + 2 };
  }
  const delta = block.length - (lineEnd - lineStart);
  const collapsed = s === e;
  const caret = Math.max(lineStart, s + (allItems ? -2 : 2));
  return {
    value: v.slice(0, lineStart) + block + v.slice(lineEnd),
    start: collapsed ? Math.min(caret, lineStart + block.length) : lineStart,
    end: collapsed ? Math.min(caret, lineStart + block.length) : lineEnd + delta,
  };
}

/** Quais formatos valem no cursor/seleção (para aria-pressed da barra). */
export function activeFormats(value, start, end) {
  const v = String(value ?? "");
  const lineStart = v.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let lineEnd = v.indexOf("\n", start);
  if (lineEnd < 0) lineEnd = v.length;
  const line = v.slice(lineStart, lineEnd);
  const item = listItem(line);
  const offset = item !== null ? line.length - item.length : 0;
  const nodes = parseInline(item !== null ? item : line);
  // mapeia posições do texto cru para os nós: percorre recomputando os comprimentos com marcadores
  const at = Math.max(0, start - lineStart - offset);
  const active = new Set();
  const src = item !== null ? item : line;
  const marks = { b: "**", i: "*", u: "++" };
  let pos = 0;
  const visit = (list, stack) => {
    for (const n of list) {
      if (n.t === "text") {
        // escapes ocupam 2 caracteres no cru e 1 no nó
        let raw = 0;
        for (let k = 0; k < n.v.length; k++) raw += src[pos + raw] === "\\" ? 2 : 1;
        if (at >= pos && at <= pos + raw) for (const t of stack) active.add(t);
        pos += raw;
      } else {
        pos += marks[n.t].length;
        visit(n.c, [...stack, n.t]);
        pos += marks[n.t].length;
      }
    }
  };
  visit(nodes, []);
  return { bold: active.has("b"), italic: active.has("i"), underline: active.has("u"), list: item !== null };
}
