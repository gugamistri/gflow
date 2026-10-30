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
import { computeZoomCamera, zoomCameraStyle } from "./zoomHighlight.js";
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
import { createVideoStage, VIDEO_STAGE_ID } from "./videoStage.js";
import { stepVideo } from "./tour-schema/video.js";
import { stopSpeech } from "./playback.js";

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
  // why: passo com vídeo (link YouTube/Vimeo) — fachada com o pôster; o iframe só entra no clique
  const video = createVideoStage({
    frame: els.frame,
    onPlay: (info) => ctx.onVideoPlay?.(info),
    onProgress: (info) => ctx.onVideoProgress?.(info),
    onState: (state) => {
      if (state === "playing") {
        // o vídeo manda: nada de avançar sozinho nem narrar por cima
        clearAutoplay();
        stopSpeech();
      } else if (state === "ended") {
        armAutoplay();
      }
    },
    onLayout: () => refreshDriver(),
  });
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

  function presentHintEl() {
    return document.getElementById("present-chrome");
  }

  function setPresentHint(key) {
    const el = presentHintEl();
    if (!el) return;
    el.textContent = t(key);
    el.dataset.i18n = key;
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
    if (video.isPlaying()) return;
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
    return step?.type !== "slide" && step?.zoomHighlight === true && !stepVideo(step) && els.image && !els.image.hidden;
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
    const imageSize = { w: els.image.clientWidth, h: els.image.clientHeight };
    const stageSize = { w: els.stage.clientWidth, h: els.stage.clientHeight };
    const cam = computeZoomCamera(step.hotspot, imageSize, stageSize, true);
    const style = zoomCameraStyle(cam);
    const nextTransform = style.transform === "none" ? "" : style.transform;
    els.stage.classList.add("is-zooming");
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
    // why: o driver precisa pintar o recorte em 1× antes da câmera começar a andar
    await delay(550);
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
      const stepVid = stepVideo(step);
      if (!stepVid) video.hide();
      else video.teardown();

      if (step.type === "slide") {
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
      if (els.image) els.image.alt = stepImageAlt(step);
      bindImage(els.image, src, (ok) => {
        if (els.missing) els.missing.hidden = ok || Boolean(stepVid);
        if (stepVid) {
          // why: o destaque do passo de vídeo é a própria fachada (o Driver aponta para #gf-video)
          els.hotspot.hidden = true;
          video.show(step, { index: activeIndex, interactive: true });
        } else if (ok) {
          placeHotspot(step.hotspot);
        } else {
          els.hotspot.hidden = true;
        }
        resolve();
      });
    });
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
    if (step.type === "slide" || step.simulateClick === false || stepVideo(step)) return;
    await clickFx.animateTo(clickTarget(step), { pressHotspot: true });
  }

  function reportStep(steps, position, total) {
    const index = activeIndex;
    lifecycle.step({ index, stepId: steps[index]?.id ?? null, position, total });
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
          element: step.type === "slide" ? "#canvas-slide" : stepVideo(step) ? `#${VIDEO_STAGE_ID}` : "#hotspot",
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
        clearAutoplay();
        narration.stop();
        video.hide();
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
    silenceAudio();
    video.hide();
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

  function highlightRect() {
    const step = getDemo()?.steps?.[activeIndex];
    if (!step || step.type === "slide") return null;
    // why: no passo de vídeo clicar na área é para o vídeo, nunca «Próximo»
    if (stepVideo(step)) return null;
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

  function bind() {
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
    // why: fecha o vídeo aberto para o tempo assistido entrar no último lote (beacon)
    window.addEventListener("pagehide", () => video.teardown());

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
          ...document.querySelectorAll(`#${VIDEO_STAGE_ID}:not([hidden]) button:not([disabled]), #${VIDEO_STAGE_ID}:not([hidden]) a[href], #${VIDEO_STAGE_ID}:not([hidden]) iframe`),
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
      const ro = new ResizeObserver(() => {
        if (!watched?.isConnected) return;
        document.documentElement.style.setProperty("--gf-pop-h", `${Math.round(watched.getBoundingClientRect().height)}px`);
      });
      new MutationObserver(() => {
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
        if (!isPresenting() || !driverObj || e.touches.length !== 1) return;
        if (e.target.closest?.("input, textarea, select, label, form, audio, video, a, [contenteditable], .gf-player-controls, .gf-video")) return;
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
        if (!s || !driverObj || animating || !isPresenting() || e.touches.length) return;
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
      const demo = getDemo();
      const step = demo.steps[activeIndex];
      if (!step) return;
      if (step.type === "slide") {
        sizeSlideLikeImage(els.slide, els.stage, demo, step, resolveImageSrc);
        return;
      }
      if (!els.image.hidden && !stepVideo(step)) {
        placeHotspot(step.hotspot);
        applyStepZoom(step).then(() => {
          try {
            driverObj?.refresh?.();
          } catch {
            /* ignore */
          }
        });
      }
    });
  }

  bind();

  return {
    play: (opts = {}) => buildAndDrive(opts.from ?? startIndex(), opts),
    stop,
    /** Sai do tour reportando o motivo ao onExit (ex.: "click_outside" vindo da página). */
    exit: (reason) => requestExit(reason),
    highlightContains,
    isRunning: () => running,
    /** Estado do toggle de reprodução automática (mantido ao trocar de idioma no meio do tour). */
    isAutoplay: () => autoplayEnabled,
  };
}
