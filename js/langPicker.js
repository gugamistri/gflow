/**
 * Seletor de idioma compacto com bandeira (padrão único do GuiaFlow; referência de comportamento: leadpronto.ai).
 * Aprimora um <select> existente: o select continua sendo a fonte da verdade (id, value e evento "change"),
 * então quem já escutava o select não muda. Visual: botão com bandeira (+ nome opcional) e ▾; lista ARIA.
 * Teclado: ↓/↑/Enter/Espaço abrem; ↑/↓/Home/End navegam; Enter/Espaço escolhem; Esc fecha; letra pula.
 */
import { flagSvg } from "./flags.js";

let seq = 0;
const valueDesc = typeof HTMLSelectElement !== "undefined" ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value") : null;
const indexDesc = typeof HTMLSelectElement !== "undefined" ? Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex") : null;

const CHEVRON = '<svg class="lang-picker-caret" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK = '<svg class="lang-picker-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * @param {HTMLSelectElement} select
 * @param {{ label?: () => string, showName?: boolean, align?: "start"|"end", className?: string }} opts
 *   label: nome acessível do controle (ex.: "Editando em"); showName: mostra o nome do idioma no botão.
 */
export function enhanceLangSelect(select, { label = () => select.getAttribute("aria-label") || "", showName = false, align = "start", className = "" } = {}) {
  if (!select || select.dataset.langPicker === "1") return select?._langPicker || null;
  select.dataset.langPicker = "1";
  const id = `lang-picker-${++seq}`;
  const root = document.createElement("span");
  root.className = `lang-picker${showName ? " lang-picker-named" : ""}${className ? ` ${className}` : ""}`;
  root.dataset.align = align;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lang-picker-btn";
  btn.id = `${id}-btn`;
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", `${id}-list`);
  const list = document.createElement("ul");
  list.className = "lang-picker-list";
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  list.tabIndex = -1;
  list.hidden = true;
  root.append(btn, list);
  select.after(root);
  select.classList.add("lang-picker-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  let active = -1;
  const opts = () => [...select.options].filter((o) => !o.hidden);

  function paint() {
    const all = opts();
    const cur = select.options[select.selectedIndex] || all[0];
    const name = cur ? cur.textContent.trim() : "";
    const l = String(label() || "").replace(/[:：]\s*$/, "");
    btn.innerHTML = `${cur ? flagSvg(cur.value) : ""}${showName ? `<span class="lang-picker-name">${escapeHtml(name)}</span>` : ""}${CHEVRON}`;
    btn.setAttribute("aria-label", l ? `${l}: ${name}` : name);
    btn.title = l ? `${l}: ${name}` : name;
    btn.disabled = select.disabled || all.length < 1;
    list.setAttribute("aria-label", l || name);
    if (list.hidden) return;
    list.replaceChildren(...all.map((o, i) => {
      const li = document.createElement("li");
      li.id = `${id}-opt-${i}`;
      li.setAttribute("role", "option");
      li.className = "lang-picker-opt";
      li.dataset.value = o.value;
      const sel = o.value === select.value;
      li.setAttribute("aria-selected", sel ? "true" : "false");
      if (i === active) li.classList.add("is-active");
      li.innerHTML = `${flagSvg(o.value)}<span class="lang-picker-opt-name">${escapeHtml(o.textContent.trim())}</span>${sel ? CHECK : ""}`;
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("click", (e) => { e.stopPropagation(); choose(i); });
      li.addEventListener("mousemove", () => { if (active !== i) { active = i; paintActive(); } });
      return li;
    }));
    paintActive();
  }

  function paintActive() {
    const items = [...list.children];
    items.forEach((li, i) => li.classList.toggle("is-active", i === active));
    if (items[active]) {
      list.setAttribute("aria-activedescendant", items[active].id);
      items[active].scrollIntoView?.({ block: "nearest" });
    } else list.removeAttribute("aria-activedescendant");
  }

  function openList() {
    if (btn.disabled) return;
    const all = opts();
    active = Math.max(0, all.findIndex((o) => o.value === select.value));
    list.hidden = false;
    root.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    paint();
    list.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside, true);
  }

  function closeList({ focus = true } = {}) {
    if (list.hidden) return;
    list.hidden = true;
    root.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (focus) btn.focus({ preventScroll: true });
  }

  function outside(e) {
    if (!root.contains(e.target)) closeList({ focus: false });
  }

  function choose(i) {
    const o = opts()[i];
    closeList();
    if (!o || o.value === select.value) return;
    valueDesc ? valueDesc.set.call(select, o.value) : (select.value = o.value);
    paint();
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (list.hidden) openList();
    else closeList();
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(); }
  });
  list.addEventListener("click", (e) => e.stopPropagation());
  list.addEventListener("keydown", (e) => {
    const n = opts().length;
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % n; paintActive(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + n) % n; paintActive(); }
    else if (e.key === "Home") { e.preventDefault(); active = 0; paintActive(); }
    else if (e.key === "End") { e.preventDefault(); active = n - 1; paintActive(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeList(); }
    else if (e.key === "Tab") closeList({ focus: false });
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      const all = opts();
      for (let s = 1; s <= n; s += 1) {
        const j = (active + s) % n;
        if (all[j].textContent.trim().toLowerCase().startsWith(k)) { active = j; paintActive(); break; }
      }
    }
  });
  list.addEventListener("blur", (e) => { if (!root.contains(e.relatedTarget)) closeList({ focus: false }); });

  // why: o app troca options/valor por código (sem evento); o botão precisa acompanhar
  new MutationObserver(() => paint()).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "label"] });
  if (valueDesc) {
    Object.defineProperty(select, "value", { configurable: true, get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); paint(); } });
  }
  if (indexDesc) {
    Object.defineProperty(select, "selectedIndex", { configurable: true, get() { return indexDesc.get.call(this); }, set(v) { indexDesc.set.call(this, v); paint(); } });
  }
  select.addEventListener("change", () => paint());
  if (typeof window !== "undefined") window.addEventListener("ns-locale-change", () => paint());
  paint();
  const api = { root, button: btn, list, paint, open: openList, close: closeList };
  select._langPicker = api;
  return api;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
