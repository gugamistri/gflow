import { t } from "./i18n.js";
import { resolveImageSrc, ensureClickPoint, bindImage, applyTheme, spotlightVeilPaint } from "./store.js";
import { createClickFxController } from "./clickFx.js";
import {
  renderDemoPopoverFooter,
  clickDriverNext,
  clickDriverPrev,
  setPopoverHiddenForSlide,
  labelCloseButton,
} from "./popoverFooter.js";
import { highlightClickAdvances, pointInHighlight } from "./highlightClick.js";
import { sizeSlideLikeImage, applySlideLayout } from "./editor.js";
import {
  clampPan,
  computeSafeZoomCamera,
  isDoubleTap,
  maxUserScale,
  pinchCamera,
  safeAreaRect,
  zoomCameraStyle,
} from "./zoomHighlight.js";
import { stickyWhatsAppAction } from "./fixedSteps.js";
import { createStickyCta } from "./stickyCta.js";
import {
  createNarrationController,
  ensureNarration,
  ensurePlayback,
  holdMs,
  liftCaptionAboveOverlay,
  restoreCaptionHome,
} from "./playback.js";
import { isCompactTouch } from "./compact.js";
import { resolvePlayPlaylist } from "./stepSelection.js";
import { createPresentProgress } from "./presentProgress.js";
import { createTourLifecycle } from "./tourLifecycle.js";
import { pauseAudio, resumeAudio, setAudioMuted } from "./playback.js";
import { createPlayerControls, createLiveAnnouncer, playerShortcut } from "./playerControls.js";
import { stepImageAlt } from "./a11y.js";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

