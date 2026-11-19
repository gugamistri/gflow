/**
 * Ferramenta "Enquadrar" do editor: escolher a parte do print que o passo mostra.
 * Abre um diálogo com o print inteiro; "Aplicar" grava o recorte nos pixels (ampliado) e
 * remapeia destaque e clique; "Tela inteira" volta ao print sem recorte. Ver cropArea.js.
 */
import {
  cropMatchesStep,
  cropOutputSize,
  customImageUsers,
  isFullCrop,
  normalizeCropRect,
  readStepCrop,
  remapStepGeometry,
} from "./cropArea.js";
import { getCropOriginal, putCropOriginal } from "./cropStore.js";
import { bytesToDataUrl, dataUrlToBytes } from "./mediaBytes.js";

const OUT_MIMES = new Set(["image/jpeg", "image/webp", "image/png"]);
const clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function randomId(prefix) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function toDataUrl(src) {
  if (typeof src === "string" && src.startsWith("data:")) return src;
  const res = await fetch(src);
  if (!res.ok) throw new Error("image_fetch_failed");
  const blob = await res.blob();
  return bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), blob.type || "image/png");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = src;
  });
}

/** Print inteiro (data URL) + recorte em % → data URL do recorte ampliado. */
export async function bakeCroppedImage(sourceDataUrl, rect) {
  const img = await loadImage(sourceDataUrl);
  const o = cropOutputSize(img.naturalWidth, img.naturalHeight, rect);
  const canvas = document.createElement("canvas");
  canvas.width = o.width;
  canvas.height = o.height;
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, o.sx, o.sy, o.sw, o.sh, 0, 0, o.width, o.height);
  const mime = dataUrlToBytes(sourceDataUrl).mime;
  const out = OUT_MIMES.has(mime) ? mime : "image/png";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, out, 0.92));
  if (!blob) throw new Error("encode_failed");
  return bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), blob.type || out);
}

