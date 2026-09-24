
function gfT(key, vars) {
  const cat = (typeof window !== "undefined" && window.__GF_I18N) || {};
  let text = cat[key] || key;
  if (vars && typeof vars === "object") {
    text = String(text).replace(/\{(\w+)\}/g, (_, name) =>
      vars[name] != null ? String(vars[name]) : "{" + name + "}"
    );
  }
  return text;
}

/**
 * Player autônomo (arquivo HTML exportado). Script clássico — sem modules.
 * Espera window.INTERACTIVE_DEMO já definido.
 */
(function () {
  const demo = window.INTERACTIVE_DEMO;
  if (!demo || !Array.isArray(demo.steps)) {
    console.error("INTERACTIVE_DEMO ausente ou inválido");
    return;
  }

  const PREV_ARROW_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M13.5 8L2.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 3.5L2.5 8L7 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement;
    const appearance =
      theme.appearance ||
      (theme.presetId === "social" ? "social" : "documento");
    // Export HTML já traz data-appearance do pack; tema do tour fica em --demo-*
    root.style.setProperty("--demo-accent", theme.accent);
    root.style.setProperty("--demo-accent-dark", theme.accentDark || theme.accent);
    root.style.setProperty("--demo-overlay", theme.overlay);
    root.style.setProperty("--demo-popover-bg", theme.popoverBg);
    root.style.setProperty("--demo-popover-title", theme.title);
    root.style.setProperty("--demo-popover-text", theme.text);
    root.style.setProperty("--demo-button", theme.button);
    root.style.setProperty("--demo-hotspot", theme.hotspot);
    const darkDemo = appearance === "social";
    root.style.setProperty(
      "--demo-font-display",
      darkDemo
        ? 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
        : 'Georgia, "Times New Roman", serif'
    );
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clickPointFromHotspot(hotspot) {
    const hs = hotspot || { x: 40, y: 40, w: 14, h: 8 };
    return { x: hs.x + hs.w / 2, y: hs.y + hs.h / 2 };
  }

  function ensureClickPoint(step) {
    if (step?.clickPoint && Number.isFinite(step.clickPoint.x) && Number.isFinite(step.clickPoint.y)) {
      return step.clickPoint;
    }
    return clickPointFromHotspot(step?.hotspot);
  }

  function resolveImageSrc(imageRef) {
    if (!imageRef) return "";
    if (imageRef.startsWith("custom:")) {
      const id = imageRef.slice(7);
      return demo.customImages?.[id]?.dataUrl || "";
    }
    return imageRef;
  }

  function hexToRgba(hex, alpha) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const DEFAULT_HOLD_SECONDS = 6;
  const BG_VOLUME = 0.22;
  const BG_DUCK_VOLUME = 0.06;
  const CAPTION_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

  if (!demo.playback || typeof demo.playback !== "object") {
    demo.playback = { defaultHoldSeconds: DEFAULT_HOLD_SECONDS };
  }
  if (!Number.isFinite(Number(demo.playback.defaultHoldSeconds)) || Number(demo.playback.defaultHoldSeconds) <= 0) {
    demo.playback.defaultHoldSeconds = DEFAULT_HOLD_SECONDS;
  }
  if (!demo.narration || typeof demo.narration !== "object") {
    demo.narration = { enabled: true, voiceURI: "", rate: 1, background: null };
  }

  function captionPlaybackRate(rate) {
    const n = Number(rate);
    return CAPTION_PLAYBACK_RATES.includes(n) ? n : 1;
  }

  function resolveHoldSeconds(step) {
    const fromStep = Number(step?.holdSeconds);
    let hold;
    if (Number.isFinite(fromStep) && fromStep > 0) hold = fromStep;
    else {
      const fromDemo = Number(demo.playback.defaultHoldSeconds);
      hold = Number.isFinite(fromDemo) && fromDemo > 0 ? fromDemo : DEFAULT_HOLD_SECONDS;
    }
    const audio = step?.narrationAudio;
    const duration = Number(audio?.durationSeconds);
    const clips = Array.isArray(audio?.clips)
      ? audio.clips.filter((url) => typeof url === "string" && url.startsWith("data:audio/"))
      : [];
    let clipsOk = false;
    if (clips.length && audio?.source === "upload") {
      clipsOk = true;
    } else if (clips.length) {
      const caption = String(step?.caption || "").trim();
      const rate = Number(audio?.rate);
      const projectRate = Number(demo.narration?.rate);
      clipsOk =
        !!caption &&
        audio.caption === caption &&
        (audio.voiceURI || "") === (demo.narration?.voiceURI || "") &&
        Number.isFinite(rate) &&
        Math.abs(rate - projectRate) <= 0.001;
    }
    if (clipsOk && Number.isFinite(duration) && duration > 0) {
      const floor = Math.max(1, Math.ceil(duration / captionPlaybackRate(audio.playbackRate) - 1e-9));
      hold = Math.max(hold, floor);
    }
    return hold;
  }

  function holdMs(step) {
    return Math.round(resolveHoldSeconds(step) * 1000);
  }

  let speakToken = 0;
  let currentSpeech = null;

  function stopSpeech() {
    speakToken += 1;
    if (currentSpeech) {
      currentSpeech.pause();
      currentSpeech.removeAttribute("src");
      currentSpeech.load();
      currentSpeech = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function splitForSpeech(text) {
    const max = 180;
    const parts = [];
    let rest = String(text || "").trim();
    while (rest.length > max) {
      let cut = rest.lastIndexOf(" ", max);
      if (cut < 40) cut = max;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }

  function playSpeechUrl(url, rate, token) {
    return new Promise((resolve, reject) => {
      if (token !== speakToken) {
        resolve();
        return;
      }
      const audio = new Audio();
      currentSpeech = audio;
      const speed = Math.min(2, Math.max(0.7, Number(rate) || 1));
      audio.referrerPolicy = "no-referrer";
      audio.preload = "auto";
      const applyRate = () => {
        audio.playbackRate = speed;
      };
      audio.addEventListener("loadedmetadata", applyRate);
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("tts")), { once: true });
      audio.src = url;
      applyRate();
      audio.play().catch(reject);
    });
  }

  function speakText(text, voiceURI, rate) {
    stopSpeech();
    const token = speakToken;
    const trimmed = String(text || "").trim();
    if (!trimmed) return Promise.resolve();
    const langMap = {
      "pt-BR": "pt-BR",
      "pt-PT": "pt-PT",
      "es-ES": "es-ES",
      "es-MX": "es-MX",
      "en-US": "en-US",
      "en-GB": "en-GB",
    };
    const lang = langMap[voiceURI] || "pt-BR";
    const parts = splitForSpeech(trimmed);
    return (async () => {
      let played = false;
      try {
        for (const part of parts) {
          if (token !== speakToken) return;
          const url =
            "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
            encodeURIComponent(lang) +
            "&q=" +
            encodeURIComponent(part);
          await playSpeechUrl(url, rate, token);
          played = true;
        }
      } catch {
        if (token !== speakToken || played || !window.speechSynthesis) return;
        await new Promise((resolve) => {
          const utterance = new SpeechSynthesisUtterance(trimmed);
          utterance.lang = lang;
          utterance.rate = Math.min(1.4, Math.max(0.7, Number(rate) || 1));
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });
      }
    })();
  }

  function savedCaptionClips(step) {
    const audio = step?.narrationAudio;
    if (!audio || !Array.isArray(audio.clips)) return [];
    const clips = audio.clips.filter((url) => typeof url === "string" && url.startsWith("data:audio/"));
    if (!clips.length) return [];
    if (audio.source === "upload") return clips;
    const caption = String(step?.caption || "").trim();
    if (!caption || audio.caption !== caption) return [];
    if ((audio.voiceURI || "") !== (demo.narration?.voiceURI || "")) return [];
    const savedRate = Number(audio.rate);
    const rate = Number(demo.narration?.rate);
    if (!Number.isFinite(savedRate) || Math.abs(savedRate - rate) > 0.001) return [];
    return clips;
  }

  function playableCaptionClips(step) {
    const saved = savedCaptionClips(step);
    if (saved.length) return saved;
    const audio = step?.narrationAudio;
    if (!Array.isArray(audio?.clips)) return [];
    return audio.clips.filter((url) => typeof url === "string" && url.startsWith("data:audio/"));
  }

  function playSavedClips(clips, rate) {
    stopSpeech();
    const token = speakToken;
    const speed = captionPlaybackRate(rate);
    return (async () => {
      for (const url of clips) {
        if (token !== speakToken || !url) return;
        await playSpeechUrl(url, speed, token);
      }
    })();
  }

  function createNarrationController(captionEl) {
    let bgAudio = null;
    let speakToken = 0;
    let speakDone = Promise.resolve();

    function setCaption(text, visible) {
      if (!captionEl) return;
      const trimmed = String(text || "").trim();
      captionEl.textContent = trimmed;
      captionEl.hidden = !visible || !trimmed;
    }

    function duck(active) {
      if (!bgAudio) return;
      bgAudio.volume = active ? BG_DUCK_VOLUME : BG_VOLUME;
    }

    function stopBackground() {
      if (!bgAudio) return;
      bgAudio.pause();
      bgAudio.src = "";
      bgAudio = null;
    }

    return {
      async startTour() {
        const src = demo.narration.background?.dataUrl;
        if (!src) {
          stopBackground();
          return;
        }
        if (bgAudio && bgAudio.dataset.src === src) {
          if (bgAudio.paused) {
            try {
              await bgAudio.play();
            } catch {
              /* ignore */
            }
          }
          return;
        }
        stopBackground();
        bgAudio = new Audio(src);
        bgAudio.dataset.src = src;
        bgAudio.loop = true;
        bgAudio.volume = BG_VOLUME;
        try {
          await bgAudio.play();
        } catch {
          /* ignore */
        }
      },
      enterStep(step, speak) {
        const caption = String(step?.caption || "").trim();
        setCaption(caption, step?.showCaption !== false);
        const runId = ++speakToken;
        stopSpeech();
        duck(false);
        const clips = playableCaptionClips(step);
        if (!speak || !clips.length) {
          speakDone = Promise.resolve();
          return speakDone;
        }
        duck(true);
        speakDone = playSavedClips(clips, step?.narrationAudio?.playbackRate).then(() => {
          if (runId === speakToken) duck(false);
        });
        return speakDone;
      },
      whenSpeechDone() {
        return speakDone;
      },
      stop() {
        speakToken += 1;
        stopSpeech();
        stopBackground();
        setCaption("", false);
        speakDone = Promise.resolve();
      },
    };
  }

  function createClickFxController(els) {
    function reset() {
      if (els.clickFx) {
        els.clickFx.hidden = true;
        els.clickFx.classList.remove("is-active");
      }
      if (els.hotspot) els.hotspot.classList.remove("is-pressed");
      if (els.cursor) {
        els.cursor.classList.remove("is-visible", "is-click");
        els.cursor.hidden = true;
      }
    }

    function playRippleAt(x, y) {
      if (!els.clickFx) return;
      els.clickFx.hidden = false;
      els.clickFx.classList.remove("is-active");
      els.clickFx.style.left = x + "px";
      els.clickFx.style.top = y + "px";
      void els.clickFx.offsetWidth;
      els.clickFx.classList.add("is-active");
    }

    async function animateTo(target, opts) {
      const pressHotspot = !opts || opts.pressHotspot !== false;
      const startX = Math.max(16, target.x - 90);
      const startY = Math.max(16, target.y - 70);
      reset();
      els.cursor.hidden = false;
      els.cursor.style.left = startX + "px";
      els.cursor.style.top = startY + "px";
      await wait(30);
      els.cursor.classList.add("is-visible");
      els.cursor.style.left = target.x + "px";
      els.cursor.style.top = target.y + "px";
      await wait(520);
      els.cursor.classList.add("is-click");
      if (pressHotspot && els.hotspot) els.hotspot.classList.add("is-pressed");
      playRippleAt(target.x, target.y);
      await wait(220);
      els.cursor.classList.remove("is-click");
      await wait(380);
      els.cursor.classList.remove("is-visible");
      if (els.hotspot) els.hotspot.classList.remove("is-pressed");
      await wait(160);
      reset();
    }

    return { reset, animateTo };
  }

  function renderDemoPopoverFooter(popover) {
    const { footer, progress, previousButton, nextButton, footerButtons } = popover;
    if (previousButton) {
      previousButton.innerHTML = PREV_ARROW_SVG;
      previousButton.setAttribute("aria-label", gfT("player.prev"));
      previousButton.title = gfT("player.prev");
    }
    if (footer && previousButton && progress && nextButton) {
      footer.appendChild(previousButton);
      footer.appendChild(progress);
      footer.appendChild(nextButton);
      if (footerButtons && footerButtons !== footer && !footerButtons.children.length) {
        footerButtons.remove();
      }
    }
  }

  const els = {
    image: document.getElementById("player-image"),
    slide: document.getElementById("player-slide"),
    slideKicker: document.getElementById("player-slide-kicker"),
    slideTitle: document.getElementById("player-slide-title"),
    slideBody: document.getElementById("player-slide-body"),
    hotspot: document.getElementById("player-hotspot"),
    clickPoint: document.getElementById("player-click-point"),
    clickFx: document.getElementById("click-fx"),
    cursor: document.getElementById("sim-cursor"),
    progress: document.getElementById("player-progress"),
    frame: document.getElementById("player-frame"),
    caption: document.getElementById("player-caption"),
  };

  const clickFx = createClickFxController(els);
  const narration = createNarrationController(els.caption);
  const chkAutoplay = document.getElementById("chk-autoplay");

  let driverObj = null;
  let activeIndex = 0;
  let animating = false;
  let autoplayTimer = null;

  function setProgress(text) {
    if (els.progress) els.progress.textContent = text;
  }

  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function autoplayOn() {
    return !!chkAutoplay?.checked;
  }

  function clearAutoplay() {
    clearTimeout(autoplayTimer);
    autoplayTimer = null;
  }

  function armAutoplay() {
    clearAutoplay();
    if (!autoplayOn() || !driverObj) return;
    const step = demo.steps[activeIndex];
    if (!step) return;
    const speechDone = narration.whenSpeechDone();
    autoplayTimer = setTimeout(async () => {
      await speechDone;
      const btn = document.querySelector(".driver-popover-next-btn");
      if (btn) btn.click();
    }, holdMs(step));
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

  function placeClickPoint(point) {
    const cp = point || { x: 50, y: 50 };
    const w = els.image.clientWidth;
    const h = els.image.clientHeight;
    els.clickPoint.style.left = (cp.x / 100) * w + "px";
    els.clickPoint.style.top = (cp.y / 100) * h + "px";
  }

  function clickTarget(step) {
    const cp = ensureClickPoint(step);
    return {
      x: (cp.x / 100) * els.image.clientWidth,
      y: (cp.y / 100) * els.image.clientHeight,
    };
  }

  function applySlideLayout(slideEl, step) {
    if (!slideEl) return;
    const align = step && step.layout && step.layout.align;
    const valign = step && step.layout && step.layout.valign;
    slideEl.dataset.align = align === "center" || align === "end" ? align : "start";
    slideEl.dataset.valign = valign === "top" || valign === "bottom" ? valign : "center";
  }

  async function showStepVisual(step, speak) {
    return new Promise((resolve) => {
      narration.enterStep(step, !!speak);
      if (step.type === "slide") {
        els.image.hidden = true;
        els.image.removeAttribute("src");
        const missing = document.getElementById("player-missing");
        if (missing) missing.hidden = true;
        els.slide.hidden = false;
        els.slideKicker.textContent = gfT("player.scene", { n: step.scene });
        els.slideTitle.textContent = step.popover?.title || step.label || "";
        els.slideBody.textContent = step.popover?.description || "";
        applySlideLayout(els.slide, step);
        els.hotspot.style.display = "none";
        els.clickPoint.hidden = true;
        resolve();
        return;
      }

      els.slide.hidden = true;
      els.hotspot.style.display = "block";
      els.clickPoint.hidden = false;

      const src = resolveImageSrc(step.image);
      const missing = document.getElementById("player-missing");
      const done = (ok) => {
        if (missing) missing.hidden = !!ok;
        if (!ok) {
          els.image.hidden = true;
          els.hotspot.style.display = "none";
        }
        requestAnimationFrame(() => {
          if (ok) {
            placeHotspot(step.hotspot);
            placeClickPoint(ensureClickPoint(step));
          }
          resolve();
        });
      };

      if (!src) {
        done(false);
        return;
      }
      els.image.onload = () => {
        els.image.hidden = false;
        done(true);
      };
      els.image.onerror = () => done(false);
      if (els.image.getAttribute("src") === src && els.image.complete && els.image.naturalWidth) {
        els.image.hidden = false;
        done(true);
      } else {
        els.image.hidden = true;
        els.image.src = src;
      }
    });
  }

  async function animateClick(step) {
    if (step.type === "slide" || step.simulateClick === false) return;
    await clickFx.animateTo(clickTarget(step), { pressHotspot: true });
  }

  function stop() {
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
  }

  async function buildAndDrive(startIndex, opts) {
    stop();
    if (opts && typeof opts.autoplay === "boolean" && chkAutoplay) {
      chkAutoplay.checked = opts.autoplay;
    }

    const steps = demo.steps;
    if (!steps.length) {
      toast(gfT("player.noSteps"));
      return;
    }

    const factory = window.driver?.js?.driver || window.driver;
    if (!factory) {
      toast(gfT("player.driverMissing"));
      return;
    }

    activeIndex = startIndex;
    await narration.startTour();
    await showStepVisual(steps[activeIndex], true);

    const overlay =
      getComputedStyle(document.documentElement).getPropertyValue("--demo-overlay").trim() ||
      "#000000";

    driverObj = factory({
      popoverClass: "demo-popover",
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayColor: hexToRgba(overlay, 0.55),
      stagePadding: 6,
      disableActiveInteraction: false,
      nextBtnText: gfT("player.next"),
      prevBtnText: "",
      doneBtnText: gfT("player.done"),
      progressText: gfT("player.progress"),
      onPopoverRender: (popover) => {
        renderDemoPopoverFooter(popover);
        setPopoverHiddenForSlide(steps[activeIndex]?.type === "slide");
        armAutoplay();
      },
      steps: steps.map((step) => ({
        element: step.type === "slide" ? "#player-slide" : "#player-hotspot",
        popover: {
          title: step.popover?.title || step.label || "",
          description: (step.popover?.description || "").replace(/\n/g, "<br/>"),
          side: step.popover?.side || "bottom",
          align: step.popover?.align || "center",
          onNextClick: async (_el, _step, optsNext) => {
            if (animating) return;
            animating = true;
            clearAutoplay();
            const current = steps[activeIndex];
            const drv = optsNext.driver;
            try {
              await animateClick(current);
              const nextIndex = activeIndex + 1;
              if (nextIndex >= steps.length) {
                drv.destroy();
                driverObj = null;
                narration.stop();
                setProgress(gfT("player.doneStatus"));
                return;
              }
              activeIndex = nextIndex;
              setProgress(gfT("player.stepOf", { current: activeIndex + 1, total: steps.length }));
              await showStepVisual(steps[activeIndex], true);
              drv.moveNext();
            } finally {
              animating = false;
            }
          },
          onPrevClick: async (_el, _step, optsPrev) => {
            if (animating || activeIndex <= 0) return;
            animating = true;
            clearAutoplay();
            const drv = optsPrev.driver;
            try {
              activeIndex -= 1;
              setProgress(gfT("player.stepOf", { current: activeIndex + 1, total: steps.length }));
              await showStepVisual(steps[activeIndex], true);
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
        setProgress(gfT("player.stopped"));
        clickFx.reset();
      },
    });

    setProgress(gfT("player.stepOf", { current: activeIndex + 1, total: steps.length }));
    driverObj.drive(activeIndex);
  }

  applyTheme(demo.theme);

  const startSel = document.getElementById("start-step");
  if (startSel) {
    startSel.innerHTML = demo.steps
      .map((step, i) => {
        const label = (step.popover?.title || step.label || gfT("editor.stepFallback")).replace(/</g, "&lt;");
        return `<option value="${i}">${i + 1}. ${label}</option>`;
      })
      .join("");
  }

  function startIndex() {
    return Number(startSel?.value || 0);
  }

  document.getElementById("btn-play")?.addEventListener("click", () => {
    buildAndDrive(startIndex(), { autoplay: false });
  });
  document.getElementById("btn-watch")?.addEventListener("click", () => {
    buildAndDrive(startIndex(), { autoplay: true });
  });
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    buildAndDrive(0, { autoplay: autoplayOn() });
  });
  document.getElementById("btn-stop")?.addEventListener("click", () => {
    stop();
    setProgress(gfT("player.stopped"));
  });

  function setPopoverHiddenForSlide(hidden) {
    document.querySelectorAll(".driver-popover").forEach((el) => {
      el.classList.toggle("is-slide-hidden", !!hidden);
    });
  }

  function clickDriverNext() {
    const btn = document.querySelector(".driver-popover-next-btn");
    if (btn && !btn.disabled) btn.click();
  }

  function onHighlightClick(e) {
    if (!driverObj) return;
    if (e.target.closest(".slide-card-play, .slide-card-close")) return;
    e.preventDefault();
    e.stopPropagation();
    clickDriverNext();
  }
  els.hotspot.addEventListener("click", onHighlightClick);
  els.slide.addEventListener("click", onHighlightClick);
  document.getElementById("player-slide-play")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (driverObj) clickDriverNext();
    else buildAndDrive(Number(document.getElementById("start-step")?.value || activeIndex), { autoplay: false });
  });
  document.getElementById("player-slide-close")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!driverObj) return;
    stop();
    setProgress(gfT("player.stopped"));
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      stop();
      setProgress(gfT("player.stopped"));
    }
  });

  window.addEventListener("resize", () => {
    const step = demo.steps[activeIndex];
    if (step && step.type !== "slide" && !els.image.hidden) {
      placeHotspot(step.hotspot);
      placeClickPoint(ensureClickPoint(step));
    }
  });

  setProgress(gfT("player.readyHint"));
})();
