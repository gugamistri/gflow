/**
 * Barra de formatação (B / I / U / lista) e atalhos Ctrl/⌘+B, I, U e Ctrl/⌘+Shift+8 nos campos de texto
 * com formatação leve: descrição do passo (painel e balão/slide no palco) e corpo dos passos inicial/final.
 * O campo guarda marcadores (**, *, ++, "- "); aqui só se embrulha a seleção — nada é convertido
 * sozinho enquanto se digita (um "*" solto continua "*").
 *
 * Funciona em <textarea> e em contenteditable de texto puro (o palco mostra os marcadores enquanto edita).
 * Teclado: Alt+F10 leva o foco para a barra; setas andam entre os botões; Esc volta ao campo.
 * No toque compacto a barra fica fixa acima do teclado, com alvos de 44 px.
 */
import { activeFormats, toggleList, toggleWrap } from "./tour-schema/richText.js";

export const FORMAT_KINDS = Object.freeze(["bold", "italic", "underline", "list"]);
const MARKER = { bold: "**", italic: "*", underline: "++" };
const SHORTCUT_KEY = { b: "bold", i: "italic", u: "underline" };

/** Atalho do teclado → formato (null se não for nosso). */
export function shortcutFormat(e, isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || "")) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return null;
  if (e.shiftKey && (e.code === "Digit8" || e.key === "*" || e.key === "8")) return "list";
  if (e.shiftKey) return null;
  return SHORTCUT_KEY[String(e.key || "").toLowerCase()] || null;
}

/** Novo texto + seleção depois de aplicar `kind`. Puro. */
export function applyFormatToText(value, start, end, kind) {
  if (kind === "list") return toggleList(value, start, end);
  return toggleWrap(value, start, end, MARKER[kind]);
}

// ---- texto e seleção de um campo (textarea ou contenteditable só com texto) ----

const isTextarea = (el) => el?.tagName === "TEXTAREA" || el?.tagName === "INPUT";

function readEditable(el) {
  return String(el.innerText ?? el.textContent ?? "").replace(/\u00a0/g, " ").replace(/\n$/, "");
}

/** Deslocamento em texto (contando \n de <br>/<div>) de um ponto (node, offset) dentro de `root`. */
function textOffset(root, node, offset) {
  const doc = root.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  const holder = doc.createElement("div");
  holder.style.cssText = "position:absolute;left:-9999px;white-space:pre-wrap";
  holder.appendChild(range.cloneContents());
  doc.body.appendChild(holder);
  const n = readEditable(holder).length;
  holder.remove();
  // innerText ignora o \n final; um <br> no fim do pedaço conta como quebra
  return n;
}