export function createCropTool({ getDemo, currentStep, projectId, onCommit, t, toast }) {
  let session = null;
  let busy = false;

  const dialog = document.createElement("dialog");
  dialog.className = "crop-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="crop-card">
      <h2 class="crop-title"></h2>
      <p class="crop-lead"></p>
      <div class="crop-stage" role="group">
        <img class="crop-img" alt="" draggable="false" />
        <div class="crop-rect" hidden>
          <i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i>
        </div>
      </div>
      <div class="crop-actions">
        <button type="button" class="btn" data-act="full"></button>
        <span class="crop-spacer"></span>
        <button type="button" class="btn" data-act="cancel"></button>
        <button type="button" class="btn btn-primary" data-act="apply"></button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  const stage = dialog.querySelector(".crop-stage");
  const img = dialog.querySelector(".crop-img");
  const box = dialog.querySelector(".crop-rect");
  const btn = (a) => dialog.querySelector(`[data-act="${a}"]`);

  function paint() {
    dialog.querySelector(".crop-title").textContent = t("crop.title");
    dialog.querySelector(".crop-lead").textContent = t("crop.lead");
    stage.setAttribute("aria-label", t("crop.stageAria"));
    btn("full").textContent = t("crop.full");
    btn("cancel").textContent = t("crop.cancel");
    btn("apply").textContent = t("crop.apply");
    btn("full").hidden = !session?.prev;
    const r = session?.rect;
    box.hidden = !r;
    if (r) Object.assign(box.style, { left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });
    btn("apply").disabled = busy || !r;
    dialog.classList.toggle("is-busy", busy);
  }

  const pct = (e) => {
    const b = img.getBoundingClientRect();
    return { x: clampN(((e.clientX - b.left) / Math.max(1, b.width)) * 100, 0, 100), y: clampN(((e.clientY - b.top) / Math.max(1, b.height)) * 100, 0, 100) };
  };

  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    if (!session || busy || e.button > 0) return;
    const p = pct(e);
    const handle = e.target.dataset?.h;
    if (handle && session.rect) drag = { mode: handle, start: p, rect: { ...session.rect } };
    else if (e.target === box && session.rect) drag = { mode: "move", start: p, rect: { ...session.rect } };
    else drag = { mode: "draw", start: p };
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* segue */
    }
    e.preventDefault();
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = pct(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    let r;
    if (drag.mode === "draw") r = normalizeCropRect({ x: drag.start.x, y: drag.start.y, w: dx, h: dy });
    else if (drag.mode === "move") {
      const { w, h } = drag.rect;
      r = { x: clampN(drag.rect.x + dx, 0, 100 - w), y: clampN(drag.rect.y + dy, 0, 100 - h), w, h };
    } else {
      let { x, y, w, h } = drag.rect;
      if (drag.mode.includes("e")) w += dx;
      if (drag.mode.includes("s")) h += dy;
      if (drag.mode.includes("w")) {
        x += dx;
        w -= dx;
      }
      if (drag.mode.includes("n")) {
        y += dy;
        h -= dy;
      }
      r = normalizeCropRect({ x, y, w, h });
    }
    if (r) {
      session.rect = r;
      paint();
    }
  });
  const end = () => {
    drag = null;
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);

  function close() {
    session = null;
    drag = null;
    if (dialog.open) dialog.close();
    img.removeAttribute("src");
  }
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (!busy) close();
  });
  btn("cancel").addEventListener("click", () => !busy && close());
  btn("apply").addEventListener("click", () => void commit(session?.rect || null));
  btn("full").addEventListener("click", () => void commit(null));

  async function commit(rect) {
    const s = session;
    if (!s || busy) return;
    const step = currentStep();
    if (!step || step.id !== s.stepId) return close();
    const target = rect && !isFullCrop(rect) ? normalizeCropRect(rect) : null;
    busy = true;
    paint();
    try {
      const demo = getDemo();
      demo.customImages = demo.customImages && typeof demo.customImages === "object" ? demo.customImages : {};
      const prevEntry = demo.customImages[s.key] || {};
      const name = prevEntry.name || step.label || "imagem";
      if (!target) {
        if (!s.prev) {
          busy = false;
          return close(); // já está na tela inteira
        }
        demo.customImages[s.key] = { ...prevEntry, name, dataUrl: s.source, addedAt: prevEntry.addedAt || Date.now() };
        step.image = `custom:${s.key}`;
        remapStepGeometry(step, s.prev, null);
        delete step.crop;
      } else {
        if (!s.stored) {
          const { bytes, mime } = dataUrlToBytes(s.source);
          await putCropOriginal(s.id, { bytes, mime, projectId: projectId() });
          s.stored = true;
        }
        const dataUrl = await bakeCroppedImage(s.source, target);
        if (currentStep()?.id !== s.stepId) {
          busy = false;
          return close();
        }
        demo.customImages[s.key] = { ...prevEntry, name, dataUrl, addedAt: prevEntry.addedAt || Date.now() };
        step.image = `custom:${s.key}`;
        remapStepGeometry(step, s.prev, target);
        step.crop = { id: s.id, key: s.key, rect: target };
      }
      // why: um desfoque feito antes já está nos pixels da fonte; a ficha dele não vale mais para esta imagem
      delete step.blur;
      busy = false;
      close();
      onCommit();
    } catch (err) {
      console.warn("crop", err);
      busy = false;
      paint();
      toast(t("crop.failed"));
    }
  }

  async function open(step) {
    if (!step || step.type === "slide" || !step.image || busy) return false;
    const meta = readStepCrop(step);
    // why: desfoque feito DEPOIS do recorte mora só na imagem recortada; mudar o recorte o perderia
    if (meta && step.blur) {
      toast(t("crop.blurFirst"));
      return false;
    }
    const demo = getDemo();
    let next = null;
    if (meta && cropMatchesStep(step)) {
      const saved = await getCropOriginal(meta.id).catch(() => null);
      // why: passo duplicado depois do recorte divide a mesma imagem; mexer num não pode mudar o outro
      const key = customImageUsers(demo, meta.key) > 1 ? randomId("img-crop-") : meta.key;
      if (saved?.bytes) next = { stepId: step.id, id: meta.id, key, source: bytesToDataUrl(saved.bytes, saved.mime), prev: meta.rect, rect: { ...meta.rect }, stored: true };
    }
    if (!next) {
      // sem o print inteiro aqui (outro aparelho, imagem trocada): a imagem atual vira a "tela inteira"
      const src = step.image.startsWith("custom:") ? demo.customImages?.[step.image.slice(7)]?.dataUrl || "" : step.image;
      if (!src) return false;
      const source = await toDataUrl(src);
      const current = step.image.startsWith("custom:") ? step.image.slice(7) : "";
      const key = current && customImageUsers(demo, current) === 1 ? current : randomId("img-crop-");
      next = { stepId: step.id, id: randomId("crp"), key, source, prev: null, rect: null, stored: false };
    }
    if (currentStep()?.id !== step.id) return false;
    session = next;
    img.src = next.source;
    paint();
    dialog.showModal();
    return true;
  }

  return { open, close, isOpen: () => Boolean(session) };
}