export function createPlayer(ctx) {
  const { getDemo, toast, getSelectedIndex, setSelectedIndex, onRequestExit, presentHintKey } = ctx;
  const presentProgress = createPresentProgress();
  // why: onStep/onComplete/onExit servem a tela final e o analytics; o editor não os passa
  const lifecycle = createTourLifecycle({
    onStep: ctx.onStep,
    onComplete: ctx.onComplete,
    onExit: ctx.onExit,
  });
  let pendingExitReason = "";
  const announce = createLiveAnnouncer();
  // why: WCAG 2.2.2 / 1.4.2 — pausar vira modo manual (Anterior/Próximo); silenciar corta fala e trilha
  const controls = createPlayerControls({
    onPauseChange: (paused, { announce: say } = {}) => {
      if (paused) {
        clearAutoplay();
        pauseAudio();
      } else {
        resumeAudio();
        armAutoplay();
      }
      if (say) announce(t(paused ? "player.pausedNote" : "player.resumedNote"));
    },
    onMuteChange: (muted, { announce: say } = {}) => {
      setAudioMuted(muted);
      if (say) announce(t(muted ? "player.mutedNote" : "player.unmutedNote"));
    },
    // why: toggle estilo YouTube — liga/desliga o avanço sozinho sem sair do passo atual
    onAutoplayChange: (on, { announce: say } = {}) => {
      autoplayEnabled = on;
      if (on) armAutoplay();
      else clearAutoplay();
      if (say) announce(t(on ? "player.autoplayOnNote" : "player.autoplayOffNote"));
    },
  });
  setAudioMuted(controls.isMuted());

  const els = {
    stage: document.getElementById("canvas-stage"),
    frame: document.getElementById("canvas-frame"),
    image: document.getElementById("canvas-image"),
    slide: document.getElementById("canvas-slide"),
    slideKicker: document.getElementById("canvas-slide-kicker"),
    slideTitle: document.getElementById("canvas-slide-title"),
    slideBody: document.getElementById("canvas-slide-body"),
    hotspot: document.getElementById("hotspot"),
    clickPoint: document.getElementById("click-point"),
    clickFx: document.getElementById("editor-click-fx"),
    cursor: document.getElementById("editor-sim-cursor"),
    progress: null,
    missing: document.getElementById("canvas-missing"),
    caption: document.getElementById("canvas-caption"),
  };

  const clickFx = createClickFxController({
    frame: els.frame,
    hotspot: els.hotspot,
    cursor: els.cursor,
    clickFx: els.clickFx,
  });

  const narration = createNarrationController({ captionEl: els.caption });
  let captionHome = null;

  function elevateCaption() {
    if (captionHome) return;
    const home = liftCaptionAboveOverlay(els.caption);
    if (home) captionHome = home;
  }

  function restoreCaptionEl() {
    restoreCaptionHome(els.caption, captionHome);
    captionHome = null;
  }

  let driverObj = null;
  let activeIndex = 0;
  let animating = false;
  let autoplayTimer = null;
  let autoplayEnabled = false;
  let running = false;
  let suppressExitArm = false;
  let driveToken = 0;
  // why: um clique que chega junto com o arranque não pode saltar para o passo 2
  let advanceArmedAt = 0;

  // ---- câmera do frame: close-up do destaque (zoomHighlight) + pinça/arraste do visitante ----
  const IDENTITY = Object.freeze({ scale: 1, translateX: 0, translateY: 0 });
  /** transform atual do frame */
  let cam = { ...IDENTITY };
  /** enquadramento do passo (para onde o toque duplo volta) */
  let baseCam = { ...IDENTITY };
  /** o visitante ampliou com a pinça: toques na foto não avançam nem fecham, deslizar não troca de passo */
  let userZoomed = false;
  let gestureEndedAt = 0;

  // why: o botão do WhatsApp usa o mesmo número/mensagem do cartão final; o clique vai para o analytics
  const sticky = createStickyCta({ onAction: (action) => ctx.onStickyCta?.(action) });

  function paintSticky() {
    if (!running || !isPresenting()) {
      sticky.hide();
      syncChromeVars();
      return;
    }
    const demo = getDemo();
    const vars = ctx.stickyCtaVars?.() || { tour: String(demo?.name || "").trim() };
    sticky.update(stickyWhatsAppAction(demo, activeIndex, vars));
    syncChromeVars();
  }

  /** Altura real do balão, legenda e botão fixo → variáveis do CSS (o palco em pé usa o espaço que sobra). */
  function syncChromeVars() {
    const root = document.documentElement;
    const pop = document.querySelector(".driver-popover");
    const popH = pop && !pop.classList.contains("is-slide-hidden") ? Math.round(pop.getBoundingClientRect().height) : 0;
    const cap = els.caption;
    const capRect = cap && !cap.hidden && String(cap.textContent || "").trim() ? cap.getBoundingClientRect() : null;
    const capH = capRect && capRect.height > 0 ? Math.round(capRect.height) + 8 : 0;
    const st = sticky.isVisible() ? sticky.element().getBoundingClientRect() : null;
    const stickyH = st && st.height > 0 ? Math.round(st.height) + 8 : 0;
    const ctl = document.querySelector(".gf-player-controls");
    const ctlW = ctl && !ctl.hidden ? Math.round(ctl.getBoundingClientRect().width) : 0;
    const set = (k, v) => {
      if (root.style.getPropertyValue(k) !== v) root.style.setProperty(k, v);
    };
    set("--gf-pop-vis-h", `${popH}px`);
    set("--gf-cap-h", `${capH}px`);
    set("--gf-sticky-h", `${stickyH}px`);
    if (ctlW) set("--gf-ctl-w", `${ctlW}px`);
  }

  /** Centro e tamanho do frame sem transform (offset* ignora o transform). */
  function frameLayout() {
    const f = els.frame;
    const stage = els.stage;
    if (!f || !stage) return null;
    const sr = stage.getBoundingClientRect();
    return {
      cx: sr.left - stage.scrollLeft + f.offsetLeft + f.offsetWidth / 2,
      cy: sr.top - stage.scrollTop + f.offsetTop + f.offsetHeight / 2,
      w: f.offsetWidth,
      h: f.offsetHeight,
    };
  }

  /** Parte do palco que o visitante vê de fato (no celular, sem controles, aviso, legenda, balão e CTA). */
  function safeRect() {
    const stage = els.stage;
    if (!stage) return null;
    const r = stage.getBoundingClientRect();
    const vw = window.innerWidth || r.right;
    const vh = window.innerHeight || r.bottom;
    if (!isCompactTouch()) {
      // why: no desktop o balão flutua junto do destaque; vale o palco (sem o padding), como antes
      const cs = getComputedStyle(stage);
      return {
        left: Math.max(0, r.left + (parseFloat(cs.paddingLeft) || 0)),
        top: Math.max(0, r.top + (parseFloat(cs.paddingTop) || 0)),
        right: Math.min(vw, r.right - (parseFloat(cs.paddingRight) || 0)),
        bottom: Math.min(vh, r.bottom - (parseFloat(cs.paddingBottom) || 0)),
      };
    }
    const base = { left: Math.max(0, r.left) + 4, top: Math.max(0, r.top) + 4, right: Math.min(vw, r.right) - 4, bottom: Math.min(vh, r.bottom) - 4 };
    const visible = (n) => n && !n.hidden && n.isConnected && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden";
    const portrait = Boolean(globalThis.matchMedia?.("(orientation: portrait)")?.matches);
    const caption = els.caption && String(els.caption.textContent || "").trim() ? els.caption : null;
    const popover = document.querySelector(".driver-popover:not(.is-slide-hidden)");
    // why: em pé tudo empilha em faixas (topo/baixo); deitado só a coluna da direita (legenda + balão)
    // esconde a foto — controles, aviso e CTA ficam por cima, como antes
    const nodes = portrait
      ? [document.querySelector(".gf-player-controls"), presentHintEl(), caption, popover, sticky.element()]
      : [caption, popover];
    return safeAreaRect(base, nodes.filter(visible).map((n) => n.getBoundingClientRect()));
  }

  function paintCam({ animate = false } = {}) {
    if (!els.frame) return;
    const style = zoomCameraStyle(cam);
    const next = style.transform === "none" ? "" : style.transform;
    els.frame.style.transition = animate ? "" : "none";
    els.frame.style.transformOrigin = style.transformOrigin;
    els.frame.style.transform = next;
    els.stage?.classList.toggle("is-zooming", Boolean(next));
    els.stage?.classList.toggle("is-user-zoomed", userZoomed);
    zoomResetBtn().hidden = !userZoomed;
    // why: com a foto ampliada o toque nela não sai do tour; o aviso diz como voltar
    const hintKey = userZoomed ? "present.zoomHint" : presentStopHintKey();
    if (presentHintEl()?.dataset.i18n !== hintKey) setPresentHint(hintKey);
  }

  let zoomResetEl = null;
  /** why: WCAG 2.5.1 — quem não faz pinça/toque duplo também desfaz o zoom (botão nos controles) */
  function zoomResetBtn() {
    if (!zoomResetEl) {
      zoomResetEl = document.createElement("button");
      zoomResetEl.type = "button";
      zoomResetEl.className = "gf-player-ctl gf-zoom-reset";
      zoomResetEl.hidden = true;
      zoomResetEl.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.5 10.5h6M15 15l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
        zoomResetEl.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      }
      zoomResetEl.addEventListener("click", (e) => {
        e.stopPropagation();
        resetUserZoom();
      });
    }
    zoomResetEl.setAttribute("aria-label", t("player.zoomReset"));
    zoomResetEl.title = t("player.zoomReset");
    const host = document.querySelector(".gf-player-controls");
    if (host && zoomResetEl.parentElement !== host) host.prepend(zoomResetEl);
    return zoomResetEl;
  }

  function resetUserZoom() {
    if (!userZoomed && cam.scale === baseCam.scale) return;
    userZoomed = false;
    cam = { ...baseCam };
    const stopTrack = trackDriverDuringZoom();
    paintCam({ animate: !prefersReducedMotion() });
    waitZoomTransition().then(() => {
      stopTrack();
      refreshDriver();
      syncChromeVars();
    });
    announce(t("player.zoomResetNote"));
    // why: a pinça pausou o avanço automático; voltar ao enquadramento retoma a contagem do passo
    armAutoplay();
  }

  function presentHintEl() {
    return document.getElementById("present-chrome");
  }

  function setPresentHint(key) {
    const el = presentHintEl();
    if (!el) return;
    el.textContent = t(key);
    el.dataset.i18n = key;
  }

  function restoreStopHint() {
    if (presentHintEl()?.dataset.i18n === "present.zoomHint") setPresentHint(presentStopHintKey());
  }

  function presentStopHintKey() {
    if (presentHintKey) return presentHintKey;
    return isCompactTouch() ? "present.touchHint" : "present.escHint";
  }

  function autoplayOn() {
    return autoplayEnabled && !controls.isPaused();
  }

  function clearAutoplay() {
    clearTimeout(autoplayTimer);
    autoplayTimer = null;
    presentProgress.hide();
  }

  function armAutoplay() {
    clearAutoplay();
    if (!autoplayOn() || !driverObj) return;
    const demo = getDemo();
    ensurePlayback(demo);
    ensureNarration(demo);
    const step = demo.steps[activeIndex];
    if (!step) return;
    // why: o áudio já começou em showStepVisual; aqui só esperamos para avançar
    const speechDone = narration.whenSpeechDone();
    const delay = holdMs(step, demo);
    presentProgress.start(delay);
    autoplayTimer = setTimeout(async () => {
      await speechDone.catch(() => {});
      document.querySelector(".driver-popover-next-btn")?.click();
    }, delay);
  }

  function driverFactory() {
    return window.driver?.js?.driver || window.driver;
  }

  function setProgress(text) {
    if (els.progress) els.progress.textContent = text;
  }

  function isPresenting() {
    return document.getElementById("view-editor")?.classList.contains("is-presenting");
  }

  function clearZoom({ animate = false } = {}) {
    if (!els.frame) return;
    cam = { ...IDENTITY };
    baseCam = { ...IDENTITY };
    userZoomed = false;
    els.stage?.classList.remove("is-user-zoomed");
    if (zoomResetEl) zoomResetEl.hidden = true;
    restoreStopHint();
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

  /**
   * why: refresh() cancela o frame anterior; o tick entra depois para o recorte
   * acompanhar o transform em vez de saltar só no fim.
   */
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
    return step?.type !== "slide" && step?.zoomHighlight === true && els.image && !els.image.hidden;
  }

  async function applyStepZoom(step) {
    if (!els.frame || !els.stage) return;
    if (!zoomEnabled(step)) {
      const hadZoom = Boolean(els.frame.style.transform);
      const stopTrack = hadZoom ? trackDriverDuringZoom() : null;
      clearZoom({ animate: hadZoom });
      if (hadZoom) await waitZoomTransition();
      stopTrack?.();
      refreshDriver();
      return;
    }
    // why: o close-up mira a área que o visitante vê (no celular, sem controles/legenda/balão)
    // e nunca deixa o retângulo marcado sair dela (o terraço do passo 7 sumia sob os controles)
    const camera = computeSafeZoomCamera(step.hotspot, frameLayout(), safeRect());
    const style = zoomCameraStyle(camera);
    const nextTransform = style.transform === "none" ? "" : style.transform;
    baseCam = { ...camera };
    cam = { ...camera };
    userZoomed = false;
    els.stage.classList.add("is-zooming");
    els.stage.classList.remove("is-user-zoomed");
    if (zoomResetEl) zoomResetEl.hidden = true;
    restoreStopHint();
    els.frame.style.transition = "";
    els.frame.style.transformOrigin = style.transformOrigin;
    if (els.frame.style.transform === nextTransform) return;
    const stopTrack = trackDriverDuringZoom();
    els.frame.style.transform = nextTransform;
    await waitZoomTransition();
    stopTrack();
    refreshDriver();
  }

  /** Garante escala 1× para o retângulo do destaque aparecer antes do close-up. */
  async function prepareStepCamera(step) {
    await waitLayout();
    if (els.frame?.style.transform) {
      clearZoom({ animate: false });
    }
    // why: sem zoomHighlight limpa qualquer residual; com zoom, o close-up vem depois do driver
    if (!zoomEnabled(step) && els.stage?.classList.contains("is-zooming")) {
      clearZoom({ animate: false });
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function zoomAfterHighlightVisible(step) {
    if (!zoomEnabled(step)) return;
    const token = driveToken;
    // why: o driver precisa pintar o recorte em 1× antes da câmera começar a andar
    await delay(550);
    // why: se o passo mudou durante a espera, o close-up deste passo não pode cair no próximo
    if (token !== driveToken || getDemo()?.steps?.[activeIndex] !== step) return;
    await applyStepZoom(step);
    try {
      driverObj?.refresh?.();
    } catch {
      /* ignore */
    }
  }

  async function showStepVisual(step, { speak = false } = {}) {
    return new Promise((resolve) => {
      const demo = getDemo();
      ensureNarration(demo);
      narration.enterStep(step, demo, { speak });

      // why: ponto de edição some na apresentação; o cursor simulado cuida do clique
      if (els.clickPoint) els.clickPoint.hidden = true;

      if (step.type === "slide") {
        setBackdrop("");
        // why: o cartão de texto mora dentro do frame — um close-up que sobrou do passo anterior o cortava
        clearZoom({ animate: false });
        els.image.hidden = true;
        els.image.removeAttribute("src");
        if (els.missing) els.missing.hidden = true;
        els.slide.hidden = false;
        els.slideKicker.textContent = t("player.scene", { n: step.scene });
        els.slideTitle.textContent = step.popover?.title || step.label || "";
        els.slideBody.textContent = step.popover?.description || "";
        applySlideLayout(els.slide, step);
        sizeSlideLikeImage(els.slide, els.stage, demo, step, resolveImageSrc);
        // why: o editor usa [hidden]; style.display não vence o !important do CSS
        els.hotspot.hidden = true;
        els.hotspot.style.display = "";
        resolve();
        return;
      }

      els.slide.hidden = true;
      els.hotspot.hidden = false;
      els.hotspot.style.display = "";
      els.hotspot.classList.add("is-previewing");

      const src = resolveImageSrc(getDemo(), step.image);
      setBackdrop(src);
      if (els.image) els.image.alt = stepImageAlt(step);
      bindImage(els.image, src, (ok) => {
        if (els.missing) els.missing.hidden = ok;
        if (ok) {
          placeHotspot(step.hotspot);
        } else {
          els.hotspot.hidden = true;
        }
        resolve();
      });
    });
  }

  let backdropEl = null;
  /** Fundo desfocado da própria foto (só aparece no celular em pé): sem faixa vazia e sem cortar a planta. */
  function setBackdrop(src) {
    if (!els.stage) return;
    if (!backdropEl) {
      backdropEl = document.createElement("div");
      backdropEl.className = "canvas-backdrop";
      backdropEl.setAttribute("aria-hidden", "true");
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      backdropEl.append(img);
    }
    if (backdropEl.parentElement !== els.stage) els.stage.prepend(backdropEl);
    const img = backdropEl.firstChild;
    if (!src) {
      backdropEl.hidden = true;
      img.removeAttribute("src");
      return;
    }
    if (img.getAttribute("src") !== src) img.src = src;
    backdropEl.hidden = false;
  }

  function placeHotspot(hotspot) {
    const hs = hotspot || { x: 40, y: 40, w: 12, h: 8 };
    const w = els.image.clientWidth;
    const h = els.image.clientHeight;
    els.hotspot.hidden = false;
    els.hotspot.style.display = "";
    els.hotspot.style.left = (hs.x / 100) * w + "px";
    els.hotspot.style.top = (hs.y / 100) * h + "px";
    els.hotspot.style.width = (hs.w / 100) * w + "px";
    els.hotspot.style.height = (hs.h / 100) * h + "px";
  }

  function waitLayout() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function clickTarget(step) {
    const cp = ensureClickPoint(step);
    const w = els.image.clientWidth;
    const h = els.image.clientHeight;
    return {
      x: (cp.x / 100) * w,
      y: (cp.y / 100) * h,
    };
  }

  async function animateClick(step) {
    if (step.type === "slide" || step.simulateClick === false) return;
    await clickFx.animateTo(clickTarget(step), { pressHotspot: true });
  }

  function reportStep(steps, position, total) {
    const index = activeIndex;
    lifecycle.step({ index, stepId: steps[index]?.id ?? null, position, total });
    paintSticky();
  }

  /** Saída pedida pelo visitante (Esc, fechar, clique fora). Conclusão não passa aqui. */
  function requestExit(reason) {
    // why: Esc/X/clique fora calam a narração já — não dependem de quem trata a saída
    silenceAudio();
    if (!lifecycle.completed) lifecycle.exit(reason);
    onRequestExit?.({ reason: lifecycle.completed ? "complete" : reason || "close" });
  }

  function advanceAllowed() {
    const wait = Number(ctx.ignoreAdvanceMs) || 0;
    if (!wait) return true;
    return performance.now() >= advanceArmedAt;
  }

  function decoratePopoverA11y(popover) {
    const wrap = popover?.wrapper;
    if (wrap) wrap.setAttribute("aria-modal", "true");
    const title = popover?.title;
    if (title) {
      title.setAttribute("role", "heading");
      title.setAttribute("aria-level", "2");
      title.tabIndex = -1;
    }
    // why: o texto "Passo X / N" do rodapé é o indicador de progresso legível
    popover?.progress?.setAttribute?.("aria-hidden", "false");
  }

  /** why: WCAG 2.4.3 — a cada passo o foco vai para o título (não para o X), sem roubar foco dos controles. */
  function focusStepHeading(popover, isSlide) {
    setTimeout(() => {
      if (!driverObj || !isPresenting()) return;
      const active = document.activeElement;
      if (active?.closest?.(".gf-player-controls, input, textarea, select")) return;
      let target = null;
      if (isSlide) {
        target = els.slideTitle;
        if (target && target.tabIndex < 0) target.tabIndex = -1;
      } else {
        target = popover?.title && !popover.title.hidden && popover.title.style.display !== "none" ? popover.title : popover?.description;
        if (target && !target.hasAttribute("tabindex")) target.tabIndex = -1;
      }
      target?.focus?.({ preventScroll: true });
    }, 60);
  }

  async function buildAndDrive(startIndex = 0, opts = {}) {
    stop({ silent: true });
    const token = ++driveToken;
    advanceArmedAt = Infinity;
    if (typeof opts.autoplay === "boolean") {
      autoplayEnabled = opts.autoplay;
    }
    const demo = getDemo();
    ensurePlayback(demo);
    ensureNarration(demo);
    const steps = demo.steps;
    if (!steps.length) {
      toast(t("player.noSteps"));
      onRequestExit?.();
      return;
    }

    const factory = driverFactory();
    if (!factory) {
      toast(t("player.driverMissing"));
      onRequestExit?.();
      return;
    }

    running = true;
    lifecycle.start();
    controls.show({
      autoplay: autoplayEnabled,
      captions: steps.some((st) => String(st.caption || "").trim()),
    });
    setAudioMuted(controls.isMuted());
    pendingExitReason = "";
    setPresentHint(presentStopHintKey());
    // why: sem índices a lista é o tour inteiro (volta antes do início);
    // com índices, só a seleção, em ordem, e para no último.
    const playlist = resolvePlayPlaylist(steps.length, {
      from: startIndex,
      indices: opts.indices,
    });
    const playOrder = playlist.order;
    let playlistPos = playlist.start;
    activeIndex = playOrder[playlistPos] ?? 0;
    if (typeof setSelectedIndex === "function") setSelectedIndex(activeIndex);
    els.hotspot?.classList.add("is-previewing");
    await narration.startTour(demo);
    if (token !== driveToken) return;
    elevateCaption();
    await showStepVisual(steps[activeIndex], { speak: true });
    if (token !== driveToken) return;
    reportStep(steps, playlistPos, playOrder.length);
    // why: is-presenting muda o grid; o driver precisa do hotspot já no layout final (ainda em 1×)
    await prepareStepCamera(steps[activeIndex]);
    if (token !== driveToken) return;

    if (demo?.theme) applyTheme(demo.theme);

    const veil = spotlightVeilPaint();
    const stepProgress = () =>
      t("player.stepOf", { current: playlistPos + 1, total: playOrder.length });
    driverObj = factory({
      popoverClass: "demo-popover",
      showProgress: true,
      animate: !prefersReducedMotion(),
      allowClose: ctx.allowClose !== false,
      // why: no embed o clique no véu não fecha nem avança ("none" é ignorado pelo Driver)
      overlayClickBehavior: ctx.overlayClickBehavior || "close",
      onCloseClick: (_el, _step, navOpts) => {
        pendingExitReason = "close";
        navOpts?.driver?.destroy?.();
      },
      // why: setas tratadas em keydown abaixo — o keyup nativo do driver falhava no próximo com onNextClick async.
      allowKeyboardControl: false,
      overlayColor: veil.color,
      overlayOpacity: veil.opacity,
      stagePadding: 6,
      disableActiveInteraction: false,
      nextBtnText: t("player.next"),
      prevBtnText: "",
      doneBtnText: t("player.done"),
      progressText: t("player.progress"),
      onPopoverRender: (popover) => {
        renderDemoPopoverFooter(popover);
        labelCloseButton(popover?.closeButton, t(ctx.closeLabelKey || "player.closeTour"));
        const isSlide = steps[activeIndex]?.type === "slide";
        setPopoverHiddenForSlide(isSlide);
        decoratePopoverA11y(popover);
        const stepTitle = steps[activeIndex]?.popover?.title || steps[activeIndex]?.label || "";
        announce(
          t("player.announceStep", { current: playlistPos + 1, total: playOrder.length, title: stepTitle }).replace(/:\s*$/, "")
        );
        focusStepHeading(popover, isSlide);
        requestAnimationFrame(() => syncChromeVars());
        armAutoplay();
      },
      onHighlighted: (el) => {
        // why: WCAG 4.1.2 — o Driver põe aria-expanded/haspopup no destaque (inválido em div/section)
        el?.removeAttribute?.("aria-expanded");
        el?.removeAttribute?.("aria-haspopup");
        el?.removeAttribute?.("aria-controls");
      },
      steps: playOrder.map((stepIndex) => {
        const step = steps[stepIndex];
        return {
          element: step.type === "slide" ? "#canvas-slide" : "#hotspot",
          popover: {
          title: step.popover?.title || step.label || "",
          description: (step.popover?.description || "").replace(/\n/g, "<br/>"),
          side: step.popover?.side || "bottom",
          align: step.popover?.align || "center",
          onNextClick: async (_el, _step, navOpts) => {
            if (animating || token !== driveToken) return;
            animating = true;
            clearAutoplay();
            const current = steps[activeIndex];
            const drv = navOpts.driver;
            try {
              await animateClick(current);
              if (token !== driveToken) return;
              const nextPos = playlistPos + 1;
              if (nextPos >= playOrder.length) {
                lifecycle.complete();
                drv.destroy();
                driverObj = null;
                narration.stop();
                setProgress(t("player.doneStatus"));
                return;
              }
              playlistPos = nextPos;
              activeIndex = playOrder[playlistPos];
              if (typeof setSelectedIndex === "function") setSelectedIndex(activeIndex);
              setProgress(stepProgress());
              await showStepVisual(steps[activeIndex], { speak: true });
              if (token !== driveToken) return;
              reportStep(steps, playlistPos, playOrder.length);
              await prepareStepCamera(steps[activeIndex]);
              if (token !== driveToken) return;
              drv.moveNext();
              await zoomAfterHighlightVisible(steps[activeIndex]);
            } finally {
              animating = false;
            }
          },
          onPrevClick: async (_el, _step, navOpts) => {
            if (animating || playlistPos <= 0 || token !== driveToken) return;
            animating = true;
            clearAutoplay();
            const drv = navOpts.driver;
            try {
              playlistPos -= 1;
              activeIndex = playOrder[playlistPos];
              if (typeof setSelectedIndex === "function") setSelectedIndex(activeIndex);
              setProgress(stepProgress());
              await showStepVisual(steps[activeIndex], { speak: true });
              if (token !== driveToken) return;
              reportStep(steps, playlistPos, playOrder.length);
              await prepareStepCamera(steps[activeIndex]);
              if (token !== driveToken) return;
              drv.movePrevious();
              await zoomAfterHighlightVisible(steps[activeIndex]);
            } finally {
              animating = false;
            }
          },
        },
        };
      }),
      onDestroyed: () => {
        // why: um Próximo/Anterior em voo não pode voltar a falar depois de fechar
        driveToken += 1;
        controls.hide();
        sticky.hide();
        setBackdrop("");
        clearAutoplay();
        narration.stop();
        setProgress(t("player.stopped"));
        clickFx.reset();
        clearZoom({ animate: false });
        driverObj = null;
        animating = false;
        running = false;
        if (suppressExitArm) return;
        const reason = lifecycle.completed ? "complete" : pendingExitReason || "close";
        pendingExitReason = "";
        if (reason !== "complete") lifecycle.exit(reason);
        // why: overlay/Done/fechar saem no mesmo gesto — dois cliques deixavam limbo confuso
        queueMicrotask(() => {
          if (!isPresenting()) return;
          onRequestExit?.({ reason });
        });
      },
    });

    setProgress(t("player.stepOf", { current: playlistPos + 1, total: playOrder.length }));
    driverObj.drive(playlistPos);
    await zoomAfterHighlightVisible(steps[activeIndex]);
    if (token !== driveToken) return;
    advanceArmedAt = performance.now() + (Number(ctx.ignoreAdvanceMs) || 0);
  }

  /** Para narração, áudio do passo e trilha de fundo (sem mexer no Driver). */
  function silenceAudio() {
    clearAutoplay();
    narration.stop();
  }

  function stop({ silent = false } = {}) {
    // why: invalida o buildAndDrive/onNextClick em voo (senão o passo seguinte volta a falar)
    driveToken += 1;
    controls.hide();
    sticky.hide();
    setBackdrop("");
    silenceAudio();
    if (driverObj) {
      suppressExitArm = true;
      try {
        driverObj.destroy();
      } catch {
        /* ignore */
      } finally {
        suppressExitArm = false;
      }
      driverObj = null;
    }
    clickFx.reset();
    clearZoom({ animate: false });
    restoreCaptionEl();
    animating = false;
    running = false;
    if (!silent) setProgress(t("player.stopped"));
  }

  function startIndex() {
    if (typeof getSelectedIndex === "function") return getSelectedIndex();
    return 0;
  }

  /** Tamanho do palco mudou (rotação, balão/legenda/CTA no celular): reposiciona destaque e câmera. */
  function relayoutStep() {
    const demo = getDemo();
    const step = demo?.steps?.[activeIndex];
    if (!step || zoomGesture) return;
    if (step.type === "slide") {
      sizeSlideLikeImage(els.slide, els.stage, demo, step, resolveImageSrc);
      refreshDriver();
      return;
    }
    if (els.image.hidden) return;
    placeHotspot(step.hotspot);
    if (userZoomed) {
      // why: o visitante ampliou — mantém o zoom dele, só prende de novo na área visível
      cam = clampPan(cam, frameLayout(), safeRect());
      paintCam();
      refreshDriver();
      return;
    }
    if (!zoomEnabled(step)) {
      refreshDriver();
      return;
    }
    // why: antes do close-up inicial (550 ms) não adianta mirar; ele mesmo mede tudo
    if (!els.stage?.classList.contains("is-zooming")) {
      refreshDriver();
      return;
    }
    applyStepZoom(step).then(() => refreshDriver());
  }

  function highlightRect() {
    const step = getDemo()?.steps?.[activeIndex];
    if (!step || step.type === "slide") return null;
    const el = els.hotspot;
    if (!el || el.hidden) return null;
    return el.getBoundingClientRect();
  }

  function highlightClickInfo(e) {
    const step = getDemo()?.steps?.[activeIndex];
    return {
      presenting: isPresenting(),
      driverActive: Boolean(driverObj),
      stepType: step?.type,
      button: e.button,
      target: e.target,
      x: e.clientX,
      y: e.clientY,
      rect: driverObj ? highlightRect() : null,
    };
  }

  /** O ponto está no destaque do passo atual? (o /p não fecha o tour por esse clique) */
  function highlightContains(x, y) {
    if (!driverObj || !isPresenting()) return false;
    return pointInHighlight(x, y, highlightRect());
  }

  /** Toque que começa na foto (não nos controles, balão, botões ou campos). */
  const ZOOM_IGNORE = "input, textarea, select, label, form, audio, video, a, button, [contenteditable], .gf-player-controls, .gf-sticky-cta, .driver-popover, .slide-card";

  function zoomGestureAllowed(target, points) {
    if (!isPresenting() || !driverObj || !els.frame || !els.stage) return false;
    const step = getDemo()?.steps?.[activeIndex];
    if (!step || step.type === "slide" || !els.image || els.image.hidden || !els.image.getAttribute("src")) return false;
    const node = target?.nodeType === 3 ? target.parentElement : target;
    if (node?.closest?.(ZOOM_IGNORE)) return false;
    const r = els.stage.getBoundingClientRect();
    return points.every((p) => p.clientX >= r.left && p.clientX <= r.right && p.clientY >= r.top && p.clientY <= r.bottom);
  }

  /** O ponto cai na foto enquanto o visitante está com zoom? (o /p não fecha o tour por esse toque) */
  function zoomOwnsPoint(x, y) {
    if (!userZoomed || !isPresenting() || !driverObj || !els.stage) return false;
    const r = els.stage.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function zoomGestureRecent() {
    return Boolean(zoomGesture) || Date.now() - gestureEndedAt < 650;
  }

  let zoomGesture = null;
  let lastTap = null;
  let tapStart = null;
  let zoomRefreshRaf = 0;

  function scheduleZoomRefresh() {
    if (zoomRefreshRaf) return;
    zoomRefreshRaf = requestAnimationFrame(() => {
      zoomRefreshRaf = 0;
      refreshDriver();
    });
  }

  function touchMid(a, b) {
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  }

  function touchDist(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
  }

  function beginPan(touch) {
    zoomGesture = {
      kind: "pan",
      start: { ...cam },
      x: touch.clientX,
      y: touch.clientY,
      frame: frameLayout(),
      safe: safeRect(),
      moved: false,
    };
  }

  function bindZoomGestures() {
    window.addEventListener(
      "touchstart",
      (e) => {
        const pts = [...e.touches];
        if (pts.length === 1) tapStart = { x: pts[0].clientX, y: pts[0].clientY, at: Date.now() };
        else tapStart = null;
        if (!zoomGestureAllowed(e.target, pts)) {
          if (pts.length >= 2 && zoomGesture) zoomGesture = null;
          return;
        }
        if (pts.length >= 2) {
          const [a, b] = pts;
          zoomGesture = {
            kind: "pinch",
            start: { ...cam },
            mid: touchMid(a, b),
            dist: touchDist(a, b),
            frame: frameLayout(),
            safe: safeRect(),
            max: maxUserScale(els.image.naturalWidth, els.image.clientWidth),
          };
          clearAutoplay();
          return;
        }
        if (userZoomed) beginPan(pts[0]);
      },
      { passive: true }
    );
    window.addEventListener(
      "touchmove",
      (e) => {
        const g = zoomGesture;
        if (!g) return;
        // why: a pinça é da foto, não da página (sem zoom do navegador nem rolagem)
        if (e.cancelable) e.preventDefault();
        if (g.kind === "pinch" && e.touches.length >= 2) {
          const [a, b] = e.touches;
          const next = pinchCamera(g.start, g.mid, g.dist, touchMid(a, b), touchDist(a, b), g.frame, { maxScale: g.max });
          cam = clampPan(next, g.frame, g.safe);
          userZoomed = cam.scale > 1.02 || cam.scale > baseCam.scale + 0.02;
          paintCam();
          scheduleZoomRefresh();
          return;
        }
        if (g.kind === "pan" && e.touches.length === 1) {
          const p = e.touches[0];
          const dx = p.clientX - g.x;
          const dy = p.clientY - g.y;
          if (Math.hypot(dx, dy) > 6) g.moved = true;
          cam = clampPan({ ...g.start, translateX: g.start.translateX + dx, translateY: g.start.translateY + dy }, g.frame, g.safe);
          paintCam();
          scheduleZoomRefresh();
        }
      },
      { passive: false }
    );
    const end = (e) => {
      const g = zoomGesture;
      const now = Date.now();
      if (g) {
        if (e.touches.length === 1 && g.kind === "pinch" && userZoomed) {
          // why: tirou um dedo da pinça — o outro continua arrastando a foto
          beginPan(e.touches[0]);
          gestureEndedAt = now;
          return;
        }
        if (e.touches.length) return;
        zoomGesture = null;
        gestureEndedAt = now;
        if (els.frame) els.frame.style.transition = "";
        if (!userZoomed && cam.scale <= baseCam.scale + 0.02) {
          cam = { ...baseCam };
          paintCam({ animate: true });
        }
        refreshDriver();
        if (g.kind === "pinch" || g.moved) {
          lastTap = null;
          return;
        }
      }
      // toque duplo (com zoom) volta ao enquadramento do passo
      if (e.touches.length || !tapStart || !userZoomed) return;
      const p = e.changedTouches?.[0];
      if (!p) return;
      const tap = { x: p.clientX, y: p.clientY, at: now };
      const still = Math.hypot(tap.x - tapStart.x, tap.y - tapStart.y) < 12 && now - tapStart.at < 350;
      tapStart = null;
      if (!still || !zoomOwnsPoint(tap.x, tap.y)) return;
      gestureEndedAt = now;
      if (isDoubleTap(lastTap, tap)) {
        lastTap = null;
        resetUserZoom();
        return;
      }
      lastTap = tap;
    };
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
    // why: Safari no iOS ainda dispara o zoom da página com gesturestart
    window.addEventListener(
      "gesturestart",
      (e) => {
        if (isPresenting() && driverObj && e.cancelable) e.preventDefault();
      },
      { passive: false }
    );
    // why: o clique sintético depois da pinça/arraste (ou um toque na foto ampliada) não fecha o tour
    // nem avança o passo. Registrado antes dos outros cliques em captura, para valer primeiro.
    window.addEventListener(
      "click",
      (e) => {
        if (!isPresenting() || !driverObj) return;
        const node = e.target?.nodeType === 3 ? e.target.parentElement : e.target;
        if (node?.closest?.(".gf-player-controls, .gf-sticky-cta, .driver-popover, .slide-card")) return;
        const recent = Date.now() - gestureEndedAt < 650;
        if (!recent && !zoomOwnsPoint(e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true
    );
  }

  function bind() {
    bindZoomGestures();
    function onHighlightClick(e) {
      if (!driverObj || !isPresenting()) return;
      if (e.target.closest(".slide-card-play, .slide-card-close")) return;
      e.preventDefault();
      e.stopPropagation();
      if (!advanceAllowed()) return;
      clickDriverNext();
    }

    els.slide?.addEventListener("click", onHighlightClick);

    // why: clicar no destaque (hotspot / marcador de clique) = Próximo, em todo player.
    // Em captura na janela: o recorte do Driver tem folga e o cursor simulado não recebe clique.
    window.addEventListener(
      "click",
      (e) => {
        if (!highlightClickAdvances(highlightClickInfo(e))) return;
        e.preventDefault();
        e.stopPropagation();
        // why: igual ao botão Próximo — sem a carência do slide (que só arma depois do zoom)
        if (animating) return;
        clickDriverNext();
      },
      true
    );

    // why: sair da página (fechar aba, voltar) não pode deixar a narração tocando
    window.addEventListener("pagehide", () => silenceAudio());

    document.getElementById("canvas-slide-play")?.addEventListener(
      "click",
      (e) => {
        if (!isPresenting() || !driverObj) return;
        e.preventDefault();
        e.stopPropagation();
        if (!advanceAllowed()) return;
        clickDriverNext();
      },
      true
    );

    document.getElementById("canvas-slide-close")?.addEventListener(
      "click",
      (e) => {
        if (!isPresenting()) return;
        e.preventDefault();
        e.stopPropagation();
        requestExit("close");
      },
      true
    );

    window.addEventListener("keydown", (e) => {
      if (!isPresenting()) return;
      if (e.key === "Escape") {
        if (document.querySelector("dialog[open]")) return;
        e.preventDefault();
        requestExit("esc");
        return;
      }
      const shortcut = driverObj ? playerShortcut(e) : "";
      if (shortcut) {
        e.preventDefault();
        if (shortcut === "pause") controls.togglePause();
        else if (shortcut === "cc") controls.toggleCaptions();
        else controls.toggleMute();
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

    // why: WCAG 4.1.2 — o Driver repõe aria-expanded/haspopup/controls no destaque (div/section) a cada passo
    if (typeof MutationObserver === "function") {
      const strip = (el) => {
        for (const a of ["aria-expanded", "aria-haspopup", "aria-controls"]) if (el.hasAttribute(a)) el.removeAttribute(a);
      };
      const mo = new MutationObserver((list) => list.forEach((m) => strip(m.target)));
      for (const el of [els.hotspot, els.slide]) {
        if (el) mo.observe(el, { attributes: true, attributeFilter: ["aria-expanded", "aria-haspopup", "aria-controls"] });
      }
    }

    // why: o Driver prende o Tab no balão; os controles (pausar/som) e o cartão do slide entram no ciclo
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Tab" || !driverObj || !isPresenting()) return;
        const visible = (n) => n && !n.hidden && !n.disabled && n.getClientRects().length > 0;
        const pool = [
          ...document.querySelectorAll(".gf-player-controls button"),
          ...(els.slide && !els.slide.hidden ? els.slide.querySelectorAll("button") : []),
          ...document.querySelectorAll(".driver-popover:not(.is-slide-hidden) button, .driver-popover:not(.is-slide-hidden) a[href]"),
        ].filter(visible);
        if (!pool.length) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const i = pool.indexOf(document.activeElement);
        const next = e.shiftKey ? pool[i <= 0 ? pool.length - 1 : i - 1] : pool[i < 0 || i >= pool.length - 1 ? 0 : i + 1];
        next.focus();
      },
      true
    );

    // why: no celular o balão fica preso embaixo; a legenda sobe para ficar logo acima dele (--gf-pop-h)
    if (typeof ResizeObserver === "function" && typeof MutationObserver === "function") {
      let watched = null;
      let relayoutRaf = 0;
      const relayoutSoon = () => {
        if (relayoutRaf) return;
        relayoutRaf = requestAnimationFrame(() => {
          relayoutRaf = 0;
          syncChromeVars();
          if (running && isPresenting() && isCompactTouch()) relayoutStep();
        });
      };
      const ro = new ResizeObserver(() => {
        if (watched?.isConnected) {
          document.documentElement.style.setProperty("--gf-pop-h", `${Math.round(watched.getBoundingClientRect().height)}px`);
        }
        relayoutSoon();
      });
      // why: legenda, botão fixo e controles também mudam o espaço livre da foto no celular em pé
      const chromeRo = new ResizeObserver(() => relayoutSoon());
      if (els.caption) chromeRo.observe(els.caption);
      const observeChrome = () => {
        const ctl = document.querySelector(".gf-player-controls");
        if (ctl && !ctl.dataset.gfObserved) {
          ctl.dataset.gfObserved = "1";
          chromeRo.observe(ctl);
        }
        const st = sticky.element();
        if (st && !st.dataset.gfObserved) {
          st.dataset.gfObserved = "1";
          chromeRo.observe(st);
        }
      };
      new MutationObserver(() => {
        observeChrome();
        const pop = document.querySelector(".driver-popover");
        if (pop === watched) return;
        ro.disconnect();
        watched = pop;
        if (pop) ro.observe(pop);
      }).observe(document.body, { childList: true });
    }

    // why: no celular, deslizar para os lados troca de passo (só um dedo, gesto claramente horizontal, fora de campos)
    let swipe = null;
    window.addEventListener(
      "touchstart",
      (e) => {
        swipe = null;
        // why: com a foto ampliada um dedo arrasta a foto; deslizar não troca de passo
        if (!isPresenting() || !driverObj || e.touches.length !== 1 || userZoomed) return;
        if (e.target.closest?.("input, textarea, select, label, form, audio, video, a, [contenteditable], .gf-player-controls")) return;
        const t = e.touches[0];
        swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
      },
      { passive: true }
    );
    window.addEventListener(
      "touchend",
      (e) => {
        const s = swipe;
        swipe = null;
        if (!s || !driverObj || animating || !isPresenting() || e.touches.length || userZoomed || zoomGestureRecent()) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Date.now() - s.at > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
        swipedAt = Date.now();
        if (dx < 0) clickDriverNext();
        else clickDriverPrev();
      },
      { passive: true }
    );
    // why: o clique sintético depois do gesto cairia na sombra e fecharia o tour
    let swipedAt = 0;
    window.addEventListener(
      "click",
      (e) => {
        if (!e.isTrusted || Date.now() - swipedAt > 600) return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true
    );

    window.addEventListener("resize", () => {
      if (!isPresenting() || !running) return;
      relayoutStep();
    });
  }

  bind();

  return {
    play: (opts = {}) => buildAndDrive(opts.from ?? startIndex(), opts),
    stop,
    /** Sai do tour reportando o motivo ao onExit (ex.: "click_outside" vindo da página). */
    exit: (reason) => requestExit(reason),
    highlightContains,
    /** Toque na foto ampliada pelo visitante, ou logo depois de uma pinça: o /p não trata como "fora". */
    zoomOwnsTouch: (x, y) => zoomOwnsPoint(x, y) || zoomGestureRecent(),
    isRunning: () => running,
    /** Estado do toggle de reprodução automática (mantido ao trocar de idioma no meio do tour). */
    isAutoplay: () => autoplayEnabled,
  };
}