export function getFieldSelection(el) {
  if (isTextarea(el)) return { value: el.value, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
  const value = readEditable(el);
  const sel = el.ownerDocument.getSelection();
  if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return { value, start: value.length, end: value.length };
  const r = sel.getRangeAt(0);
  const start = Math.min(value.length, textOffset(el, r.startContainer, r.startOffset));
  const end = Math.min(value.length, textOffset(el, r.endContainer, r.endOffset));
  return { value, start, end };
}

/** Põe a seleção de texto [start, end) num contenteditable que só tem nós de texto. */
function setEditableSelection(el, start, end) {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startPt = null;
  let endPt = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.nodeValue.length;
    if (!startPt && start <= pos + len) startPt = [node, start - pos];
    if (!endPt && end <= pos + len) endPt = [node, end - pos];
    pos += len;
  }
  const range = doc.createRange();
  if (!startPt) range.selectNodeContents(el), range.collapse(false);
  else {
    range.setStart(startPt[0], startPt[1]);
    if (endPt) range.setEnd(endPt[0], endPt[1]);
    else range.collapse(true);
  }
  const sel = doc.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

export function setFieldSelection(el, start, end) {
  if (isTextarea(el)) el.setSelectionRange(start, end);
  else setEditableSelection(el, start, end);
}

/** Troca só o trecho que mudou (o Ctrl+Z do navegador desfaz a formatação). */
function replaceText(el, oldValue, nextValue) {
  let a = 0;
  while (a < oldValue.length && a < nextValue.length && oldValue[a] === nextValue[a]) a++;
  let b = 0;
  while (b < oldValue.length - a && b < nextValue.length - a && oldValue[oldValue.length - 1 - b] === nextValue[nextValue.length - 1 - b]) b++;
  const middle = nextValue.slice(a, nextValue.length - b);
  const doc = el.ownerDocument;
  if (isTextarea(el)) {
    el.setSelectionRange(a, oldValue.length - b);
    let ok = false;
    try {
      ok = doc.execCommand?.("insertText", false, middle) === true;
    } catch {
      ok = false;
    }
    if (!ok || el.value !== nextValue) {
      el.value = nextValue;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return;
  }
  // contenteditable: insertText no trecho (com desfazer); com quebra de linha o navegador poria
  // <br>/<div>, então aí troca o texto inteiro (só nós de texto)
  if (!middle.includes("\n")) {
    setEditableSelection(el, a, oldValue.length - b);
    let ok = false;
    try {
      ok = doc.execCommand?.("insertText", false, middle) === true;
    } catch {
      ok = false;
    }
    if (ok && readEditable(el) === nextValue && !el.querySelector("*")) return;
  }
  el.textContent = nextValue;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Aplica um formato no campo com foco, mantendo a seleção sobre o texto formatado. */
export function applyFormat(el, kind) {
  if (!el || !FORMAT_KINDS.includes(kind)) return false;
  const { value, start, end } = getFieldSelection(el);
  const next = applyFormatToText(value, start, end, kind);
  const max = Number(el.maxLength);
  if (isTextarea(el) && max > 0 && next.value.length > max) return false;
  if (next.value !== value) replaceText(el, value, next.value);
  setFieldSelection(el, next.start, next.end);
  return true;
}

// ---- barra ----

const ICONS = {
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zm0 7h7a3.5 3.5 0 0 1 0 7H7z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  italic: '<path d="M10 5h8M6 19h8M15 5 9 19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  list: '<path d="M10 6h10M10 12h10M10 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="5" cy="6" r="1.4" fill="currentColor"/><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="5" cy="18" r="1.4" fill="currentColor"/>',
};

function shortcutLabel(kind, isMac) {
  const mod = isMac ? "⌘" : "Ctrl+";
  if (kind === "list") return isMac ? "⌘⇧8" : "Ctrl+Shift+8";
  return `${mod}${{ bold: "B", italic: "I", underline: "U" }[kind]}`;
}

/**
 * Liga a barra aos campos. `isField(el)` diz se o elemento com foco aceita formatação;
 * `t(key)` traduz; `compact()` diz se é toque compacto (barra fixa acima do teclado).
 */
export function createRichTextToolbar({ doc = document, isField, t, compact = () => false } = {}) {
  const isMac = /Mac|iPhone|iPad/.test(doc.defaultView?.navigator?.platform || "");
  const bar = doc.createElement("div");
  bar.className = "rt-toolbar";
  bar.id = "rt-toolbar";
  bar.setAttribute("role", "toolbar");
  bar.hidden = true;
  const buttons = {};
  for (const kind of FORMAT_KINDS) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "rt-btn";
    btn.dataset.format = kind;
    btn.setAttribute("aria-pressed", "false");
    btn.tabIndex = kind === "bold" ? 0 : -1;
    // ícones fixos (sem texto do autor)
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[kind]}</svg>`;
    buttons[kind] = btn;
    bar.appendChild(btn);
  }
  doc.body.appendChild(bar);
  let field = null;

  function paintLabels() {
    bar.setAttribute("aria-label", t("rt.toolbar"));
    for (const kind of FORMAT_KINDS) {
      const label = t(`rt.${kind}`);
      const tip = `${label} (${shortcutLabel(kind, isMac)})`;
      buttons[kind].setAttribute("aria-label", label);
      buttons[kind].title = tip;
      buttons[kind].setAttribute("aria-keyshortcuts", kind === "list" ? (isMac ? "Meta+Shift+8" : "Control+Shift+8") : `${isMac ? "Meta" : "Control"}+${{ bold: "B", italic: "I", underline: "U" }[kind]}`);
    }
  }

  function paintState() {
    if (!field) return;
    const { value, start, end } = getFieldSelection(field);
    const on = activeFormats(value, start, end);
    for (const kind of FORMAT_KINDS) buttons[kind].setAttribute("aria-pressed", on[kind] ? "true" : "false");
  }

  function place() {
    if (!field || bar.hidden) return;
    const isCompact = compact();
    bar.classList.toggle("is-compact", isCompact);
    const win = doc.defaultView;
    if (isCompact) {
      const vv = win.visualViewport;
      const bottom = vv ? win.innerHeight - (vv.offsetTop + vv.height) : 0;
      bar.style.left = "";
      bar.style.top = "";
      bar.style.bottom = `${Math.max(0, Math.round(bottom))}px`;
      return;
    }
    bar.style.bottom = "";
    const r = field.getBoundingClientRect();
    const bw = bar.offsetWidth || 160;
    const bh = bar.offsetHeight || 36;
    let top = r.top - bh - 8;
    if (top < 8) top = r.bottom + 8;
    const left = Math.min(Math.max(8, r.right - bw), win.innerWidth - bw - 8);
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
    // dentro de um <dialog> com transform o "fixed" é relativo ao diálogo: corrige pela diferença
    const got = bar.getBoundingClientRect();
    const dx = got.left - left;
    const dy = got.top - top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      bar.style.left = `${Math.round(left - dx)}px`;
      bar.style.top = `${Math.round(top - dy)}px`;
    }
  }

  /** <dialog> aberto fica na camada de cima: a barra precisa morar dentro dele para aparecer. */
  function host(el) {
    const target = el.closest?.("dialog[open]") || doc.body;
    if (bar.parentNode !== target) target.appendChild(bar);
  }

  function show(el) {
    field = el;
    host(el);
    paintLabels();
    bar.hidden = false;
    bar.setAttribute("aria-controls", el.id || "");
    place();
    paintState();
  }

  function hide() {
    bar.hidden = true;
    field = null;
  }

  function run(kind) {
    if (!field) return;
    if (doc.activeElement !== field) field.focus();
    applyFormat(field, kind);
    paintState();
    place();
  }

  // why: pointerdown sem foco — a seleção do campo fica onde está
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".rt-btn")) e.preventDefault();
  });
  bar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".rt-btn")) e.preventDefault();
  });
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".rt-btn");
    if (btn) run(btn.dataset.format);
  });
  bar.addEventListener("keydown", (e) => {
    const list = FORMAT_KINDS.map((k) => buttons[k]);
    const i = list.indexOf(doc.activeElement);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = list[(i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
      list.forEach((b) => (b.tabIndex = b === next ? 0 : -1));
      next.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      field?.focus();
    }
  });

  doc.addEventListener("focusin", (e) => {
    const el = e.target;
    if (bar.contains(el)) return;
    if (isField(el)) show(el);
    else hide();
  });
  doc.addEventListener("focusout", (e) => {
    const next = e.relatedTarget;
    if (next && (bar.contains(next) || isField(next))) return;
    // foco foi para fora (ou para lugar nenhum): some
    setTimeout(() => {
      const a = doc.activeElement;
      if (!bar.contains(a) && !isField(a)) hide();
    }, 0);
  });
  doc.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!isField(el)) return;
    if (e.key === "F10" && e.altKey) {
      e.preventDefault();
      show(el);
      (FORMAT_KINDS.map((k) => buttons[k]).find((b) => b.tabIndex === 0) || buttons.bold).focus();
      return;
    }
    const kind = shortcutFormat(e, isMac);
    if (!kind) return;
    e.preventDefault();
    e.stopPropagation();
    if (field !== el) show(el);
    run(kind);
  }, true);
  doc.addEventListener("selectionchange", () => {
    if (field && doc.activeElement === field) paintState();
  });
  const win = doc.defaultView;
  win?.addEventListener("resize", place);
  win?.addEventListener("scroll", place, true);
  win?.visualViewport?.addEventListener("resize", place);
  win?.visualViewport?.addEventListener("scroll", place);

  return { el: bar, show, hide, place, paintLabels, get field() { return field; } };
}
