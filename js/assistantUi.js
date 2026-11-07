/**
 * Interface do assistente de criação: um diálogo em etapas sobre o núcleo de assistant.js.
 * Não publica nada: a última etapa só abre a prévia e o menu Compartilhar do editor.
 */
import {
  ASSISTANT_STAGES,
  acceptSuggestion,
  addMaterial,
  applyAiResponse,
  applyPlan,
  buildAssistantPrompt,
  buildStructure,
  canApply,
  checkMaterialFile,
  chooseMode,
  confirmItem,
  createDraft,
  editItem,
  editSuggestion,
  findGaps,
  markApplied,
  moveMaterial,
  projectFromDraft,
  recommendMode,
  regenerableItems,
  rejectSuggestion,
  removeMaterial,
  reachableStage,
  reviewSummary,
  sceneOptions,
  stageIndex,
  updateBrief,
  updateCta,
  updateMaterial,
} from "./assistant.js";
import { clearDraft, loadDraft, saveDraft } from "./assistantStore.js";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageSize(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

const TEMPLATES = ["produto", "empreendimento", "veiculo"];
const IDEAS = [
  ["product", "assistant.brief.idea.product"],
  ["realEstate", "assistant.brief.idea.realEstate"],
  ["vehicle", "assistant.brief.idea.vehicle"],
  ["software", "assistant.brief.idea.software"],
  ["process", "assistant.brief.idea.process"],
];

/**
 * @param {{
 *   t: (key: string, vars?: object) => string,
 *   getLocale: () => string,
 *   toast: (msg: string, ms?: number) => void,
 *   aiAccess: () => Promise<"hosted"|"byok"|"none">,
 *   completeHosted: (prompt: string) => Promise<{ok: boolean, text?: string, handled?: boolean}>,
 *   completeByok: (prompt: string) => Promise<{ok: boolean, text?: string}>,
 *   createProject: (build: (base: object) => object) => Promise<{id: string, name: string}>,
 *   projectExists: (id: string) => Promise<boolean>,
 *   openProject: (id: string) => Promise<void>,
 *   openPreview: () => void,
 *   openShare: () => void,
 *   sceneName: (template: string, n: number, fallback: string) => string,
 * }} ctx
 */
export function createAssistantUi(ctx) {
  const { t } = ctx;
  let dialog = null;
  let draft = null;
  let busy = "";
  let notice = { text: "", tone: "" };
  let saveTimer = 0;
  let applying = false;

  function save(now = false) {
    clearTimeout(saveTimer);
    const run = () => draft && void saveDraft(draft);
    if (now) run();
    else saveTimer = setTimeout(run, 300);
  }

  function setNotice(text, tone = "") {
    notice = { text, tone };
    const el = dialog?.querySelector("[data-asst-notice]");
    if (el) {
      el.textContent = text;
      el.dataset.tone = tone;
      el.hidden = !text;
    }
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "studio-modal assistant-modal";
    dialog.id = "modal-assistant";
    dialog.setAttribute("aria-labelledby", "assistant-title");
    document.body.append(dialog);
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("input", onInput);
    dialog.addEventListener("change", onChange);
    dialog.addEventListener("close", () => save(true));
    dialog.addEventListener("cancel", () => save(true));
    return dialog;
  }

  function factsTitle() {
    return t(`assistant.structure.factsTitle.${draft.template || "produto"}`);
  }

  function rebuild() {
    buildStructure(draft, { factsTitle: factsTitle(), untitled: t("assistant.structure.untitled") });
  }

  function goTo(stage) {
    const target = stageIndex(stage);
    const max = stageIndex(reachableStage(draft));
    // why: voltar é livre; avançar só até a etapa liberada (a anterior pronta)
    const next = ASSISTANT_STAGES[Math.min(target, Math.max(max, stageIndex(draft.stage)))];
    if (next === "mode" && !draft.mode) {
      const reco = recommendMode(draft);
      chooseMode(draft, { ...reco, by: "recommendation" });
    }
    if (next === "structure" || next === "review") rebuild();
    draft.stage = next;
    setNotice("");
    save();
    render();
  }

  function flagList(flags = []) {
    return flags
      .map((f) => (f.startsWith("number:") ? t("assistant.flag.number", { n: f.slice(7) }) : t(`assistant.flag.${f}`)))
      .join(", ");
  }

  function stagesNav() {
    const max = stageIndex(reachableStage(draft));
    return `<ol class="asst-stages" aria-label="${esc(t("assistant.stagesAria"))}">${ASSISTANT_STAGES.map((s, i) => {
      const current = s === draft.stage;
      const locked = i > Math.max(max, stageIndex(draft.stage));
      return `<li><button type="button" class="asst-stage${current ? " is-current" : ""}" data-asst-go="${s}" ${current ? 'aria-current="step"' : ""} ${locked ? "disabled" : ""}><span class="asst-stage-n">${i + 1}</span><span class="asst-stage-label">${esc(t(`assistant.stage.${s}`))}</span></button></li>`;
    }).join("")}</ol>`;
  }

  function viewBrief() {
    const cta = draft.cta;
    return `
      <label>${esc(t("assistant.brief.goal"))}
        <textarea rows="3" maxlength="500" data-asst-field="goal" placeholder="${esc(t("assistant.brief.goalPh"))}">${esc(draft.brief.goal)}</textarea>
      </label>
      <div class="asst-ideas" role="group" aria-label="${esc(t("assistant.brief.ideas"))}">
        ${IDEAS.map(([id, key]) => `<button type="button" class="btn btn-sm asst-chip" data-asst-idea="${id}">${esc(t(key))}</button>`).join("")}
      </div>
      <label>${esc(t("assistant.brief.audience"))}
        <input type="text" maxlength="500" data-asst-field="audience" value="${esc(draft.brief.audience)}" placeholder="${esc(t("assistant.brief.audiencePh"))}" />
      </label>
      <label>${esc(t("assistant.brief.name"))}
        <input type="text" maxlength="80" data-asst-field="name" value="${esc(draft.brief.name)}" placeholder="${esc(t("assistant.brief.namePh"))}" />
      </label>
      <fieldset class="asst-cta">
        <legend>${esc(t("assistant.cta.label"))}</legend>
        <div class="asst-seg">
          ${["none", "whatsapp", "link"].map((k) => `<label class="asst-seg-opt"><input type="radio" name="asst-cta" value="${k}" data-asst-cta-kind ${cta.kind === k ? "checked" : ""} /><span>${esc(t(`assistant.cta.${k}`))}</span></label>`).join("")}
        </div>
        ${cta.kind === "none" ? "" : `
        <label>${esc(t(cta.kind === "whatsapp" ? "assistant.cta.wa" : "assistant.cta.url"))}
          <input type="${cta.kind === "whatsapp" ? "tel" : "url"}" data-asst-cta="value" value="${esc(cta.value)}" ${cta.kind === "whatsapp" ? 'inputmode="tel" placeholder="+55 11 91234-5678"' : 'placeholder="https://"'} />
        </label>
        <label>${esc(t("assistant.cta.buttonLabel"))}
          <input type="text" maxlength="40" data-asst-cta="label" value="${esc(cta.label)}" />
        </label>`}
      </fieldset>`;
  }

  function sceneSelect(m) {
    const scenes = sceneOptions(draft);
    if (!scenes.length) return "";
    return `<label class="asst-inline">${esc(t("assistant.structure.scene"))}
      <select data-asst-scene="${esc(m.id)}">${scenes.map((s) => `<option value="${s.scene}" ${m.scene === s.scene ? "selected" : ""}>${esc(ctx.sceneName(draft.template, s.scene, s.name))}</option>`).join("")}</select>
    </label>`;
  }

  function viewMaterials() {
    const list = draft.materials.length
      ? `<ul class="asst-materials">${draft.materials.map((m, i) => `
          <li class="asst-material">
            <img src="${esc(m.dataUrl)}" alt="" width="96" height="72" />
            <div class="asst-material-body">
              <label>${esc(t("assistant.materials.note"))}
                <textarea rows="2" maxlength="600" data-asst-note="${esc(m.id)}" placeholder="${esc(t("assistant.materials.notePh"))}">${esc(m.note)}</textarea>
              </label>
              <div class="asst-material-tools">
                <span class="asst-file" title="${esc(m.name)}">${esc(m.name)}</span>
                ${draft.mode === "gallery" ? sceneSelect(m) : ""}
                <button type="button" class="btn btn-sm btn-icon" data-asst-move="${esc(m.id)}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="${esc(t("assistant.materials.up"))}" title="${esc(t("assistant.materials.up"))}">↑</button>
                <button type="button" class="btn btn-sm btn-icon" data-asst-move="${esc(m.id)}" data-dir="1" ${i === draft.materials.length - 1 ? "disabled" : ""} aria-label="${esc(t("assistant.materials.down"))}" title="${esc(t("assistant.materials.down"))}">↓</button>
                <button type="button" class="btn btn-sm" data-asst-remove="${esc(m.id)}">${esc(t("assistant.materials.remove"))}</button>
              </div>
            </div>
          </li>`).join("")}</ul>`
      : `<p class="asst-empty">${esc(t("assistant.materials.empty"))}</p>`;
    return `
      <p class="asst-lead">${esc(t("assistant.materials.lead"))}</p>
      <div><button type="button" class="btn" data-asst-add>${esc(t("assistant.materials.add"))}</button>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden data-asst-file /></div>
      ${list}
      <label>${esc(t("assistant.materials.facts"))}
        <textarea rows="4" maxlength="2000" data-asst-field="facts" placeholder="${esc(t("assistant.materials.factsPh"))}">${esc(draft.facts)}</textarea>
      </label>`;
  }

  function viewMode() {
    const reco = recommendMode(draft);
    return `
      <p class="asst-reco" role="status">${esc(t(`assistant.reco.${reco.reason}`))}</p>
      <fieldset class="mode-picker asst-mode">
        <legend>${esc(t("assistant.mode.lead"))}</legend>
        ${["gallery", "guided"].map((m) => `
          <label class="mode-option">
            <input type="radio" name="asst-mode" value="${m}" data-asst-mode ${draft.mode === m ? "checked" : ""} />
            <span class="mode-option-text">
              <span class="mode-option-title">${esc(t(`assistant.mode.${m}`))}</span>
              <span class="mode-option-hint">${esc(t(`assistant.mode.${m}Hint`))}</span>
            </span>
          </label>`).join("")}
      </fieldset>
      ${draft.mode === "gallery" ? `
      <label>${esc(t("assistant.mode.template"))}
        <select data-asst-template>${TEMPLATES.map((k) => `<option value="${k}" ${draft.template === k ? "selected" : ""}>${esc(t(`newProject.kind.${k}`))}</option>`).join("")}</select>
      </label>
      <p class="asst-hint">${sceneOptions(draft).map((s) => esc(ctx.sceneName(draft.template, s.scene, s.name))).join(" · ")}</p>
      ${draft.materials.length ? `<ul class="asst-materials asst-materials-compact">${draft.materials.map((m) => `<li class="asst-material"><img src="${esc(m.dataUrl)}" alt="" width="64" height="48" /><div class="asst-material-body"><span class="asst-file">${esc(m.note.split("\n")[0] || m.name)}</span>${sceneSelect(m)}</div></li>`).join("")}</ul>` : ""}` : ""}`;
  }

  function gapsBlock() {
    const gaps = findGaps(draft);
    if (!gaps.length) return "";
    return `<section class="asst-gaps" aria-labelledby="asst-gaps-h"><h4 id="asst-gaps-h">${esc(t("assistant.gaps.title"))}</h4><ul>${gaps.map((g) => `<li class="${g.blocking ? "is-blocking" : ""}">${esc(t(`assistant.gap.${g.id}`, { n: g.count || 0 }))}</li>`).join("")}</ul></section>`;
  }

  function itemCard(it) {
    const m = draft.materials.find((x) => x.id === it.materialId);
    const s = draft.suggestions[it.key];
    const confirmed = it.status === "confirmed";
    const scenes = sceneOptions(draft);
    const sceneLabel = scenes.length ? ctx.sceneName(draft.template, it.scene, scenes.find((x) => x.scene === it.scene)?.name || "") : "";
    return `
      <li class="asst-item${confirmed ? " is-confirmed" : ""}" data-key="${esc(it.key)}">
        <div class="asst-item-media">${m ? `<img src="${esc(m.dataUrl)}" alt="" width="120" height="80" />` : `<span class="asst-slide-tag">${esc(t("assistant.structure.slide"))}</span>`}
          ${sceneLabel ? `<span class="asst-scene-tag">${esc(sceneLabel)}</span>` : ""}</div>
        <div class="asst-item-body">
          <label>${esc(t("assistant.structure.itemTitle"))}
            <input type="text" maxlength="60" data-asst-item="title" value="${esc(it.title)}" ${confirmed ? "readonly" : ""} />
          </label>
          <label>${esc(t("assistant.structure.itemText"))}
            <textarea rows="2" data-asst-item="text" ${confirmed ? "readonly" : ""}>${esc(it.text)}</textarea>
          </label>
          ${it.flags?.length ? `<p class="asst-flag" role="alert">${esc(t("assistant.item.flagged", { list: flagList(it.flags) }))}</p>` : ""}
          ${s ? `
          <div class="asst-suggestion">
            <p class="asst-suggestion-label">${esc(t("assistant.suggestion"))}</p>
            <p class="asst-suggestion-title">${esc(s.title)}</p>
            ${s.text ? `<p class="asst-suggestion-text">${esc(s.text)}</p>` : ""}
            ${s.flags?.length ? `<p class="asst-flag" role="alert">${esc(t("assistant.suggestion.flagged", { list: flagList(s.flags) }))}</p>` : ""}
            <div class="asst-row">
              ${s.flags?.length ? "" : `<button type="button" class="btn btn-sm btn-primary" data-asst-accept>${esc(t("assistant.suggestion.accept"))}</button>`}
              <button type="button" class="btn btn-sm" data-asst-edit-s>${esc(t("assistant.suggestion.edit"))}</button>
              <button type="button" class="btn btn-sm" data-asst-reject>${esc(t("assistant.suggestion.reject"))}</button>
            </div>
          </div>` : ""}
          <div class="asst-row">
            ${confirmed
              ? `<span class="asst-confirmed">✓ ${esc(t("assistant.structure.confirmed"))}</span><button type="button" class="btn btn-sm" data-asst-reopen>${esc(t("assistant.structure.reopen"))}</button>`
              : `<button type="button" class="btn btn-sm" data-asst-confirm ${it.flags?.length ? "disabled" : ""}>${esc(t("assistant.structure.confirm"))}</button>`}
          </div>
        </div>
      </li>`;
  }

  function viewStructure() {
    const open = regenerableItems(draft).length;
    const hasSuggestions = Object.keys(draft.suggestions).length > 0;
    return `
      <p class="asst-lead">${esc(t("assistant.structure.lead"))}</p>
      ${gapsBlock()}
      <div class="asst-ai">
        <button type="button" class="btn" data-asst-ai ${busy === "ai" || !open ? "disabled" : ""}>
          <svg class="btn-ico" aria-hidden="true"><use href="#i-sparkles"></use></svg>
          <span>${esc(t(hasSuggestions || draft.items.some((it) => it.origin === "ai") ? "assistant.ai.regen" : "assistant.ai.suggest"))}</span>
        </button>
        <p class="asst-hint" data-asst-ai-notice></p>
        <button type="button" class="btn btn-sm" data-asst-key hidden>${esc(t("assistant.ai.useKey"))}</button>
      </div>
      <ol class="asst-items">${draft.items.map(itemCard).join("")}</ol>`;
  }

  function viewReview() {
    const sum = reviewSummary(draft);
    const plan = applyPlan(draft);
    const gate = canApply(draft);
    const ctaText = draft.cta.kind === "none" ? t("assistant.review.ctaNone") : `${t(`assistant.cta.${draft.cta.kind}`)} — ${draft.cta.value}`;
    return `
      <p class="asst-lead">${esc(t("assistant.review.lead"))}</p>
      ${gapsBlock()}
      <dl class="asst-summary">
        <dt>${esc(t("assistant.review.mode"))}</dt><dd>${esc(draft.mode === "gallery" ? t(`newProject.kind.${draft.template}`) : t("assistant.mode.guided"))}</dd>
        <dt>${esc(t("assistant.stage.structure"))}</dt><dd>${esc(t("assistant.review.items", { n: sum.total, c: sum.confirmed }))}</dd>
        <dt>${esc(t("assistant.review.cta"))}</dt><dd>${esc(ctaText)}</dd>
      </dl>
      <ul class="asst-checks">
        <li>${esc(t("assistant.review.capture"))}</li>
        <li>${esc(t(draft.mode === "gallery" ? "assistant.review.narrationGallery" : "assistant.review.narrationGuide"))}</li>
        <li>${esc(t("assistant.review.integrations"))}</li>
        ${sum.pendingSuggestions ? `<li>${esc(t("assistant.review.pendingSuggestions", { n: sum.pendingSuggestions }))}</li>` : ""}
      </ul>
      ${plan.action === "create" && plan.version > 1 ? `<p class="asst-flag">${esc(t("assistant.review.newVersion", { v: plan.version }))}</p>` : ""}
      ${gate.ok ? "" : `<p class="asst-flag" role="alert">${esc(t(`assistant.review.blocked.${gate.reason}`))}</p>`}`;
  }

  function viewPublish() {
    return `
      <p class="asst-ok" role="status">${esc(t("assistant.publish.applied", { name: draft.brief.name || "" }))}</p>
      <p class="asst-lead">${esc(t("assistant.publish.lead"))}</p>
      <ul class="asst-checks">
        <li>${esc(t("assistant.publish.check1"))}</li>
        <li>${esc(t("assistant.publish.check2"))}</li>
        <li>${esc(t("assistant.publish.check3"))}</li>
        ${draft.mode === "guided" ? `<li>${esc(t("assistant.publish.checkGuide"))}</li>` : ""}
      </ul>
      <div class="asst-row">
        <button type="button" class="btn" data-asst-open="preview">${esc(t("assistant.publish.preview"))}</button>
        <button type="button" class="btn" data-asst-open="editor">${esc(t("assistant.publish.editor"))}</button>
        <button type="button" class="btn btn-primary" data-asst-open="share">${esc(t("assistant.publish.share"))}</button>
      </div>
      <p><button type="button" class="btn btn-sm" data-asst-restart>${esc(t("assistant.publish.restart"))}</button></p>`;
  }

  function footer() {
    const i = stageIndex(draft.stage);
    const back = i > 0 && draft.stage !== "publish" ? `<button type="button" class="btn" data-asst-back>${esc(t("assistant.back"))}</button>` : "";
    let next = "";
    if (draft.stage === "review") {
      const gate = canApply(draft);
      next = `<button type="button" class="btn btn-primary" data-asst-apply ${!gate.ok || applying ? "disabled" : ""}>${esc(t(applying ? "assistant.review.applying" : "assistant.review.apply"))}</button>`;
    } else if (draft.stage !== "publish") {
      const target = ASSISTANT_STAGES[i + 1];
      const allowed = stageIndex(reachableStage(draft)) >= i + 1 || (draft.stage === "structure");
      next = `<button type="button" class="btn btn-primary" data-asst-go="${target}" ${allowed ? "" : "disabled"}>${esc(t("assistant.next"))}</button>`;
    }
    return `<div class="studio-modal-actions asst-actions"><span class="asst-saved">${esc(t("assistant.saved"))}</span>${back}${next}</div>`;
  }

  function render() {
    if (!dialog || !draft) return;
    const views = { brief: viewBrief, materials: viewMaterials, mode: viewMode, structure: viewStructure, review: viewReview, publish: viewPublish };
    const scroll = dialog.querySelector(".asst-body")?.scrollTop || 0;
    dialog.innerHTML = `
      <div class="studio-modal-body assistant-body">
        <header class="asst-head">
          <h3 id="assistant-title">${esc(t("assistant.title"))} <span class="asst-free-badge">${esc(t("assistant.freeBadge"))}</span></h3>
          <button type="button" class="btn btn-ghost btn-icon" data-asst-close aria-label="${esc(t("assistant.close"))}" title="${esc(t("assistant.close"))}">✕</button>
        </header>
        ${stagesNav()}
        <p class="asst-notice" data-asst-notice role="status" aria-live="polite" data-tone="${esc(notice.tone)}" ${notice.text ? "" : "hidden"}>${esc(notice.text)}</p>
        <div class="asst-body" data-stage="${draft.stage}">${views[draft.stage]()}</div>
        ${footer()}
      </div>`;
    const body = dialog.querySelector(".asst-body");
    if (body) body.scrollTop = scroll;
    void paintAiNotice();
  }

  async function paintAiNotice() {
    const el = dialog?.querySelector("[data-asst-ai-notice]");
    if (!el) return;
    const access = await ctx.aiAccess();
    el.textContent = access === "hosted" ? t("assistant.ai.notice") : access === "byok" ? t("assistant.ai.noticeByok") : t("assistant.ai.locked");
    const keyBtn = dialog?.querySelector("[data-asst-key]");
    if (keyBtn) keyBtn.hidden = access !== "none";
  }

  async function addFiles(files) {
    for (const file of [...files]) {
      const check = checkMaterialFile(file, draft.materials.length);
      if (!check.ok) {
        const key = check.reason === "type" ? "assistant.materials.errType" : check.reason === "size" ? "assistant.materials.errSize" : "assistant.materials.errMany";
        setNotice(t(key, { name: file.name }), "error");
        if (check.reason === "tooMany") break;
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const size = await imageSize(dataUrl);
        if (!addMaterial(draft, { name: file.name, dataUrl, ...size })) setNotice(t("assistant.materials.errType", { name: file.name }), "error");
      } catch {
        setNotice(t("assistant.materials.errType", { name: file.name }), "error");
      }
    }
    const keep = notice;
    save();
    render();
    if (keep.text) setNotice(keep.text, keep.tone);
  }

  async function runAi() {
    if (busy) return;
    const items = regenerableItems(draft);
    if (!items.length) {
      setNotice(t("assistant.ai.none"));
      return;
    }
    const access = await ctx.aiAccess();
    if (access === "none") {
      // why: a mesma frase já está ao lado do botão; destaca em vez de repetir no topo.
      const hint = dialog?.querySelector("[data-asst-ai-notice]");
      if (hint) hint.dataset.attention = "1";
      else setNotice(t("assistant.ai.locked"));
      return;
    }
    busy = "ai";
    render();
    setNotice(t("assistant.ai.generating"));
    const prompt = buildAssistantPrompt(draft, { locale: ctx.getLocale() });
    let res;
    try {
      res = access === "hosted" ? await ctx.completeHosted(prompt) : await ctx.completeByok(prompt);
    } catch {
      res = { ok: false };
    }
    busy = "";
    if (!res?.ok) {
      render();
      if (!res?.handled) setNotice(t("assistant.ai.failed"), "error");
      else setNotice("");
      return;
    }
    const parsed = applyAiResponse(draft, res.text || "");
    save();
    render();
    setNotice(parsed.ok ? t("assistant.ai.ready") : t("assistant.ai.parse"), parsed.ok ? "ok" : "error");
  }

  async function apply() {
    if (applying) return;
    const gate = canApply(draft);
    if (!gate.ok) return;
    applying = true;
    render();
    try {
      const plan = applyPlan(draft);
      if (plan.action === "open" && (await ctx.projectExists(plan.projectId))) {
        draft.stage = "publish";
      } else {
        const version = plan.action === "create" ? plan.version : 1;
        const snapshot = JSON.parse(JSON.stringify(draft));
        if (version > 1) snapshot.brief.name = `${snapshot.brief.name || ""} (${version})`.trim();
        const created = await ctx.createProject((base) =>
          projectFromDraft(snapshot, base, { sceneFallback: snapshot.brief.name || base.name, sceneName: ctx.sceneName })
        );
        markApplied(draft, created.id, version);
        if (version > 1) draft.brief.name = snapshot.brief.name;
      }
      save(true);
    } catch {
      setNotice(t("assistant.review.failed"), "error");
    } finally {
      applying = false;
      render();
    }
  }

  async function openTarget(kind) {
    if (!draft.applied?.projectId) return;
    save(true);
    dialog.close();
    await ctx.openProject(draft.applied.projectId);
    if (kind === "preview") ctx.openPreview();
    else if (kind === "share") ctx.openShare();
  }

  function onClick(e) {
    const el = e.target.closest("button, [data-asst-add]");
    if (!el || !draft) return;
    if (el.matches("[data-asst-close]")) {
      save(true);
      dialog.close();
      return;
    }
    if (el.dataset.asstGo) return goTo(el.dataset.asstGo);
    if (el.matches("[data-asst-back]")) return goTo(ASSISTANT_STAGES[Math.max(0, stageIndex(draft.stage) - 1)]);
    if (el.dataset.asstIdea) {
      const text = t(`assistant.brief.idea.${el.dataset.asstIdea}`);
      const goal = draft.brief.goal.trim() ? draft.brief.goal : `${text}: `;
      updateBrief(draft, { goal });
      save();
      render();
      dialog.querySelector('[data-asst-field="goal"]')?.focus();
      return;
    }
    if (el.matches("[data-asst-add]")) {
      dialog.querySelector("[data-asst-file]")?.click();
      return;
    }
    if (el.dataset.asstRemove) {
      removeMaterial(draft, el.dataset.asstRemove);
      save();
      return render();
    }
    if (el.dataset.asstMove) {
      moveMaterial(draft, el.dataset.asstMove, Number(el.dataset.dir));
      save();
      return render();
    }
    if (el.matches("[data-asst-ai]")) return void runAi();
    if (el.matches("[data-asst-key]")) return void ctx.openAiKeySettings?.(() => void paintAiNotice());
    if (el.matches("[data-asst-apply]")) return void apply();
    if (el.dataset.asstOpen) return void openTarget(el.dataset.asstOpen);
    if (el.matches("[data-asst-restart]")) {
      if (!window.confirm(t("assistant.publish.discardConfirm"))) return;
      draft = createDraft();
      void clearDraft();
      save(true);
      return render();
    }
    const key = el.closest("[data-key]")?.dataset.key;
    if (!key) return;
    if (el.matches("[data-asst-accept]")) acceptSuggestion(draft, key);
    else if (el.matches("[data-asst-edit-s]")) editSuggestion(draft, key);
    else if (el.matches("[data-asst-reject]")) rejectSuggestion(draft, key);
    else if (el.matches("[data-asst-confirm]")) confirmItem(draft, key, true);
    else if (el.matches("[data-asst-reopen]")) confirmItem(draft, key, false);
    else return;
    save();
    render();
  }

  function onInput(e) {
    const el = e.target;
    if (!draft) return;
    if (el.dataset.asstField) {
      updateBrief(draft, { [el.dataset.asstField]: el.value });
      save();
      refreshFooter();
      return;
    }
    if (el.dataset.asstNote) {
      updateMaterial(draft, el.dataset.asstNote, { note: el.value });
      save();
      return;
    }
    if (el.dataset.asstCta) {
      updateCta(draft, { [el.dataset.asstCta]: el.value });
      save();
      return;
    }
    if (el.dataset.asstItem) {
      const key = el.closest("[data-key]")?.dataset.key;
      const it = editItem(draft, key, { [el.dataset.asstItem]: el.value });
      save();
      // why: a marca de alegação some quando o texto marcado muda; o botão Confirmar volta
      if (it && !it.flags?.length) {
        const card = el.closest("[data-key]");
        card?.querySelectorAll(".asst-item-body > .asst-flag").forEach((n) => n.remove());
        const c = card?.querySelector("[data-asst-confirm]");
        if (c) c.disabled = false;
        refreshFooter();
      }
    }
  }

  function refreshFooter() {
    const old = dialog?.querySelector(".asst-actions");
    if (!old) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = footer();
    old.replaceWith(tmp.firstElementChild);
    const nav = dialog.querySelector(".asst-stages");
    if (nav) {
      const n = document.createElement("div");
      n.innerHTML = stagesNav();
      nav.replaceWith(n.firstElementChild);
    }
  }

  function onChange(e) {
    const el = e.target;
    if (!draft) return;
    if (el.matches("[data-asst-file]")) {
      const files = el.files;
      if (files?.length) void addFiles(files);
      el.value = "";
      return;
    }
    if (el.matches("[data-asst-cta-kind]")) {
      updateCta(draft, { kind: el.value });
      save();
      return render();
    }
    if (el.matches("[data-asst-mode]")) {
      chooseMode(draft, { mode: el.value, template: draft.template === "software" ? "produto" : draft.template });
      save();
      return render();
    }
    if (el.matches("[data-asst-template]")) {
      chooseMode(draft, { mode: "gallery", template: el.value });
      save();
      return render();
    }
    if (el.dataset.asstScene) {
      updateMaterial(draft, el.dataset.asstScene, { scene: Number(el.value) });
      const it = draft.items.find((x) => x.materialId === el.dataset.asstScene);
      if (it) it.scene = Number(el.value);
      save();
    }
  }

  async function open() {
    ensureDialog();
    if (!draft) {
      const saved = await loadDraft();
      draft = saved || createDraft();
      notice = saved ? { text: t("assistant.restored"), tone: "" } : { text: "", tone: "" };
    }
    render();
    if (!dialog.open) dialog.showModal();
  }

  return { open, getDraft: () => draft };
}
