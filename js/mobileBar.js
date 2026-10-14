/**
 * Barra de ações do editor no celular + folha "Editar passo" (texto e narração).
 * why: no toque compacto o painel de propriedades e a barra de ferramentas ficavam ocultos,
 * então não dava para editar texto nem narração. A folha reaproveita o próprio #props-panel,
 * com os mesmos campos e a mesma regra de Pro dos botões de IA/áudio.
 */

/** Seção do painel que cada botão abre. */
export const SHEET_SECTIONS = { text: "texts", narration: "narration" };

/** Estado visível da barra: só no editor, fora da apresentação, no toque compacto. */
export function mobileBarVisible({ compact, view, presenting }) {
  return Boolean(compact) && view === "editor" && !presenting;
}

/** Espelha um botão de origem (oculto/desativado/rótulo/badge Pro) no botão da folha. */
export function mirrorState(src) {
  if (!src) return { hidden: true, disabled: true, label: "", pro: false };
  const badge = src.querySelector?.(".pro-badge");
  return {
    hidden: Boolean(src.hidden),
    disabled: Boolean(src.disabled),
    label: src.getAttribute?.("aria-label") || src.textContent?.trim() || "",
    pro: Boolean(badge && !badge.hidden),
  };
}

export function createMobileBar({ doc = document, t = (k) => k, onSettings } = {}) {
  const bar = doc.getElementById("mobile-bar");
  const backdrop = doc.getElementById("mobile-sheet-backdrop");
  const panel = doc.getElementById("props-panel");
  if (!bar || !panel) return { paint() {}, close() {} };
  const body = doc.body;
  const byAct = (a) => bar.querySelector(`[data-mbar="${a}"]`);

  // Cabeçalho da folha e botão de áudio espelhado (o original fica na barra do passo, oculta no celular)
  const head = doc.createElement("div");
  head.className = "mobile-sheet-head";
  head.innerHTML = `<span class="mobile-sheet-grab" aria-hidden="true"></span><strong class="mobile-sheet-title"></strong><button type="button" class="btn btn-primary mobile-sheet-done"></button>`;
  panel.prepend(head);
  const title = head.querySelector(".mobile-sheet-title");
  const done = head.querySelector(".mobile-sheet-done");

  const narrBody = panel.querySelector('[data-sec="narration"] .props-section-body');
  const audioRow = doc.createElement("div");
  audioRow.className = "mobile-sheet-audio";
  audioRow.innerHTML = `<button type="button" class="btn mobile-gen-audio"><svg class="btn-ai-spark" aria-hidden="true"><use href="#i-voice"></use></svg><span></span><span class="pro-badge" hidden><svg class="pro-badge-crown" aria-hidden="true"><use href="#i-crown"></use></svg>Pro</span></button><button type="button" class="btn mobile-upload-audio"><svg class="btn-ico" aria-hidden="true"><use href="#i-upload"></use></svg></button>`;
  narrBody?.append(audioRow);
  const genBtn = audioRow.querySelector(".mobile-gen-audio");
  const upBtn = audioRow.querySelector(".mobile-upload-audio");
  const srcGen = () => doc.getElementById("btn-generate-caption");
  const srcUp = () => doc.getElementById("btn-upload-caption");
  genBtn.addEventListener("click", () => srcGen()?.click());
  upBtn.addEventListener("click", () => srcUp()?.click());

  function paintAudio() {
    const g = mirrorState(srcGen());
    genBtn.hidden = g.hidden;
    genBtn.disabled = g.disabled;
    genBtn.querySelector("span").textContent = t("stb.generateAudio");
    genBtn.querySelector(".pro-badge").hidden = !g.pro;
    const u = mirrorState(srcUp());
    upBtn.hidden = u.hidden;
    upBtn.disabled = u.disabled;
    upBtn.setAttribute("aria-label", t("props.uploadAudio"));
    audioRow.hidden = genBtn.hidden && upBtn.hidden;
  }

  function paintHistory() {
    for (const a of ["undo", "redo"]) {
      const src = doc.getElementById(`btn-${a}`);
      byAct(a).disabled = !src || src.disabled;
    }
  }

  let openSec = "";
  function open(kind) {
    openSec = SHEET_SECTIONS[kind] || "texts";
    body.classList.add("is-props-sheet");
    body.dataset.sheetSec = openSec;
    if (backdrop) backdrop.hidden = false;
    title.textContent = t("mbar.sheet");
    done.textContent = t("mbar.done");
    for (const a of ["text", "narration"]) byAct(a).setAttribute("aria-expanded", String(SHEET_SECTIONS[a] === openSec));
    const sec = panel.querySelector(`[data-sec="${openSec}"]`);
    if (sec) sec.open = true;
    paintAudio();
  }
  function close() {
    if (!body.classList.contains("is-props-sheet")) return;
    body.classList.remove("is-props-sheet");
    delete body.dataset.sheetSec;
    openSec = "";
    if (backdrop) backdrop.hidden = true;
    for (const a of ["text", "narration"]) byAct(a).setAttribute("aria-expanded", "false");
  }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mbar]");
    if (!btn || btn.disabled) return;
    const act = btn.dataset.mbar;
    if (act === "undo" || act === "redo") doc.getElementById(`btn-${act}`)?.click();
    else if (act === "add") { close(); doc.getElementById("btn-add-step")?.click(); }
    else if (act === "text" || act === "narration") {
      if (openSec === SHEET_SECTIONS[act]) close();
      else open(act);
    } else if (act === "settings") { close(); onSettings?.(); }
  });
  done.addEventListener("click", close);
  backdrop?.addEventListener("click", close);
  doc.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // Mantém a barra em dia com desfazer/refazer e o botão de áudio do passo
  const mo = new MutationObserver(() => { paintHistory(); if (openSec) paintAudio(); });
  for (const id of ["btn-undo", "btn-redo", "btn-generate-caption", "btn-upload-caption"]) {
    const el = doc.getElementById(id);
    if (el) mo.observe(el, { attributes: true, subtree: true, attributeFilter: ["disabled", "hidden"] });
  }

  function paint(state) {
    const show = mobileBarVisible(state);
    bar.hidden = !show;
    body.classList.toggle("has-mobile-bar", show);
    if (!show) close();
    paintHistory();
  }
  return { paint, close, open };
}
