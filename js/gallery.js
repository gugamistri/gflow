/**
 * Modo Galeria (playback.mode = "gallery"): carrossel de fotos em tela cheia, como nos portais de imóveis.
 * Sem imports de propósito: este arquivo é copiado inteiro para o HTML offline (js/standalonePlayer.js,
 * `node scripts/sync-gallery.mjs`; o teste falha se a cópia divergir). Tudo que depende do app chega em `opts`.
 *
 * Segurança (#174): todo texto do tour entra com textContent; o texto formatado (#175) entra pelo
 * `richText.render` (nós DOM, nunca innerHTML). Só SVG fixo deste arquivo usa innerHTML.
 */

export const GALLERY_CAPTION_MAX = 140;
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
export function gallerySlideKind(step, hasVideo) {
  if (step?.type === "slide") return "card";
  if (hasVideo) return "video";
  return "photo";
}

/**
 * Legenda de 1 linha + "Detalhes".
 * Legenda = título (ou rótulo); sem título, o começo do texto sem marcadores. "Detalhes" mostra o texto
 * inteiro (formatado) quando há título e texto, ou quando o texto não cabe numa linha.
 */
export function galleryCaption(step, strip = (s) => String(s ?? "")) {
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
export function gallerySections(demo) {
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
export function sectionIndexAt(sections, index) {
  for (let i = sections.length - 1; i >= 0; i--) if (index >= sections[i].start) return i;
  return -1;
}

/** Próximo índice (sem dar a volta). */
export function galleryStep(index, total, delta) {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(total - 1, (Number(index) || 0) + delta));
}

/** Prende o deslocamento da foto ampliada para ela nunca descolar da borda. */
export function clampGalleryPan(cam, box) {
  const s = Math.max(1, Math.min(ZOOM_MAX, Number(cam?.scale) || 1));
  const maxX = Math.max(0, ((s - 1) * (box?.width || 0)) / 2);
  const maxY = Math.max(0, ((s - 1) * (box?.height || 0)) / 2);
  const x = Math.max(-maxX, Math.min(maxX, Number(cam?.x) || 0));
  const y = Math.max(-maxY, Math.min(maxY, Number(cam?.y) || 0));
  return { scale: s, x: s === 1 ? 0 : x, y: s === 1 ? 0 : y };
}

/** Zoom mantendo fixo o ponto (px, py) relativo ao centro da caixa. */
export function zoomAt(cam, nextScale, px, py, box) {
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
export function createGallery(opts = {}) {
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
