import { resolveImageSrc, ensureClickPoint, bindImage, applyTheme, themeOverlayColor } from "./store.js";
import { createClickFxController } from "./clickFx.js";
import { renderDemoPopoverFooter, clickDriverNext, setPopoverHiddenForSlide } from "./popoverFooter.js";
import { sizeSlideLikeImage, applySlideLayout } from "./editor.js";
import {
  createNarrationController,
  ensureNarration,
  ensurePlayback,
  holdMs,
} from "./playback.js";

export function createPlayer(ctx) {
  const { getDemo, toast, getSelectedIndex, setSelectedIndex, onRequestExit } = ctx;

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

  let driverObj = null;
  let activeIndex = 0;
  let animating = false;
  let autoplayTimer = null;
  let autoplayEnabled = false;
  let running = false;

  function autoplayOn() {
    return autoplayEnabled;
  }

  function clearAutoplay() {
    clearTimeout(autoplayTimer);
    autoplayTimer = null;
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
    autoplayTimer = setTimeout(async () => {
      await speechDone;
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

  async function showStepVisual(step, { speak = false } = {}) {
    return new Promise((resolve) => {
      const demo = getDemo();
      ensureNarration(demo);
      narration.enterStep(step, demo, { speak });

      // why: ponto de edição some na apresentação; o cursor simulado cuida do clique
      if (els.clickPoint) els.clickPoint.hidden = true;

      if (step.type === "slide") {
        els.image.hidden = true;
        els.image.removeAttribute("src");
        if (els.missing) els.missing.hidden = true;
        els.slide.hidden = false;
        els.slideKicker.textContent = `Cena ${step.scene}`;
        els.slideTitle.textContent = step.popover?.title || step.label || "";
        els.slideBody.textContent = step.popover?.description || "";
        applySlideLayout(els.slide, step);
        sizeSlideLikeImage(els.slide, els.stage, demo, step, resolveImageSrc);
        els.hotspot.style.display = "none";
        resolve();
        return;
      }

      els.slide.hidden = true;
      els.hotspot.style.display = "block";
      els.hotspot.classList.add("is-previewing");

      const src = resolveImageSrc(getDemo(), step.image);
      bindImage(els.image, src, (ok) => {
        if (els.missing) els.missing.hidden = ok;
        if (ok) {
          placeHotspot(step.hotspot);
        } else {
          els.hotspot.style.display = "none";
        }
        resolve();
      });
    });
  }

  function placeHotspot(hotspot) {
    const hs = hotspot || { x: 40, y: 40, w: 12, h: 8 };
    const w = els.image.clientWidth;
    const h = els.image.clientHeight;
    els.hotspot.style.left = (hs.x / 100) * w + "px";
    els.hotspot.style.top = (hs.y / 100) * h + "px";
    els.hotspot.style.width = (hs.w / 100) * w + "px";
    els.hotspot.style.height = (hs.h / 100) * h + "px";
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

  async function buildAndDrive(startIndex = 0, opts = {}) {
    stop({ silent: true });
    if (typeof opts.autoplay === "boolean") {
      autoplayEnabled = opts.autoplay;
    }
    const demo = getDemo();
    ensurePlayback(demo);
    ensureNarration(demo);
    const steps = demo.steps;
    if (!steps.length) {
      toast("Nenhum passo para reproduzir");
      onRequestExit?.();
      return;
    }

    const factory = driverFactory();
    if (!factory) {
      toast("driver.js não carregou");
      onRequestExit?.();
      return;
    }

    running = true;
    activeIndex = Math.max(0, Math.min(startIndex, steps.length - 1));
    if (typeof setSelectedIndex === "function") setSelectedIndex(activeIndex);
    els.hotspot?.classList.add("is-previewing");
    await narration.startTour(demo);
    await showStepVisual(steps[activeIndex], { speak: true });

    if (demo?.theme) applyTheme(demo.theme);

    driverObj = factory({
      popoverClass: "demo-popover",
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayColor: themeOverlayColor(0.55),
      stagePadding: 6,
      disableActiveInteraction: false,
      nextBtnText: "Próximo",
      prevBtnText: "",
      doneBtnText: "Concluir",
      progressText: "{{current}} de {{total}}",
      onPopoverRender: (popover) => {
        renderDemoPopoverFooter(popover);
        setPopoverHiddenForSlide(steps[activeIndex]?.type === "slide");
        armAutoplay();
      },
      steps: steps.map((step) => ({
        element: step.type === "slide" ? "#canvas-slide" : "#hotspot",
        popover: {
          title: step.popover?.title || step.label || "",
          description: (step.popover?.description || "").replace(/\n/g, "<br/>"),
          side: step.popover?.side || "bottom",
          align: step.popover?.align || "center",
          onNextClick: async (_el, _step, opts) => {
            if (animating) return;
            animating = true;
            clearAutoplay();
            const current = steps[activeIndex];
            const drv = opts.driver;
            try {
              await animateClick(current);
              const nextIndex = activeIndex + 1;
              if (nextIndex >= steps.length) {
                drv.destroy();
                driverObj = null;
                narration.stop();
                setProgress("Demo concluída");
                return;
              }
              activeIndex = nextIndex;
              if (typeof setSelectedIndex === "function") setSelectedIndex(activeIndex);
              setProgress(`Passo ${activeIndex + 1} / ${steps.length}`);
              await showStepVisual(steps[activeIndex], { speak: true });
              drv.moveNext();
            } finally {
              animating = false;
            }
          },
          onPrevClick: async (_el, _step, opts) => {
            if (animating || activeIndex <= 0) return;
            animating = true;
            clearAutoplay();
            const drv = opts.driver;
            try {
              activeIndex -= 1;
              if (typeof setSelectedIndex === "function") setSelectedIndex(activeIndex);
              setProgress(`Passo ${activeIndex + 1} / ${steps.length}`);
              await showStepVisual(steps[activeIndex], { speak: true });
              drv.movePrevious();
            } finally {
              animating = false;
            }
          },
        },
      })),
      onDestroyed: () => {
        clearAutoplay();
        narration.stop();
        setProgress("Parado");
        clickFx.reset();
        driverObj = null;
      },
    });

    setProgress(`Passo ${activeIndex + 1} / ${steps.length}`);
    driverObj.drive(activeIndex);
  }

  function stop({ silent = false } = {}) {
    clearAutoplay();
    narration.stop();
    if (driverObj) {
      try {
        driverObj.destroy();
      } catch {
        /* ignore */
      }
      driverObj = null;
    }
    clickFx.reset();
    animating = false;
    running = false;
    if (!silent) setProgress("Parado");
  }

  function startIndex() {
    if (typeof getSelectedIndex === "function") return getSelectedIndex();
    return 0;
  }

  function bind() {
    function onHighlightClick(e) {
      if (!driverObj || !isPresenting()) return;
      if (e.target.closest(".slide-card-play, .slide-card-close")) return;
      e.preventDefault();
      e.stopPropagation();
      clickDriverNext();
    }

    // why: o editor já avança o hotspot em is-previewing; o slide só o previewDriver cobre
    els.slide?.addEventListener("click", onHighlightClick);

    document.getElementById("canvas-slide-play")?.addEventListener(
      "click",
      (e) => {
        if (!isPresenting() || !driverObj) return;
        e.preventDefault();
        e.stopPropagation();
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
        onRequestExit?.();
      },
      true
    );

    window.addEventListener("keydown", (e) => {
      if (!isPresenting()) return;
      if (e.key !== "Escape") return;
      e.preventDefault();
      onRequestExit?.();
    });

    window.addEventListener("resize", () => {
      if (!isPresenting() || !running) return;
      const demo = getDemo();
      const step = demo.steps[activeIndex];
      if (!step) return;
      if (step.type === "slide") {
        sizeSlideLikeImage(els.slide, els.stage, demo, step, resolveImageSrc);
        return;
      }
      if (!els.image.hidden) placeHotspot(step.hotspot);
    });
  }

  bind();

  return {
    play: (opts = {}) => buildAndDrive(opts.from ?? startIndex(), opts),
    stop,
    isRunning: () => running,
  };
}
