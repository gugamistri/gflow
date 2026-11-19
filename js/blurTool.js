/**
 * Ferramenta "Desfocar área" do editor: arrastar um retângulo sobre o print.
 * Cada mudança (desenhar, mover, redimensionar, remover) regrava os pixels da imagem do passo
 * a partir do original guardado só neste navegador (blurStore.js). Ver blurArea.js.
 */
import {
  MAX_BLUR_RECTS,
  applyBlurRects,
  blurMatchesStep,
  customImageUsers,
  moveBlurRect,
  normalizeBlurRect,
  normalizeBlurRects,
  readStepBlur,
} from "./blurArea.js";
import { getBlurOriginal, putBlurOriginal } from "./blurStore.js";
import { bytesToDataUrl, dataUrlToBytes } from "./mediaBytes.js";

const OUT_MIMES = new Set(["image/jpeg", "image/webp", "image/png"]);

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

function canvasToDataUrl(canvas, mime) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error("encode_failed"));
        resolve(bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), blob.type || mime));
      },
      mime,
      0.92
    );
  });
}

/** Original (data URL) → data URL com os retângulos gravados nos pixels. */
export async function bakeBlurredImage(originalDataUrl, rects) {
  const img = await loadImage(originalDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
  ctx2d.drawImage(img, 0, 0);
  const data = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
  applyBlurRects(data, rects);
  ctx2d.putImageData(data, 0, 0);
  const mime = dataUrlToBytes(originalDataUrl).mime;
  return canvasToDataUrl(canvas, OUT_MIMES.has(mime) ? mime : "image/png");
}

/**
 * @param {object} o
 * @param {HTMLElement} o.frame  #canvas-frame
 * @param {HTMLImageElement} o.image  #canvas-image
 * @param {() => object} o.getDemo
 * @param {() => object} o.currentStep
 * @param {() => string} o.projectId
 * @param {() => void} o.onCommit  grava + histórico + redesenha
 * @param {(on: boolean) => void} o.onActiveChange
 * @param {(key: string, vars?: object) => string} o.t
 * @param {(msg: string) => void} o.toast
 */
export function createBlurTool({ frame, image, getDemo, currentStep, projectId, onCommit, onActiveChange, t, toast }) {
  let session = null;
  let sessionSeq = 0;
  let queue = Promise.resolve();
  let selected = -1;
  let pending = 0;

  const layer = document.createElement("div");
  layer.className = "blur-layer";
  layer.hidden = true;
  layer.tabIndex = -1;
  layer.setAttribute("role", "group");
  const hint = document.createElement("p");
  hint.className = "blur-hint";
  frame.appendChild(layer);
  frame.appendChild(hint);
  hint.hidden = true;

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => place()) : null;

  function place() {
    if (!session) return;
    layer.style.width = `${image.clientWidth}px`;
    layer.style.height = `${image.clientHeight}px`;
  }

  function paint() {
    if (!session) return;
    layer.setAttribute("aria-label", t("blur.layerAria"));
    layer.replaceChildren();
    session.rects.forEach((r, i) => {
      const el = document.createElement("div");
      el.className = "blur-rect" + (i === selected ? " is-selected" : "");
      el.dataset.index = String(i);
      Object.assign(el.style, { left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "blur-rect-remove";
      del.dataset.remove = String(i);
      del.title = t("blur.remove");
      del.setAttribute("aria-label", t("blur.remove"));
      del.textContent = "×";
      const handle = document.createElement("i");
      handle.className = "blur-rect-handle";
      handle.dataset.handle = "se";
      el.append(del, handle);
      layer.appendChild(el);
    });
    hint.textContent = session.inherited ? t("blur.hintBaked") : t("blur.hint");
  }

  function pctPoint(e) {
    const box = layer.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / Math.max(1, box.width)) * 100,
      y: ((e.clientY - box.top) / Math.max(1, box.height)) * 100,
    };
  }

  let drag = null;
  layer.addEventListener("pointerdown", (e) => {
    if (!session || e.button > 0) return;
    if (e.target.closest?.("[data-remove]")) return;
    const p = pctPoint(e);
    const rectEl = e.target.closest?.(".blur-rect");
    if (rectEl) {
      const index = Number(rectEl.dataset.index);
      selected = index;
      drag = { mode: e.target.dataset.handle ? "resize" : "move", index, start: p, rect: { ...session.rects[index] }, el: rectEl };
    } else {
      if (session.rects.length >= MAX_BLUR_RECTS) {
        toast(t("blur.limit", { n: MAX_BLUR_RECTS }));
        return;
      }
      const el = document.createElement("div");
      el.className = "blur-rect is-drawing";
      layer.appendChild(el);
      drag = { mode: "draw", start: p, el };
    }
    try {
      layer.setPointerCapture(e.pointerId);
    } catch {
      /* segue sem captura */
    }
    e.preventDefault();
    e.stopPropagation();
  });

  function draft(e, d) {
    const p = pctPoint(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.mode === "draw") return normalizeBlurRect({ x: d.start.x, y: d.start.y, w: dx, h: dy });
    if (d.mode === "move") return moveBlurRect(d.rect, dx, dy);
    return normalizeBlurRect({ ...d.rect, w: d.rect.w + dx, h: d.rect.h + dy });
  }

  layer.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = draft(e, drag);
    if (!r) return;
    Object.assign(drag.el.style, { left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });
  });

  function endDrag(e, cancel) {
    if (!drag || !session) return;
    const d = drag;
    drag = null;
    const r = cancel ? null : draft(e, d);
    if (d.mode === "draw") {
      if (r && r.w * r.h > 0.25) {
        session.rects.push(r);
        selected = session.rects.length - 1;
        commit();
      } else paint();
      return;
    }
    if (!r || (r.x === d.rect.x && r.y === d.rect.y && r.w === d.rect.w && r.h === d.rect.h)) {
      paint();
      return;
    }
    session.rects[d.index] = r;
    commit();
  }
  layer.addEventListener("pointerup", (e) => endDrag(e, false));
  layer.addEventListener("pointercancel", (e) => endDrag(e, true));

  layer.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-remove]");
    if (!btn || !session) return;
    e.stopPropagation();
    removeAt(Number(btn.dataset.remove));
  });

  function removeAt(index) {
    if (!session || !(index >= 0 && index < session.rects.length)) return;
    session.rects.splice(index, 1);
    selected = -1;
    commit();
  }

  function onKey(e) {
    if (!session) return;
    if (e.key === "Escape") {
      e.preventDefault();
      stop();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected >= 0 && !/INPUT|TEXTAREA/.test(e.target?.tagName || "")) {
      e.preventDefault();
      removeAt(selected);
    }
  }

  function commit() {
    paint();
    const s = session;
    const rects = normalizeBlurRects(s.rects);
    layer.classList.add("is-baking");
    pending += 1;
    queue = queue
      .then(async () => {
        if (session !== s) return;
        const step = currentStep();
        if (!step || step.id !== s.stepId) return;
        const demo = getDemo();
        demo.customImages = demo.customImages && typeof demo.customImages === "object" ? demo.customImages : {};
        if (!s.stored) {
          const { bytes, mime } = dataUrlToBytes(s.original);
          await putBlurOriginal(s.id, { bytes, mime, projectId: projectId() });
          s.stored = true;
        }
        const prev = demo.customImages[s.key] || {};
        const name = prev.name || step.label || "imagem";
        if (!rects.length) {
          // why: sem retângulo nenhum volta exatamente o original (sem regravar com perda)
          demo.customImages[s.key] = { ...prev, name, dataUrl: s.original, addedAt: prev.addedAt || Date.now() };
          step.image = `custom:${s.key}`;
          delete step.blur;
        } else {
          const dataUrl = await bakeBlurredImage(s.original, rects);
          if (session !== s || currentStep()?.id !== s.stepId) return;
          demo.customImages[s.key] = { ...prev, name, dataUrl, addedAt: prev.addedAt || Date.now() };
          step.image = `custom:${s.key}`;
          step.blur = { id: s.id, key: s.key, rects };
        }
        // why: o editor avisa uma vez por sessão do desfoque se há link publicado desatualizado
        onCommit({ session: s.seq, rects: rects.length });
      })
      .catch((err) => {
        console.warn("blur", err);
        toast(t("blur.failed"));
      })
      .finally(() => {
        pending -= 1;
        if (!pending) layer.classList.remove("is-baking");
      });
    return queue;
  }

  async function start(step) {
    if (!step || step.type === "slide" || !step.image) return false;
    const demo = getDemo();
    const meta = readStepBlur(step);
    let next = null;
    if (meta && blurMatchesStep(step)) {
      const saved = await getBlurOriginal(meta.id).catch(() => null);
      if (saved?.bytes) {
        // why: passo duplicado depois do desfoque divide a mesma imagem; mexer num não pode mudar o outro
        const key = customImageUsers(demo, meta.key) > 1 ? randomId("img-blur-") : meta.key;
        next = { stepId: step.id, id: meta.id, key, rects: meta.rects, original: bytesToDataUrl(saved.bytes, saved.mime), stored: true, inherited: false };
      }
    }
    if (!next) {
      // why: sem o original aqui (outro aparelho, colaborador, imagem trocada) a imagem atual vira a base;
      //      o que já foi desfocado continua gravado e só dá para desfocar mais
      const src = step.image.startsWith("custom:") ? demo.customImages?.[step.image.slice(7)]?.dataUrl || "" : step.image;
      if (!src) return false;
      const original = await toDataUrl(src);
      const current = step.image.startsWith("custom:") ? step.image.slice(7) : "";
      const key = current && customImageUsers(demo, current) === 1 ? current : randomId("img-blur-");
      next = { stepId: step.id, id: randomId("blr"), key, rects: [], original, stored: false, inherited: Boolean(step.blur) };
    }
    if (currentStep()?.id !== step.id) return false;
    sessionSeq += 1;
    next.seq = sessionSeq;
    session = next;
    selected = -1;
    layer.hidden = false;
    hint.hidden = false;
    frame.classList.add("is-blurring");
    place();
    paint();
    ro?.observe(image);
    document.addEventListener("keydown", onKey, true);
    onActiveChange?.(true);
    layer.focus({ preventScroll: true });
    return true;
  }

  function stop() {
    if (!session) return;
    session = null;
    drag = null;
    selected = -1;
    layer.hidden = true;
    hint.hidden = true;
    layer.replaceChildren();
    frame.classList.remove("is-blurring");
    ro?.disconnect();
    document.removeEventListener("keydown", onKey, true);
    onActiveChange?.(false);
  }

  return {
    isActive: () => Boolean(session),
    toggle: (step) => (session ? (stop(), Promise.resolve(false)) : start(step)),
    start,
    stop,
    /** Chamado a cada renderCanvas: sai se o passo mudou ou deixou de ser tela. */
    sync(step) {
      if (!session) return;
      if (!step || step.id !== session.stepId || step.type === "slide" || step.video) {
        stop();
        return;
      }
      // desfazer/refazer trocou a ficha: relê os retângulos do passo (fora de um arraste ou gravação)
      if (!drag && !pending) {
        const meta = readStepBlur(step);
        if (meta && meta.id === session.id) session.rects = meta.rects.map((r) => ({ ...r }));
        else if (!meta && step.image === `custom:${session.key}`) session.rects = [];
        else if (session.stored) {
          stop();
          return;
        }
      }
      place();
      paint();
    },
    flush: () => queue,
  };
}
