import {
  IMAGE_CATALOG,
  createStepId,
  resolveImageSrc,
  shortImageLabel,
  ensureCustomImages,
  fileToDataUrl,
  ensureClickPoint,
  clickPointFromHotspot,
  applyTheme,
  formToTheme,
  bindImage,
} from "./store.js";
import { createClickFxController } from "./clickFx.js";
import { clickDriverNext } from "./popoverFooter.js";
import { isPlausibleApiKey, defaultVoiceURI } from "./cartesia.js";
import { cartesiaKeyStatus, deleteCartesiaKey, putCartesiaKey } from "./cartesia-store.js";
import {
  CAPTION_PLAYBACK_RATES,
  DEFAULT_HOLD_SECONDS,
  NARRATION_VOICES,
  ensureNarration,
  ensurePlayback,
  generateNarrationClips,
  minHoldSecondsForStep,
  normalizeCaptionPlaybackRate,
  playableNarrationClips,
  savedNarrationClips,
  stopSpeech,
} from "./playback.js";
import { insertSceneAfter, moveScene, renumberScenes } from "./scenes.js";
import { t } from "./i18n.js";

function ensureSceneLabels(demo) {
  if (!demo.sceneLabels || typeof demo.sceneLabels !== "object") {
    demo.sceneLabels = {};
  }
  return demo.sceneLabels;
}

function sceneLabel(demo, scene) {
  const n = Number(scene) || 1;
  const labels = ensureSceneLabels(demo);
  const fromDemo = labels[n] ?? labels[String(n)];
  if (fromDemo) return fromDemo;
  if (Object.keys(labels).length) return "";
  return n === 1 ? t("editor.defaultScene1") : "";
}

function setSceneLabel(demo, scene, name) {
  const labels = ensureSceneLabels(demo);
  const n = Number(scene) || 1;
  const text = String(name || "").trim() || t("filmstrip.scene", { n });
  delete labels[n];
  labels[String(n)] = text;
  return text;
}

function stepListName(step) {
  return (
    step?.popover?.title ||
    step?.label ||
    (step?.type === "slide" ? t("editor.slideFallback") : t("editor.stepFallback"))
  );
}

function containSize(nw, nh, maxW, maxH) {
  const w0 = Math.max(1, nw || 16);
  const h0 = Math.max(1, nh || 9);
  const scale = Math.min(maxW / w0, maxH / h0);
  return { w: Math.round(w0 * scale), h: Math.round(h0 * scale) };
}

function mediaMaxBox(stage) {
  const styles = stage ? getComputedStyle(stage) : null;
  const padX = styles ? parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight) : 32;
  const maxW = Math.min(1200, Math.max(280, (stage?.clientWidth || 800) - (Number.isFinite(padX) ? padX : 32)));
  const maxH = Math.max(200, window.innerHeight - 160);
  return { maxW, maxH };
}

function referenceImageSrc(demo, step, resolve) {
  const steps = demo?.steps || [];
  const start = Math.max(0, steps.indexOf(step));
  const ordered = start ? [...steps.slice(0, start).reverse(), ...steps.slice(start + 1)] : steps.slice(1);
  for (const item of ordered) {
    if (item && item.type !== "slide" && item.image) return resolve(demo, item.image);
  }
  return "";
}

const imageSizeCache = new Map();

export function applySlideLayout(slideEl, step) {
  if (!slideEl) return;
  const align = step?.layout?.align;
  const valign = step?.layout?.valign;
  slideEl.dataset.align = align === "center" || align === "end" ? align : "start";
  slideEl.dataset.valign = valign === "top" || valign === "bottom" ? valign : "center";
}

export function sizeSlideLikeImage(slideEl, stage, demo, step, resolve) {
  if (!slideEl) return;
  const { maxW, maxH } = mediaMaxBox(stage);
  const paint = (nw, nh) => {
    const box = containSize(nw, nh, maxW, maxH);
    slideEl.style.width = box.w + "px";
    slideEl.style.height = box.h + "px";
  };
  const src = referenceImageSrc(demo, step, resolve);
  if (!src) {
    paint(16, 9);
    return;
  }
  const cached = imageSizeCache.get(src);
  if (cached) {
    paint(cached.w, cached.h);
    return;
  }
  paint(16, 9);
  const probe = new Image();
  probe.onload = () => {
    imageSizeCache.set(src, { w: probe.naturalWidth, h: probe.naturalHeight });
    paint(probe.naturalWidth, probe.naturalHeight);
  };
  probe.src = src;
}

function projectUsesCatalog(demo) {
  return (demo?.steps || []).some((step) => {
    const img = step?.image;
    return img && !img.startsWith("custom:") && !img.startsWith("data:") && !img.startsWith("blob:");
  });
}

export function createEditor(ctx) {
  const {
    getDemo,
    setDemo,
    getSelectedIndex,
    setSelectedIndex,
    toast,
    onChange,
    onPlayFrom,
  } = ctx;

  const els = {
    filmstrip: document.getElementById("filmstrip"),
    canvasFrame: document.getElementById("canvas-frame"),
    canvasStage: document.getElementById("canvas-stage"),
    canvasEmpty: document.getElementById("canvas-empty"),
    canvasImage: document.getElementById("canvas-image"),
    canvasSlide: document.getElementById("canvas-slide"),
    canvasMissing: document.getElementById("canvas-missing"),
    slideKicker: document.getElementById("canvas-slide-kicker"),
    slideTitle: document.getElementById("canvas-slide-title"),
    slideBody: document.getElementById("canvas-slide-body"),
    hotspot: document.getElementById("hotspot"),
    clickPoint: document.getElementById("click-point"),
    clickFx: document.getElementById("editor-click-fx"),
    cursor: document.getElementById("editor-sim-cursor"),
    propType: document.getElementById("prop-type"),
    propImage: document.getElementById("prop-image"),
    propImageThumb: document.getElementById("prop-image-thumb"),
    propImageName: document.getElementById("prop-image-name"),
    propTitle: document.getElementById("prop-title"),
    propDescription: document.getElementById("prop-description"),
    propCaption: document.getElementById("prop-caption"),
    propShowCaption: document.getElementById("prop-show-caption"),
    propHold: document.getElementById("prop-hold"),
    propHoldHint: document.getElementById("prop-hold-hint"),
    captionAudioFile: document.getElementById("caption-audio-file"),
    btnClearCaptionAudio: document.getElementById("btn-clear-caption-audio"),
    propSide: document.getElementById("prop-side"),
    propAlign: document.getElementById("prop-align"),
    labelSide: document.getElementById("label-side"),
    labelAlign: document.getElementById("label-align"),
    propSimulate: document.getElementById("prop-simulate-click"),
    wrapSimulate: document.getElementById("wrap-simulate"),
    wrapImage: document.getElementById("wrap-image"),
    canvasCaption: document.getElementById("canvas-caption"),
    imagesFile: document.getElementById("images-file"),
    imageModal: document.getElementById("image-modal"),
    imageGrid: document.getElementById("image-grid"),
    imageSearch: document.getElementById("image-search"),
    propsPanel: document.getElementById("props-panel"),
    narrationEnabled: document.getElementById("narration-enabled"),
    narrationVoice: document.getElementById("narration-voice"),
    narrationRate: document.getElementById("narration-rate"),
    narrationRateLabel: document.getElementById("narration-rate-label"),
    playbackDefaultHold: document.getElementById("playback-default-hold"),
    narrationBgName: document.getElementById("narration-bg-name"),
    narrationBgFile: document.getElementById("narration-bg-file"),
    btnNarrationBgClear: document.getElementById("btn-narration-bg-clear"),
  };

  let suppressForm = false;
  let dragMode = null;
  let dragStart = null;
  let filmDragFrom = null;
  let filmDragKind = "step";
  let pickMode = "replace"; // replace | createSteps
  let clickPointDragging = false;
  let previewDriver = null;

  const clickFx = createClickFxController({
    frame: els.canvasFrame,
    hotspot: els.hotspot,
    cursor: els.cursor,
    clickFx: els.clickFx,
  });

  function currentStep() {
    const demo = getDemo();
    return demo.steps[getSelectedIndex()] || null;
  }

  function fillImageSelect() {
    const demo = getDemo();
    ensureCustomImages(demo);
    const custom = Object.entries(demo.customImages).map(
      ([id, meta]) => `<option value="custom:${id}">${escapeHtml(meta.name || id)}</option>`
    );
    const catalog = projectUsesCatalog(demo)
      ? IMAGE_CATALOG.map(
          (path) => `<option value="${escapeAttr(path)}">${escapeHtml(path)}</option>`
        )
      : [];
    els.propImage.innerHTML =
      `<option value="">${escapeHtml(t("props.noImage"))}</option>` + [...custom, ...catalog].join("");
  }

  function readChoice(group, fallback) {
    const active = [...(group?.querySelectorAll(".is-active") || [])].find((btn) => !btn.hidden);
    return active?.dataset.value || fallback;
  }

  function setChoice(group, value) {
    if (!group) return;
    group.querySelectorAll("[data-value]").forEach((btn) => {
      const on = btn.dataset.value === value;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function syncImageButton() {
    const demo = getDemo();
    const step = currentStep();
    if (!step || step.type === "slide") return;
    const src = resolveImageSrc(demo, step.image);
    const label = shortImageLabel(step.image, demo);
    els.propImageName.textContent = label;
    if (src) {
      els.propImageThumb.hidden = false;
      els.propImageThumb.src = src;
    } else {
      els.propImageThumb.hidden = true;
      els.propImageThumb.removeAttribute("src");
    }
  }

  function renderFilmstrip() {
    const demo = getDemo();
    const selected = getSelectedIndex();
    if (!demo.steps.length) {
      els.filmstrip.innerHTML = `<p class="film-hint">${escapeHtml(t("filmstrip.empty"))}</p>`;
      return;
    }
    let html = "";
    let lastScene = null;

    demo.steps.forEach((step, index) => {
      if (step.scene !== lastScene) {
        lastScene = step.scene;
        const label = sceneLabel(demo, step.scene);
        html += `<div class="film-scene" data-scene="${Number(step.scene) || 1}" draggable="true">
          <span class="film-grip" aria-hidden="true">⋮⋮</span>
          <span class="film-scene-label" data-action="rename-scene-inline" data-scene="${Number(step.scene) || 1}" title="${escapeAttr(t("filmstrip.sceneRename"))}">${escapeHtml(t("filmstrip.scene", { n: step.scene }))}${label ? ` · ${escapeHtml(label)}` : ""}</span>
        </div>`;
      }
      const src = resolveImageSrc(demo, step.image);
      const thumb =
        step.type === "slide"
          ? `<div class="film-thumb-slide">SLIDE</div>`
          : src
            ? `<img src="${escapeAttr(src)}" alt="" loading="lazy" draggable="false" />`
            : `<div class="film-thumb-slide">—</div>`;
      html += `
        <div class="film-item ${index === selected ? "is-active" : ""}"
             data-index="${index}"
             draggable="true"
             role="button"
             tabindex="0">
          <span class="film-grip" aria-hidden="true">⋮⋮</span>
          ${thumb}
          <div class="film-meta">
            <strong>${escapeHtml(stepListName(step))}</strong>
            <span>#${index + 1}</span>
          </div>
          <div class="film-actions">
            <button type="button" class="film-action-close" data-action="delete" title="${escapeAttr(t("filmstrip.remove"))}" aria-label="${escapeAttr(t("filmstrip.remove"))}">×</button>
          </div>
        </div>`;
    });

    els.filmstrip.innerHTML = html;
    els.filmstrip.querySelectorAll("img").forEach((img) => {
      img.addEventListener("error", () => {
        img.replaceWith(Object.assign(document.createElement("div"), {
          className: "film-thumb-slide",
          textContent: "—",
        }));
      });
    });
  }

  function syncSideAlignControls(step) {
    const isSlide = step?.type === "slide";
    const scope = isSlide ? "slide" : "screen";
    if (els.labelSide) els.labelSide.textContent = isSlide ? t("props.vertical") : t("props.side");
    if (els.propSide) {
      els.propSide.setAttribute("aria-label", isSlide ? t("props.vertical") : t("props.side"));
      els.propSide.querySelectorAll("[data-scope]").forEach((btn) => {
        btn.hidden = btn.dataset.scope !== scope;
      });
    }
    if (els.propAlign) {
      const titles = isSlide
        ? { start: t("props.left"), center: t("props.center"), end: t("props.right") }
        : { start: t("props.start"), center: t("props.center"), end: t("props.end") };
      els.propAlign.querySelectorAll("[data-value]").forEach((btn) => {
        const label = titles[btn.dataset.value];
        if (!label) return;
        btn.title = label;
        btn.setAttribute("aria-label", label);
      });
    }
    if (isSlide) {
      setChoice(els.propSide, step.layout?.valign || "center");
      setChoice(els.propAlign, step.layout?.align || "start");
    } else {
      setChoice(els.propSide, step.popover?.side || "bottom");
      setChoice(els.propAlign, step.popover?.align || "center");
    }
    if (els.wrapSimulate) els.wrapSimulate.hidden = !!isSlide;
  }

  function syncForm() {
    const step = currentStep();
    const demo = getDemo();
    ensurePlayback(demo);
    ensureNarration(demo);
    if (!step) {
      if (els.propsPanel) els.propsPanel.classList.add("is-disabled");
      syncNarrationPanel();
      return;
    }
    if (els.propsPanel) els.propsPanel.classList.remove("is-disabled");
    suppressForm = true;
    fillImageSelect();
    setChoice(els.propType, step.type === "slide" ? "slide" : "screen");
    if (step.image) els.propImage.value = step.image;
    else els.propImage.value = "";
    els.propTitle.value = step.popover?.title || step.label || "";
    els.propDescription.value = step.popover?.description || "";
    if (els.propCaption) els.propCaption.value = step.caption || "";
    if (els.propShowCaption) els.propShowCaption.checked = step.showCaption !== false;
    if (els.propHold) {
      const custom = Number(step.holdSeconds);
      els.propHold.value =
        Number.isFinite(custom) && custom > 0 ? String(custom) : "";
      els.propHold.placeholder = String(demo.playback.defaultHoldSeconds);
    }
    els.propSimulate.checked = step.simulateClick !== false;
    syncSideAlignControls(step);
    els.wrapImage.hidden = step.type === "slide";
    syncImageButton();
    syncNarrationPanel();
    syncCaptionAudio();
    suppressForm = false;
  }

  const captionPlayer = {
    audio: null,
    clips: [],
    durations: [],
    index: 0,
    rate: 1,
    playing: false,
    seeking: false,
    key: "",
    stepId: "",
    loadToken: 0,
  };

  function formatClock(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const whole = Math.floor(safe + 1e-6);
    const minutes = Math.floor(whole / 60);
    const remain = whole % 60;
    return `${minutes}:${String(remain).padStart(2, "0")}`;
  }

  function formatRate(rate) {
    const n = normalizeCaptionPlaybackRate(rate);
    return `${Number.isInteger(n) ? String(n) : String(n)}×`;
  }

  function clipsKey(clips) {
    return clips.map((url) => `${url.length}:${url.slice(-24)}`).join("|");
  }

  function captionTotal() {
    if (captionPlayer.durations.length) {
      return captionPlayer.durations.reduce((sum, n) => sum + n, 0);
    }
    const stored = Number(currentStep()?.narrationAudio?.durationSeconds);
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  }

  function captionPosition() {
    if (!captionPlayer.audio || !captionPlayer.durations.length) return 0;
    const base = captionPlayer.durations
      .slice(0, captionPlayer.index)
      .reduce((sum, n) => sum + n, 0);
    return base + (captionPlayer.audio.currentTime || 0);
  }

  function detachCaptionAudio() {
    const audio = captionPlayer.audio;
    if (!audio) return;
    audio.pause();
    audio.onloadedmetadata = null;
    audio.ontimeupdate = null;
    audio.onended = null;
    audio.removeAttribute("src");
    audio.load();
    captionPlayer.audio = null;
  }

  function stopCaptionPlayer() {
    captionPlayer.playing = false;
    captionPlayer.seeking = false;
    captionPlayer.index = 0;
    captionPlayer.clips = [];
    captionPlayer.durations = [];
    captionPlayer.key = "";
    captionPlayer.stepId = "";
    captionPlayer.loadToken += 1;
    detachCaptionAudio();
    renderCaptionPlayer();
  }

  function pauseCaption() {
    captionPlayer.playing = false;
    captionPlayer.audio?.pause();
    renderCaptionPlayer();
  }

  function measureClipDurations(clips) {
    return Promise.all(
      clips.map(
        (url) =>
          new Promise((resolve) => {
            if (typeof Audio === "undefined") {
              resolve(0);
              return;
            }
            const audio = new Audio();
            let settled = false;
            const finish = (value) => {
              if (settled) return;
              settled = true;
              audio.onloadedmetadata = null;
              audio.onerror = null;
              audio.removeAttribute("src");
              audio.load();
              resolve(Number.isFinite(value) && value > 0 && value !== Infinity ? value : 0);
            };
            audio.preload = "metadata";
            audio.onloadedmetadata = () => finish(audio.duration);
            audio.onerror = () => finish(0);
            setTimeout(() => finish(0), 8000);
            audio.src = url;
          })
      )
    );
  }

  function storedClipDurations(step, clips) {
    const stored = step?.narrationAudio?.clipDurations;
    if (!Array.isArray(stored) || stored.length !== clips.length) return null;
    if (!stored.every((n) => Number.isFinite(n) && n > 0)) return null;
    return stored.slice();
  }

  function persistCaptionTiming(step) {
    const audio = step?.narrationAudio;
    if (!audio || !captionPlayer.durations.length) return false;
    const total = captionPlayer.durations.reduce((sum, n) => sum + n, 0);
    const same =
      audio.durationSeconds === total &&
      Array.isArray(audio.clipDurations) &&
      audio.clipDurations.length === captionPlayer.durations.length &&
      audio.clipDurations.every((n, i) => n === captionPlayer.durations[i]);
    audio.clipDurations = captionPlayer.durations.slice();
    audio.durationSeconds = total;
    return !same;
  }

  function writeHoldFromInput(step, clampHold) {
    const demo = getDemo();
    ensurePlayback(demo);
    const floor = minHoldSecondsForStep(step, demo);
    const holdRaw = els.propHold?.value?.trim();
    if (holdRaw) {
      const hold = Number(holdRaw);
      if (Number.isFinite(hold) && hold > 0) {
        if (floor != null && hold < floor) {
          if (clampHold) {
            step.holdSeconds = floor;
            if (els.propHold) els.propHold.value = String(floor);
          }
          return;
        }
        step.holdSeconds = hold;
        return;
      }
    }
    if (clampHold && floor != null) {
      const fallback = Number(demo.playback.defaultHoldSeconds) || DEFAULT_HOLD_SECONDS;
      if (fallback < floor) {
        step.holdSeconds = floor;
        if (els.propHold) els.propHold.value = String(floor);
        return;
      }
    }
    if (!holdRaw || clampHold) delete step.holdSeconds;
  }

  function enforceHoldFloor(step) {
    const demo = getDemo();
    if (!demo || !step) return false;
    ensurePlayback(demo);
    const floor = minHoldSecondsForStep(step, demo);
    syncHoldChrome(step, floor);
    if (floor == null) return false;
    const current = Number(step.holdSeconds);
    const hasCustom = Number.isFinite(current) && current > 0;
    const effective = hasCustom ? current : Number(demo.playback.defaultHoldSeconds) || DEFAULT_HOLD_SECONDS;
    if (effective >= floor) return false;
    step.holdSeconds = floor;
    if (els.propHold && currentStep() === step && document.activeElement !== els.propHold) {
      const was = suppressForm;
      suppressForm = true;
      els.propHold.value = String(floor);
      suppressForm = was;
    }
    return true;
  }

  function syncHoldChrome(step, floor = minHoldSecondsForStep(step, getDemo())) {
    const demo = getDemo();
    if (!demo) return;
    ensurePlayback(demo);
    if (els.propHold) {
      els.propHold.min = String(floor || 1);
      els.propHold.max = String(Math.max(120, floor || 1));
      if (!els.propHold.value) {
        els.propHold.placeholder = String(demo.playback.defaultHoldSeconds);
      }
    }
    if (!els.propHoldHint) return;
    if (floor) {
      els.propHoldHint.hidden = false;
      els.propHoldHint.textContent = t("props.holdMin", { n: floor });
      return;
    }
    els.propHoldHint.hidden = true;
    els.propHoldHint.textContent = "";
  }

  function renderCaptionPlayer() {
    const player = document.getElementById("caption-player");
    const seek = document.getElementById("caption-seek");
    const timeEl = document.getElementById("caption-time");
    const durationEl = document.getElementById("caption-duration");
    const playBtn = document.getElementById("btn-caption-play");
    const rateBtn = document.getElementById("btn-caption-rate");
    if (!player) return;
    const total = captionTotal();
    const pos = captionPlayer.seeking && seek
      ? (Number(seek.value || 0) / 1000) * total
      : captionPosition();
    const ratio = total > 0 ? Math.min(1, Math.max(0, pos / total)) : 0;
    if (seek) {
      seek.disabled = !total;
      seek.style.setProperty("--pct", `${ratio * 100}%`);
      if (!captionPlayer.seeking) seek.value = String(Math.round(ratio * 1000));
    }
    if (timeEl) timeEl.textContent = formatClock(pos);
    if (durationEl) durationEl.textContent = formatClock(total);
    if (playBtn) {
      const playing = captionPlayer.playing;
      playBtn.disabled = !captionPlayer.clips.length || !total;
      playBtn.setAttribute("aria-label", playing ? t("canvas.pause") : t("canvas.play"));
      playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
      playBtn.classList.toggle("is-playing", playing);
    }
    if (rateBtn) {
      const label = formatRate(captionPlayer.rate);
      rateBtn.textContent = label;
      rateBtn.setAttribute("aria-label", t("props.playbackRate", { rate: label }));
    }
  }

  function mountCaptionClip(index) {
    detachCaptionAudio();
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = captionPlayer.clips[index];
    audio.playbackRate = captionPlayer.rate;
    captionPlayer.index = index;
    captionPlayer.audio = audio;
    audio.ontimeupdate = () => renderCaptionPlayer();
    audio.onended = () => {
      onCaptionClipEnded();
    };
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      if (captionPlayer.durations[index] === duration) return;
      captionPlayer.durations[index] = duration;
      const step = currentStep();
      if (!step) return;
      const timingChanged = persistCaptionTiming(step);
      const holdChanged = enforceHoldFloor(step);
      if (timingChanged || holdChanged) onChange();
      renderCaptionPlayer();
    };
    return audio;
  }

  async function onCaptionClipEnded() {
    if (!captionPlayer.playing) return;
    const next = captionPlayer.index + 1;
    if (next >= captionPlayer.clips.length) {
      captionPlayer.playing = false;
      captionPlayer.index = 0;
      if (captionPlayer.clips.length) {
        const audio = mountCaptionClip(0);
        const reset = () => {
          try {
            audio.currentTime = 0;
          } catch {
            /* metadata ainda não chegou */
          }
          renderCaptionPlayer();
        };
        if (audio.readyState >= 1) reset();
        else audio.addEventListener("loadedmetadata", reset, { once: true });
      }
      renderCaptionPlayer();
      return;
    }
    const audio = mountCaptionClip(next);
    try {
      await audio.play();
    } catch {
      captionPlayer.playing = false;
    }
    renderCaptionPlayer();
  }

  async function seekCaption(ratio) {
    const total = captionTotal();
    if (!total || !captionPlayer.durations.length) return;
    const target = Math.min(total, Math.max(0, ratio * total));
    let acc = 0;
    let index = captionPlayer.durations.length - 1;
    for (let i = 0; i < captionPlayer.durations.length; i += 1) {
      if (acc + captionPlayer.durations[i] >= target - 0.01) {
        index = i;
        break;
      }
      acc += captionPlayer.durations[i];
    }
    const local = Math.max(0, target - acc);
    const playing = captionPlayer.playing;
    if (!captionPlayer.audio || captionPlayer.index !== index) mountCaptionClip(index);
    const audio = captionPlayer.audio;
    const apply = () => {
      try {
        audio.currentTime = Math.min(local, Math.max(0, (audio.duration || local) - 0.05));
      } catch {
        /* ignora seek antes dos metadados */
      }
      audio.playbackRate = captionPlayer.rate;
      if (playing) {
        audio.play().catch(() => {
          captionPlayer.playing = false;
          renderCaptionPlayer();
        });
      }
      renderCaptionPlayer();
    };
    if (audio.readyState >= 1) apply();
    else audio.addEventListener("loadedmetadata", apply, { once: true });
  }

  async function toggleCaptionPlayback() {
    if (!captionPlayer.clips.length || !captionTotal()) return;
    if (captionPlayer.playing) {
      captionPlayer.playing = false;
      captionPlayer.audio?.pause();
      renderCaptionPlayer();
      return;
    }
    stopSpeech();
    if (!captionPlayer.audio) mountCaptionClip(captionPlayer.index || 0);
    const audio = captionPlayer.audio;
    audio.playbackRate = captionPlayer.rate;
    captionPlayer.playing = true;
    try {
      await audio.play();
    } catch {
      captionPlayer.playing = false;
    }
    renderCaptionPlayer();
  }

  function cycleCaptionRate() {
    const step = currentStep();
    if (!step?.narrationAudio) return;
    const current = normalizeCaptionPlaybackRate(captionPlayer.rate);
    const index = CAPTION_PLAYBACK_RATES.indexOf(current);
    const next = CAPTION_PLAYBACK_RATES[(index + 1) % CAPTION_PLAYBACK_RATES.length];
    captionPlayer.rate = next;
    step.narrationAudio.playbackRate = next;
    if (captionPlayer.audio) captionPlayer.audio.playbackRate = next;
    enforceHoldFloor(step);
    renderCaptionPlayer();
    onChange();
  }

  async function primeCaptionDurations(step, clips) {
    const token = ++captionPlayer.loadToken;
    const stored = storedClipDurations(step, clips);
    if (stored) {
      captionPlayer.durations = stored;
      const changed = persistCaptionTiming(step);
      const holdChanged = enforceHoldFloor(step);
      if (changed || holdChanged) onChange();
      renderCaptionPlayer();
      return;
    }
    const durations = await measureClipDurations(clips);
    if (token !== captionPlayer.loadToken || currentStep() !== step) return;
    captionPlayer.durations = durations;
    const changed = persistCaptionTiming(step);
    const holdChanged = enforceHoldFloor(step);
    if (changed || holdChanged) onChange();
    renderCaptionPlayer();
  }

  function syncCaptionAudio() {
    const step = currentStep();
    const demo = getDemo();
    const statusEl = document.getElementById("caption-audio-status");
    const player = document.getElementById("caption-player");
    const actionsEl = document.getElementById("caption-audio-actions");
    const wrapShow = document.getElementById("wrap-show-caption");
    const generateBtn = document.getElementById("btn-generate-caption");
    const uploadBtn = document.getElementById("btn-upload-caption");
    const clearBtn = els.btnClearCaptionAudio;
    const hasText = String(step?.caption || "").trim().length > 0;
    const clips = step && demo ? savedNarrationClips(step, demo) : [];

    if (wrapShow) wrapShow.hidden = !hasText;
    if (generateBtn) generateBtn.hidden = !hasText;
    if (uploadBtn) uploadBtn.hidden = !hasText;
    if (clearBtn) clearBtn.hidden = !clips.length;
    if (actionsEl) actionsEl.hidden = !hasText && !clips.length;

    if (!clips.length) {
      stopCaptionPlayer();
      if (player) player.hidden = true;
      syncHoldChrome(step);
      if (!statusEl) return;
      if (!hasText) {
        statusEl.hidden = true;
        return;
      }
      const hasStaleTts =
        step?.narrationAudio?.source !== "upload" &&
        Array.isArray(step?.narrationAudio?.clips) &&
        step.narrationAudio.clips.length;
      if (hasStaleTts) {
        statusEl.hidden = false;
        statusEl.textContent = t("props.audioStale");
        return;
      }
      statusEl.hidden = false;
      statusEl.textContent = t("props.noAudio");
      return;
    }
    if (player) player.hidden = false;
    if (statusEl) {
      const name = step.narrationAudio?.name;
      if (step.narrationAudio?.source === "upload" && name) {
        statusEl.hidden = false;
        statusEl.textContent = name;
      } else {
        statusEl.hidden = true;
      }
    }
    const key = clipsKey(clips);
    if (captionPlayer.key !== key || captionPlayer.stepId !== step.id) {
      detachCaptionAudio();
      captionPlayer.playing = false;
      captionPlayer.seeking = false;
      captionPlayer.index = 0;
      captionPlayer.clips = clips.slice();
      captionPlayer.durations = [];
      captionPlayer.key = key;
      captionPlayer.stepId = step.id || "";
      captionPlayer.rate = normalizeCaptionPlaybackRate(step.narrationAudio?.playbackRate);
      if (step.narrationAudio) step.narrationAudio.playbackRate = captionPlayer.rate;
      renderCaptionPlayer();
      primeCaptionDurations(step, clips);
      return;
    }
    captionPlayer.rate = normalizeCaptionPlaybackRate(step.narrationAudio?.playbackRate);
    enforceHoldFloor(step);
    renderCaptionPlayer();
  }

  function syncNarrationPanel() {
    const demo = getDemo();
    if (!demo) return;
    ensurePlayback(demo);
    ensureNarration(demo);
    if (els.narrationEnabled) els.narrationEnabled.checked = demo.narration.enabled !== false;
    if (els.narrationRate) {
      els.narrationRate.value = String(demo.narration.rate ?? 1);
      if (els.narrationRateLabel) {
        els.narrationRateLabel.textContent = `${Number(els.narrationRate.value).toFixed(1)}×`;
      }
    }
    if (els.playbackDefaultHold) {
      els.playbackDefaultHold.value = String(demo.playback.defaultHoldSeconds || DEFAULT_HOLD_SECONDS);
    }
    fillVoiceSelect(demo.narration.voiceURI);
    const bg = demo.narration.background;
    if (els.narrationBgName) {
      els.narrationBgName.textContent = bg?.name || t("narration.noFile");
    }
    if (els.btnNarrationBgClear) els.btnNarrationBgClear.hidden = !bg?.dataUrl;
  }

  function fillVoiceSelect(selectedURI) {
    if (!els.narrationVoice) return;
    const current = els.narrationVoice.value;
    const prefer = selectedURI || current || defaultVoiceURI();
    els.narrationVoice.innerHTML = "";
    NARRATION_VOICES.forEach((voice) => {
      const opt = document.createElement("option");
      opt.value = voice.id;
      opt.textContent = t(voice.labelKey || "cartesia.voice.pt-BR");
      els.narrationVoice.appendChild(opt);
    });
    if ([...els.narrationVoice.options].some((o) => o.value === prefer)) {
      els.narrationVoice.value = prefer;
    } else {
      els.narrationVoice.value = defaultVoiceURI();
    }
  }

  function setCanvasCaption(text, { visible = true } = {}) {
    if (!els.canvasCaption) return;
    const trimmed = String(text || "").trim();
    els.canvasCaption.textContent = trimmed;
    els.canvasCaption.hidden = !visible || !trimmed;
  }

  function renderCanvas() {
    const demo = getDemo();
    const step = currentStep();

    if (!demo.steps.length || !step) {
      if (els.canvasEmpty) els.canvasEmpty.hidden = false;
      els.canvasFrame.hidden = true;
      els.hotspot.hidden = true;
      els.clickPoint.hidden = true;
      els.canvasSlide.hidden = true;
      els.canvasImage.hidden = true;
      if (els.canvasMissing) els.canvasMissing.hidden = true;
      setCanvasCaption("");
      return;
    }

    if (els.canvasEmpty) els.canvasEmpty.hidden = true;
    els.canvasFrame.hidden = false;
    setCanvasCaption(step.caption, { visible: step.showCaption !== false });

    if (step.type === "slide") {
      els.canvasImage.hidden = true;
      els.canvasImage.removeAttribute("src");
      if (els.canvasMissing) els.canvasMissing.hidden = true;
      els.canvasSlide.hidden = false;
      const label = sceneLabel(demo, step.scene);
      els.slideKicker.textContent = label
        ? `${t("filmstrip.scene", { n: step.scene })} · ${label}`
        : t("filmstrip.scene", { n: step.scene });
      els.slideTitle.textContent = step.popover?.title || step.label || "";
      els.slideBody.textContent = step.popover?.description || "";
      applySlideLayout(els.canvasSlide, step);
      sizeSlideLikeImage(els.canvasSlide, els.canvasStage, demo, step, resolveImageSrc);
      els.hotspot.hidden = true;
      els.clickPoint.hidden = true;
      return;
    }

    els.canvasSlide.hidden = true;
    els.hotspot.hidden = false;
    els.clickPoint.hidden = false;

    const src = resolveImageSrc(demo, step.image);
    bindImage(els.canvasImage, src, (ok) => {
      if (els.canvasMissing) els.canvasMissing.hidden = ok;
      if (ok) {
        placeHotspot(step.hotspot);
        placeClickPoint(ensureClickPoint(step));
      } else {
        els.hotspot.hidden = true;
        els.clickPoint.hidden = true;
      }
    });
  }

  function placeHotspot(hotspot) {
    const hs = hotspot || { x: 40, y: 40, w: 12, h: 8 };
    const img = els.canvasImage;
    const rect = getImageContentRect(img);
    els.hotspot.style.left = rect.left + (hs.x / 100) * rect.width + "px";
    els.hotspot.style.top = rect.top + (hs.y / 100) * rect.height + "px";
    els.hotspot.style.width = (hs.w / 100) * rect.width + "px";
    els.hotspot.style.height = (hs.h / 100) * rect.height + "px";
  }

  function placeClickPoint(point) {
    const cp = point || { x: 50, y: 50 };
    const rect = getImageContentRect(els.canvasImage);
    els.clickPoint.style.left = rect.left + (cp.x / 100) * rect.width + "px";
    els.clickPoint.style.top = rect.top + (cp.y / 100) * rect.height + "px";
  }

  function readHotspotFromDom() {
    const img = els.canvasImage;
    const rect = getImageContentRect(img);
    const hs = els.hotspot.getBoundingClientRect();
    const frame = els.canvasFrame.getBoundingClientRect();
    const left = hs.left - frame.left - rect.left;
    const top = hs.top - frame.top - rect.top;
    return {
      x: clamp((left / rect.width) * 100, 0, 100),
      y: clamp((top / rect.height) * 100, 0, 100),
      w: clamp((hs.width / rect.width) * 100, 1, 100),
      h: clamp((hs.height / rect.height) * 100, 1, 100),
    };
  }

  function commitHotspot() {
    const step = currentStep();
    if (!step || step.type === "slide") return;
    step.hotspot = readHotspotFromDom();
    if (!step.clickPoint) step.clickPoint = clickPointFromHotspot(step.hotspot);
    onChange();
  }

  function readClickPointFromDom() {
    const rect = getImageContentRect(els.canvasImage);
    const frame = els.canvasFrame.getBoundingClientRect();
    const pt = els.clickPoint.getBoundingClientRect();
    const cx = pt.left + pt.width / 2 - frame.left - rect.left;
    const cy = pt.top + pt.height / 2 - frame.top - rect.top;
    return {
      x: clamp((cx / rect.width) * 100, 0, 100),
      y: clamp((cy / rect.height) * 100, 0, 100),
    };
  }

  function commitClickPoint() {
    const step = currentStep();
    if (!step || step.type === "slide") return;
    step.clickPoint = readClickPointFromDom();
    onChange();
  }

  function setClickPointAtClient(clientX, clientY) {
    const step = currentStep();
    if (!step || step.type === "slide") return;
    const frame = els.canvasFrame.getBoundingClientRect();
    const rect = getImageContentRect(els.canvasImage);
    const x = ((clientX - frame.left - rect.left) / rect.width) * 100;
    const y = ((clientY - frame.top - rect.top) / rect.height) * 100;
    step.clickPoint = { x: clamp(x, 0, 100), y: clamp(y, 0, 100) };
    placeClickPoint(step.clickPoint);
    onChange();
  }

  function applyFormToStep(options) {
    if (suppressForm) return;
    const step = currentStep();
    if (!step) return;
    const wasSlide = step.type === "slide";
    step.type = readChoice(els.propType, step.type) === "slide" ? "slide" : "screen";
    const title = els.propTitle.value;
    step.label = title;
    if (els.propImage.value) step.image = els.propImage.value;
    step.simulateClick = els.propSimulate.checked;
    step.caption = els.propCaption?.value || "";
    step.showCaption = els.propShowCaption ? els.propShowCaption.checked : true;
    writeHoldFromInput(step, options?.clampHold !== false);
    const isSlide = step.type === "slide";
    const typeChanged = wasSlide !== isSlide;
    step.popover = {
      title,
      description: els.propDescription.value,
      side: isSlide || typeChanged ? step.popover?.side || "bottom" : readChoice(els.propSide, "bottom"),
      align: isSlide || typeChanged ? step.popover?.align || "center" : readChoice(els.propAlign, "center"),
    };
    if (isSlide && !typeChanged) {
      step.layout = {
        align: readChoice(els.propAlign, "start"),
        valign: readChoice(els.propSide, "center"),
      };
    }
    els.wrapImage.hidden = isSlide;
    syncSideAlignControls(step);
    syncImageButton();
    renderFilmstrip();
    renderCanvas();
    syncCaptionAudio();
    onChange();
  }

  function applyNarrationPanel() {
    if (suppressForm) return;
    const demo = getDemo();
    ensurePlayback(demo);
    ensureNarration(demo);
    demo.narration.enabled = els.narrationEnabled?.checked !== false;
    demo.narration.voiceURI = els.narrationVoice?.value || "";
    const rate = Number(els.narrationRate?.value);
    demo.narration.rate = Number.isFinite(rate) ? Math.min(1.4, Math.max(0.7, rate)) : 1;
    if (els.narrationRateLabel) {
      els.narrationRateLabel.textContent = `${demo.narration.rate.toFixed(1)}×`;
    }
    const hold = Number(els.playbackDefaultHold?.value);
    demo.playback.defaultHoldSeconds =
      Number.isFinite(hold) && hold > 0 ? hold : DEFAULT_HOLD_SECONDS;
    if (els.propHold && !els.propHold.value) {
      els.propHold.placeholder = String(demo.playback.defaultHoldSeconds);
    }
    syncCaptionAudio();
    onChange();
  }

  function renameSceneInline(host, sceneNumber) {
    if (!host || host.dataset.editing === "1") return;
    const demo = getDemo();
    const n = Number(sceneNumber) || 1;
    const current = sceneLabel(demo, n) || "";
    host.dataset.editing = "1";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-edit";
    input.value = current;
    input.maxLength = 60;
    input.setAttribute("aria-label", t("editor.sceneNameAria"));
    host.replaceChildren(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      host.dataset.editing = "0";
      const next = input.value.trim();
      if (save && next) {
        setSceneLabel(demo, n, next);
        onChange();
      }
      renderFilmstrip();
      syncForm();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function openSceneModal(mode, sceneNumber) {
    const demo = getDemo();
    const modal = document.getElementById("modal-scene");
    const title = document.getElementById("modal-scene-title");
    const nameInput = document.getElementById("scene-name");
    const modeInput = document.getElementById("scene-mode");
    const numberInput = document.getElementById("scene-number");
    const submit = document.getElementById("btn-submit-scene");
    if (!modal || !nameInput) return;

    if (mode === "rename") {
      const n = Number(sceneNumber) || Number(currentStep()?.scene) || 1;
      title.textContent = t("modal.renameScene", { n });
      modeInput.value = "rename";
      numberInput.value = String(n);
      nameInput.value = sceneLabel(demo, n) || t("filmstrip.scene", { n });
      submit.textContent = t("modal.save");
    } else {
      title.textContent = t("modal.newScene");
      modeInput.value = "create";
      numberInput.value = "";
      nameInput.value = "";
      submit.textContent = t("modal.create");
    }
    modal.showModal();
    nameInput.focus();
    nameInput.select();
  }

  function commitSceneModal() {
    const demo = getDemo();
    const mode = document.getElementById("scene-mode")?.value || "create";
    const name = document.getElementById("scene-name")?.value || "";
    let n = Number(document.getElementById("scene-number")?.value) || 0;

    if (mode === "create") {
      const after = Number(currentStep()?.scene) || null;
      const step = {
        id: createStepId(),
        scene: 1,
        label: t("editor.newStep"),
        type: "screen",
        image: "",
        hotspot: { x: 40, y: 40, w: 14, h: 8 },
        clickPoint: { x: 47, y: 44 },
        popover: {
          title: t("editor.newStep"),
          description: t("editor.editHint"),
          side: "bottom",
          align: "center",
        },
        caption: "",
        simulateClick: true,
        onNext: "advance",
      };
      const idx = insertSceneAfter(demo, after, step, name);
      setDemo(demo);
      document.getElementById("modal-scene")?.close();
      if (idx >= 0) selectStep(idx);
      else renderFilmstrip();
      onChange();
      toast(t("toast.sceneCreated", { n: step.scene }));
      return;
    }

    if (!n) n = Number(currentStep()?.scene) || 1;
    setSceneLabel(demo, n, name);
    setDemo(demo);
    document.getElementById("modal-scene")?.close();
    syncForm();
    renderFilmstrip();
    renderCanvas();
    onChange();
    toast(t("toast.sceneRenamed", { n }));
  }

  function selectStep(index) {
    setSelectedIndex(index);
    renderFilmstrip();
    syncForm();
    renderCanvas();
  }

  function reorderSteps(fromIndex, toIndex, scene) {
    if (fromIndex < 0 || toIndex < 0) return;
    const demo = getDemo();
    const sameSlot = fromIndex === toIndex;
    const nextScene = scene == null ? null : Number(scene) || 1;
    if (sameSlot) {
      const step = demo.steps[fromIndex];
      if (!step || nextScene == null || Number(step.scene) === nextScene) return;
      step.scene = nextScene;
      renumberScenes(demo);
      setDemo(demo);
      renderFilmstrip();
      syncForm();
      renderCanvas();
      onChange();
      toast(t("toast.orderUpdated"));
      return;
    }
    const [moved] = demo.steps.splice(fromIndex, 1);
    demo.steps.splice(toIndex, 0, moved);
    if (nextScene != null) moved.scene = nextScene;
    renumberScenes(demo);
    setDemo(demo);
    setSelectedIndex(toIndex);
    renderFilmstrip();
    syncForm();
    renderCanvas();
    onChange();
    toast(t("toast.orderUpdated"));
  }

  function addStep(asSlide = false) {
    const demo = getDemo();
    const prev = currentStep();
    const step = {
      id: createStepId(),
      scene: prev?.scene || 1,
      label: asSlide ? t("editor.newSlide") : t("editor.newStep"),
      type: asSlide ? "slide" : "screen",
      image: asSlide ? "" : prev?.image || "",
      hotspot: { x: 40, y: 40, w: 14, h: 8 },
      clickPoint: { x: 47, y: 44 },
      popover: {
        title: asSlide ? t("editor.newSlide") : t("editor.newStep"),
        description: t("editor.editHint"),
        side: "bottom",
        align: "center",
      },
      ...(asSlide ? { layout: { align: "start", valign: "center" } } : {}),
      caption: "",
      simulateClick: !asSlide,
      onNext: "advance",
    };
    const idx = demo.steps.length ? getSelectedIndex() + 1 : 0;
    demo.steps.splice(idx, 0, step);
    renumberScenes(demo);
    setDemo(demo);
    selectStep(idx);
    onChange();
    toast(t("toast.stepAdded"));
  }

  function duplicateStep() {
    const demo = getDemo();
    const step = currentStep();
    if (!step) {
      toast(t("toast.nothingToDup"));
      return;
    }
    const copy = structuredClone(step);
    copy.id = createStepId();
    const base = copy.popover?.title || copy.label || (copy.type === "slide" ? t("editor.slideFallback") : t("editor.stepFallback"));
    const next = t("editor.copySuffix", { name: base });
    copy.label = next;
    if (!copy.popover) copy.popover = {};
    copy.popover.title = next;
    const idx = getSelectedIndex() + 1;
    demo.steps.splice(idx, 0, copy);
    renumberScenes(demo);
    setDemo(demo);
    selectStep(idx);
    onChange();
    toast(t("toast.stepDuplicated"));
  }

  function deleteStep() {
    const demo = getDemo();
    if (!demo.steps.length) {
      toast(t("toast.nothingToRemove"));
      return;
    }
    demo.steps.splice(getSelectedIndex(), 1);
    renumberScenes(demo);
    setDemo(demo);
    if (!demo.steps.length) {
      setSelectedIndex(0);
      refresh();
    } else {
      selectStep(Math.max(0, Math.min(getSelectedIndex(), demo.steps.length - 1)));
    }
    onChange();
    toast(t("toast.stepRemoved"));
  }

  async function ingestImageFiles(files, { createSteps }) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      toast(t("toast.noValidImage"));
      return;
    }

    const demo = getDemo();
    ensureCustomImages(demo);
    const prev = currentStep();
    const refs = [];

    for (const file of list) {
      const dataUrl = await fileToDataUrl(file);
      const id = createStepId().replace("step-", "img-");
      demo.customImages[id] = {
        name: file.name,
        dataUrl,
        addedAt: Date.now(),
      };
      refs.push(`custom:${id}`);
    }

    if (createSteps) {
      let idx = demo.steps.length ? getSelectedIndex() + 1 : 0;
      const firstIdx = idx;
      refs.forEach((ref, i) => {
        const name = demo.customImages[ref.slice(7)].name.replace(/\.[^.]+$/, "");
        const step = {
          id: createStepId(),
          scene: prev?.scene || 1,
          label: name || `Imagem ${i + 1}`,
          type: "screen",
          image: ref,
          hotspot: { x: 40, y: 40, w: 14, h: 8 },
          clickPoint: { x: 47, y: 44 },
          popover: {
            title: name || t("editor.newHighlight"),
            description: t("editor.editExplain"),
            side: "bottom",
            align: "center",
          },
          caption: "",
          simulateClick: true,
          onNext: "advance",
        };
        demo.steps.splice(idx, 0, step);
        idx += 1;
      });
      setDemo(demo);
      selectStep(firstIdx);
      toast(t("toast.imagesAdded", { n: refs.length }));
    } else {
      const step = currentStep();
      if (step && step.type !== "slide") {
        step.image = refs[0];
        step.label = step.label || demo.customImages[refs[0].slice(7)].name;
      }
      setDemo(demo);
      fillImageSelect();
      syncForm();
      renderCanvas();
      renderFilmstrip();
      onChange();
      toast(t("toast.imageApplied"));
    }

    if (els.imageModal.open) renderImageGrid();
  }

  function openImageModal(mode = "replace") {
    pickMode = mode;
    const title = els.imageModal?.querySelector("h3");
    if (title) title.textContent = mode === "add" ? t("modal.images") : t("modal.pickImage");
    els.imageSearch.value = "";
    renderImageGrid();
    els.imageModal.showModal();
    els.imageSearch.focus();
  }

  function insertScreenStep(ref) {
    const demo = getDemo();
    const rawLabel = shortImageLabel(ref, demo).replace(/\.[^.]+$/, "");
    const prev = demo.steps[getSelectedIndex()];
    const step = {
      id: createStepId(),
      scene: prev?.scene || 1,
      label: rawLabel || t("editor.defaultImage"),
      type: "screen",
      image: ref,
      hotspot: { x: 40, y: 40, w: 14, h: 8 },
      clickPoint: { x: 47, y: 44 },
      popover: {
        title: rawLabel || t("editor.newHighlight"),
        description: t("editor.editExplain"),
        side: "bottom",
        align: "center",
      },
      caption: "",
      simulateClick: true,
      onNext: "advance",
    };
    const idx = demo.steps.length ? getSelectedIndex() + 1 : 0;
    demo.steps.splice(idx, 0, step);
    setDemo(demo);
    selectStep(idx);
    if (els.imageModal.open) renderImageGrid();
    toast(t("toast.imageAsStep"));
  }

  function renderImageGrid() {
    const demo = getDemo();
    ensureCustomImages(demo);
    const q = (els.imageSearch.value || "").trim().toLowerCase();
    const items = [];

    Object.entries(demo.customImages).forEach(([id, meta]) => {
      items.push({
        ref: `custom:${id}`,
        label: meta.name || id,
        src: meta.dataUrl,
        group: t("editor.imageGroup"),
      });
    });

    if (projectUsesCatalog(demo)) {
      IMAGE_CATALOG.forEach((path) => {
        items.push({
          ref: path,
          label: path,
          src: resolveImageSrc(demo, path),
          group: path.split("/")[0] || t("editor.catalogGroup"),
        });
      });
    }

    const filtered = items.filter(
      (it) => !q || it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q)
    );

    let html = "";
    let lastGroup = null;
    filtered.forEach((it) => {
      if (it.group !== lastGroup) {
        lastGroup = it.group;
        html += `<div class="image-grid-group">${escapeHtml(it.group)}</div>`;
      }
      const active = currentStep()?.image === it.ref ? "is-selected" : "";
      const remove =
        it.ref.startsWith("custom:")
          ? `<button type="button" class="image-tile-remove" data-remove-image="${escapeAttr(it.ref)}" aria-label="${escapeAttr(t("editor.removeImage"))}" title="${escapeAttr(t("filmstrip.remove"))}">×</button>`
          : "";
      html += `
        <div class="image-tile-wrap">
          <button type="button" class="image-tile ${active}" data-ref="${escapeAttr(it.ref)}" title="${escapeAttr(it.label)}">
            <img src="${escapeAttr(it.src)}" alt="" loading="lazy" />
            <span>${escapeHtml(shortImageLabel(it.ref, demo))}</span>
          </button>
          ${remove}
        </div>`;
    });

    els.imageGrid.innerHTML =
      html || `<p class="image-grid-empty">Nenhuma imagem ainda. Arraste, cole ou envie do computador.</p>`;
  }

  function removeCustomImage(ref) {
    if (!ref?.startsWith("custom:")) return;
    const id = ref.slice(7);
    const demo = getDemo();
    ensureCustomImages(demo);
    if (!demo.customImages[id]) return;
    delete demo.customImages[id];
    demo.steps.forEach((step) => {
      if (step.image === ref) step.image = "";
    });
    setDemo(demo);
    syncForm();
    renderCanvas();
    renderFilmstrip();
    renderImageGrid();
    onChange();
    toast(t("toast.imageRemoved"));
  }

  function withImageName(file) {
    if (file.name) return file;
    const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1] || "png";
    return new File([file], `colada-${Date.now()}.${ext}`, { type: file.type });
  }

  function imageFilesFromTransfer(data) {
    const out = [];
    const push = (file) => {
      if (file && file.type.startsWith("image/")) out.push(withImageName(file));
    };
    if (data?.files?.length) {
      for (const file of data.files) push(file);
    }
    if (!out.length && data?.items) {
      for (const item of data.items) {
        if (item.kind === "file") push(item.getAsFile());
      }
    }
    return out;
  }

  async function ingestDroppedImages(data) {
    const files = imageFilesFromTransfer(data);
    if (!files.length) return false;
    await ingestImageFiles(files, {
      createSteps: pickMode === "add" || pickMode === "createSteps",
    });
    return true;
  }

  function applyImageRef(ref) {
    if (pickMode === "add") {
      insertScreenStep(ref);
      return;
    }
    const step = currentStep();
    if (!step || step.type === "slide") return;
    step.image = ref;
    const demo = getDemo();
    const label = shortImageLabel(ref, demo);
    const name = label.replace(/\.[^.]+$/, "");
    const defaults = new Set(["", t("editor.newStep"), t("editor.newHighlight"), t("editor.newSlide")]);
    if (!step.popover) step.popover = {};
    if (defaults.has(step.label || "") || defaults.has(step.popover.title || "")) {
      step.label = name;
      if (defaults.has(step.popover.title || "")) step.popover.title = name;
    }
    if (els.propTitle) els.propTitle.value = step.popover.title || step.label || "";
    fillImageSelect();
    els.propImage.value = ref;
    syncImageButton();
    renderCanvas();
    renderFilmstrip();
    onChange();
    els.imageModal.close();
    toast(t("toast.imageSelected"));
  }

  function clearFilmDropMarks() {
    els.filmstrip.querySelectorAll(".film-item, .film-scene").forEach((el) => {
      el.classList.remove("drop-before", "drop-after", "is-drop-target");
    });
  }

  function bindFilmstripDnD() {
    els.filmstrip.addEventListener("dragstart", (e) => {
      if (e.target.closest("button, .inline-edit")) {
        e.preventDefault();
        return;
      }
      const sceneRow = e.target.closest(".film-scene");
      const item = e.target.closest(".film-item");
      if (sceneRow && !item) {
        filmDragKind = "scene";
        filmDragFrom = Number(sceneRow.dataset.scene) || 1;
        sceneRow.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `scene:${filmDragFrom}`);
        return;
      }
      if (!item) return;
      filmDragKind = "step";
      filmDragFrom = Number(item.dataset.index);
      item.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(filmDragFrom));
    });

    els.filmstrip.addEventListener("dragend", () => {
      els.filmstrip.querySelectorAll(".film-item, .film-scene").forEach((el) => {
        el.classList.remove("is-dragging");
      });
      clearFilmDropMarks();
      filmDragFrom = null;
      filmDragKind = "step";
    });

    function eventElement(target) {
      return target?.nodeType === 1 ? target : target?.parentElement || null;
    }

    function sceneAtPointer(target) {
      const node = eventElement(target);
      if (!node?.closest) return null;
      const sceneEl = node.closest(".film-scene");
      if (sceneEl) return Number(sceneEl.dataset.scene) || 1;
      const item = node.closest(".film-item");
      if (!item) return null;
      const demo = getDemo();
      return Number(demo.steps[Number(item.dataset.index)]?.scene) || 1;
    }

    function placeForScene(scene, clientY) {
      const header = els.filmstrip.querySelector(`.film-scene[data-scene="${scene}"]`);
      const items = [...els.filmstrip.querySelectorAll(".film-item")].filter((el) => {
        const demo = getDemo();
        return Number(demo.steps[Number(el.dataset.index)]?.scene) === scene;
      });
      const top = header?.getBoundingClientRect().top ?? items[0]?.getBoundingClientRect().top ?? clientY;
      const bottom = (items.at(-1) || header)?.getBoundingClientRect().bottom ?? clientY;
      return clientY > (top + bottom) / 2 ? "after" : "before";
    }

    els.filmstrip.addEventListener("dragover", (e) => {
      if (filmDragFrom === null) return;
      const node = eventElement(e.target);
      const item = node?.closest(".film-item");
      const sceneEl = node?.closest(".film-scene");
      if (!item && !sceneEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearFilmDropMarks();
      if (filmDragKind === "scene") {
        const scene = sceneAtPointer(e.target);
        if (scene == null) return;
        const header = els.filmstrip.querySelector(`.film-scene[data-scene="${scene}"]`);
        header?.classList.add(placeForScene(scene, e.clientY) === "after" ? "drop-after" : "drop-before");
        return;
      }
      if (sceneEl && !item) {
        sceneEl.classList.add("is-drop-target");
        return;
      }
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      item.classList.add(before ? "drop-before" : "drop-after");
    });

    els.filmstrip.addEventListener("drop", (e) => {
      if (filmDragFrom === null) return;
      const node = eventElement(e.target);
      const item = node?.closest(".film-item");
      const sceneEl = node?.closest(".film-scene");
      if (!item && !sceneEl) return;
      e.preventDefault();
      const demo = getDemo();
      const fromIndex = filmDragFrom;

      if (filmDragKind === "scene") {
        const scene = sceneAtPointer(e.target);
        if (scene == null) return;
        const selected = currentStep();
        const moved = moveScene(demo, fromIndex, scene, placeForScene(scene, e.clientY));
        if (!moved) return;
        const idx = selected ? demo.steps.indexOf(selected) : 0;
        setDemo(demo);
        selectStep(Math.max(0, idx));
        onChange();
        toast(t("toast.sceneMoved"));
        return;
      }

      if (sceneEl && !item) {
        const scene = Number(sceneEl.dataset.scene) || 1;
        let cursor = sceneEl.nextElementSibling;
        while (cursor && !cursor.classList.contains("film-item")) {
          if (cursor.classList.contains("film-scene")) break;
          cursor = cursor.nextElementSibling;
        }
        let toIndex = cursor?.classList.contains("film-item")
          ? Number(cursor.dataset.index)
          : demo.steps.length;
        if (fromIndex < toIndex) toIndex -= 1;
        reorderSteps(fromIndex, toIndex, scene);
        return;
      }

      const targetIndex = Number(item.dataset.index);
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      let toIndex = before ? targetIndex : targetIndex + 1;
      if (fromIndex < toIndex) toIndex -= 1;
      const scene = Number(demo.steps[targetIndex]?.scene) || 1;
      reorderSteps(fromIndex, toIndex, scene);
    });

    els.filmstrip.addEventListener("click", (e) => {
      const sceneLabelEl = e.target.closest('[data-action="rename-scene-inline"]');
      if (sceneLabelEl) {
        e.preventDefault();
        e.stopPropagation();
        renameSceneInline(sceneLabelEl, Number(sceneLabelEl.dataset.scene) || 1);
        return;
      }

      const actionBtn = e.target.closest("[data-action]");
      const item = e.target.closest("[data-index]");
      if (!item) return;
      const index = Number(item.dataset.index);
      if (actionBtn) {
        e.preventDefault();
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        if (action === "up") reorderSteps(index, index - 1);
        else if (action === "down") reorderSteps(index, index + 1);
        else if (action === "delete") {
          setSelectedIndex(index);
          deleteStep();
        }
        return;
      }
      selectStep(index);
    });

    els.filmstrip.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const item = e.target.closest("[data-index]");
      if (!item) return;
      e.preventDefault();
      selectStep(Number(item.dataset.index));
    });
  }

  function bindHotspotDrag() {
    function presenting() {
      return document.getElementById("view-editor")?.classList.contains("is-presenting");
    }

    els.hotspot.addEventListener("pointerdown", (e) => {
      if (presenting() || els.hotspot.classList.contains("is-previewing")) return;
      if (e.target.dataset.handle) {
        dragMode = e.target.dataset.handle;
      } else {
        dragMode = "move";
      }
      els.hotspot.setPointerCapture(e.pointerId);
      const rect = els.hotspot.getBoundingClientRect();
      dragStart = {
        x: e.clientX,
        y: e.clientY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        frame: els.canvasFrame.getBoundingClientRect(),
      };
      e.preventDefault();
      e.stopPropagation();
    });

    els.hotspot.addEventListener("pointermove", (e) => {
      if (!dragMode || !dragStart) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      const frame = dragStart.frame;
      let left = dragStart.left - frame.left;
      let top = dragStart.top - frame.top;
      let width = dragStart.width;
      let height = dragStart.height;

      if (dragMode === "move") {
        left += dx;
        top += dy;
      } else {
        if (dragMode.includes("e")) width = Math.max(24, dragStart.width + dx);
        if (dragMode.includes("s")) height = Math.max(24, dragStart.height + dy);
        if (dragMode.includes("w")) {
          width = Math.max(24, dragStart.width - dx);
          left = dragStart.left - frame.left + dx;
        }
        if (dragMode.includes("n")) {
          height = Math.max(24, dragStart.height - dy);
          top = dragStart.top - frame.top + dy;
        }
      }

      els.hotspot.style.left = left + "px";
      els.hotspot.style.top = top + "px";
      els.hotspot.style.width = width + "px";
      els.hotspot.style.height = height + "px";
    });

    els.hotspot.addEventListener("pointerup", () => {
      if (!dragMode) return;
      dragMode = null;
      dragStart = null;
      commitHotspot();
    });

    els.hotspot.addEventListener("click", (e) => {
      if (!els.hotspot.classList.contains("is-previewing")) return;
      e.preventDefault();
      e.stopPropagation();
      clickDriverNext();
    });

    els.canvasSlide.addEventListener("click", (e) => {
      if (!previewDriver || presenting()) return;
      e.preventDefault();
      e.stopPropagation();
      clickDriverNext();
    });

    els.clickPoint.addEventListener("pointerdown", (e) => {
      if (presenting()) return;
      clickPointDragging = true;
      els.clickPoint.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });

    els.clickPoint.addEventListener("pointermove", (e) => {
      if (!clickPointDragging) return;
      const frame = els.canvasFrame.getBoundingClientRect();
      const rect = getImageContentRect(els.canvasImage);
      const x = clamp(e.clientX - frame.left, rect.left, rect.left + rect.width);
      const y = clamp(e.clientY - frame.top, rect.top, rect.top + rect.height);
      els.clickPoint.style.left = x + "px";
      els.clickPoint.style.top = y + "px";
    });

    els.clickPoint.addEventListener("pointerup", () => {
      if (!clickPointDragging) return;
      clickPointDragging = false;
      commitClickPoint();
    });

    els.canvasImage.addEventListener("click", (e) => {
      if (presenting()) return;
      const step = currentStep();
      if (!step || step.type === "slide") return;

      // Shift+clique: centraliza o retângulo de destaque
      if (e.shiftKey) {
        const frame = els.canvasFrame.getBoundingClientRect();
        const rect = getImageContentRect(els.canvasImage);
        const hs = step.hotspot || { w: 12, h: 8 };
        const clickX = e.clientX - frame.left - rect.left;
        const clickY = e.clientY - frame.top - rect.top;
        const wPx = (hs.w / 100) * rect.width;
        const hPx = (hs.h / 100) * rect.height;
        els.hotspot.style.left = rect.left + clickX - wPx / 2 + "px";
        els.hotspot.style.top = rect.top + clickY - hPx / 2 + "px";
        els.hotspot.style.width = wPx + "px";
        els.hotspot.style.height = hPx + "px";
        commitHotspot();
        return;
      }

      // Clique normal: define o ponto do clique simulado
      setClickPointAtClient(e.clientX, e.clientY);
    });
  }

  function bindChoice(group) {
    if (!group) return;
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-value]");
      if (!btn || !group.contains(btn)) return;
      setChoice(group, btn.dataset.value);
      applyFormToStep();
    });
  }

  function cartesiaBridge() {
    const bridge = window.guiaDesktopApp;
    if (!bridge?.cartesiaStatus || !bridge.cartesiaSaveKey) return null;
    return bridge;
  }

  async function refreshCartesiaStatus() {
    const statusEl = document.getElementById("cartesia-status");
    const clearBtn = document.getElementById("btn-cartesia-clear");
    if (!statusEl) return;
    const bridge = cartesiaBridge();
    try {
      const status = bridge ? await bridge.cartesiaStatus() : await cartesiaKeyStatus();
      const where = bridge ? "no chaveiro do sistema" : "neste navegador";
      if (status?.configured) {
        statusEl.textContent = status.masked
          ? `Chave ${status.masked} ${where}.`
          : `Chave salva ${where}.`;
        if (clearBtn) clearBtn.hidden = false;
        return;
      }
      statusEl.textContent = t("cartesia.noKey");
      if (clearBtn) clearBtn.hidden = true;
    } catch {
      statusEl.textContent = t("cartesia.readFail");
      if (clearBtn) clearBtn.hidden = true;
    }
  }

  async function saveCartesiaKey() {
    const input = document.getElementById("cartesia-key");
    const key = input?.value?.trim() || "";
    if (!isPlausibleApiKey(key)) {
      toast(t("toast.cartesiaKeyPrefix"));
      return;
    }
    const bridge = cartesiaBridge();
    let result;
    try {
      result = bridge ? await bridge.cartesiaSaveKey(key) : await putCartesiaKey(key).then(() => ({ ok: true }));
    } catch {
      result = { ok: false, error: t("toast.cartesiaSaveFail") };
    } finally {
      if (input) input.value = "";
    }
    if (!result?.ok) {
      toast(result?.error || t("toast.cartesiaSaveFail"));
      await refreshCartesiaStatus();
      return;
    }
    toast(bridge ? t("toast.cartesiaSavedKeychain") : t("toast.cartesiaSavedBrowser"));
    await refreshCartesiaStatus();
  }

  async function generateCaptionAudio() {
    const step = currentStep();
    const demo = getDemo();
    ensureNarration(demo);
    const text = els.propCaption?.value?.trim() || "";
    if (!step || !text) {
      toast(t("toast.needCaptionText"));
      return;
    }
    const btn = document.getElementById("btn-generate-caption");
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("toast.generating");
    }
    try {
      const clips = await generateNarrationClips(text, {
        voiceURI: demo.narration.voiceURI,
        rate: demo.narration.rate,
      });
      const durations = await measureClipDurations(clips);
      const playbackRate = normalizeCaptionPlaybackRate(step.narrationAudio?.playbackRate);
      step.caption = text;
      step.narrationAudio = {
        source: "tts",
        caption: text,
        voiceURI: demo.narration.voiceURI || "",
        rate: demo.narration.rate ?? 1,
        playbackRate,
        durationSeconds: durations.reduce((sum, n) => sum + n, 0),
        clipDurations: durations,
        clips,
      };
      enforceHoldFloor(step);
      onChange();
      syncCaptionAudio();
      toast(t("toast.audioSaved"));
    } catch (err) {
      toast(err?.message || t("toast.audioGenFail"));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = t("props.generateAudio");
      }
    }
  }

  async function uploadCaptionAudio(file) {
    const step = currentStep();
    if (!step || !file) return;
    if (!String(file.type || "").startsWith("audio/") && !/\.(mp3|ogg|wav|m4a|aac|webm)$/i.test(file.name)) {
      toast(t("toast.chooseAudioFile"));
      return;
    }
    const btn = document.getElementById("btn-upload-caption");
    if (btn) {
      btn.disabled = true;
      btn.textContent = t("toast.uploading");
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!String(dataUrl).startsWith("data:audio/")) {
        toast(t("toast.audioReadFail"));
        return;
      }
      const clips = [dataUrl];
      const durations = await measureClipDurations(clips);
      const playbackRate = normalizeCaptionPlaybackRate(step.narrationAudio?.playbackRate);
      step.narrationAudio = {
        source: "upload",
        name: file.name,
        caption: String(step.caption || "").trim(),
        playbackRate,
        durationSeconds: durations.reduce((sum, n) => sum + n, 0),
        clipDurations: durations,
        clips,
      };
      enforceHoldFloor(step);
      onChange();
      syncCaptionAudio();
      toast(t("toast.audioUploaded"));
    } catch (err) {
      toast(err?.message || t("toast.audioUploadFail"));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = t("props.uploadAudio");
      }
    }
  }

  function clearCaptionAudio() {
    const step = currentStep();
    if (!step?.narrationAudio) return;
    stopCaptionPlayer();
    delete step.narrationAudio;
    syncCaptionAudio();
    onChange();
    toast(t("toast.audioRemoved"));
  }

  async function clearCartesiaKey() {
    const bridge = cartesiaBridge();
    let result;
    try {
      result = bridge ? await bridge.cartesiaLogout() : await deleteCartesiaKey().then(() => ({ ok: true }));
    } catch {
      result = { ok: false, error: t("toast.cartesiaClearFail") };
    }
    toast(result?.ok ? t("toast.cartesiaCleared") : result?.error || t("toast.cartesiaClearFail"));
    await refreshCartesiaStatus();
  }

  function bindForm() {
    [els.propTitle, els.propDescription, els.propCaption, els.propShowCaption, els.propSimulate].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", applyFormToStep);
      el.addEventListener("change", applyFormToStep);
    });
    if (els.propHold) {
      els.propHold.addEventListener("input", () => applyFormToStep({ clampHold: false }));
      els.propHold.addEventListener("change", () => applyFormToStep({ clampHold: true }));
    }
    document.getElementById("btn-caption-play")?.addEventListener("click", () => {
      toggleCaptionPlayback();
    });
    document.getElementById("btn-caption-rate")?.addEventListener("click", cycleCaptionRate);
    const captionSeek = document.getElementById("caption-seek");
    captionSeek?.addEventListener("pointerdown", () => {
      captionPlayer.seeking = true;
    });
    captionSeek?.addEventListener("input", () => {
      captionPlayer.seeking = true;
      renderCaptionPlayer();
      const ratio = Number(captionSeek.value || 0) / 1000;
      seekCaption(ratio);
    });
    captionSeek?.addEventListener("change", () => {
      captionPlayer.seeking = false;
      renderCaptionPlayer();
    });
    bindChoice(els.propType);
    bindChoice(els.propSide);
    bindChoice(els.propAlign);

    [
      els.narrationEnabled,
      els.narrationVoice,
      els.narrationRate,
      els.playbackDefaultHold,
    ].forEach((el) => {
      if (!el) return;
      el.addEventListener("input", applyNarrationPanel);
      el.addEventListener("change", applyNarrationPanel);
    });

    document.getElementById("narration-panel")?.addEventListener("toggle", (event) => {
      if (event.currentTarget.open) refreshCartesiaStatus();
    });
    document.getElementById("btn-cartesia-save")?.addEventListener("click", saveCartesiaKey);
    document.getElementById("btn-cartesia-clear")?.addEventListener("click", clearCartesiaKey);
    refreshCartesiaStatus();

    document.getElementById("btn-generate-caption")?.addEventListener("click", generateCaptionAudio);
    document.getElementById("btn-upload-caption")?.addEventListener("click", () => {
      els.captionAudioFile?.click();
    });
    els.captionAudioFile?.addEventListener("change", async () => {
      const file = els.captionAudioFile.files?.[0];
      els.captionAudioFile.value = "";
      if (!file) return;
      await uploadCaptionAudio(file);
    });
    els.btnClearCaptionAudio?.addEventListener("click", clearCaptionAudio);

    document.getElementById("btn-narration-bg")?.addEventListener("click", () => {
      els.narrationBgFile?.click();
    });
    els.narrationBgFile?.addEventListener("change", async () => {
      const file = els.narrationBgFile.files?.[0];
      els.narrationBgFile.value = "";
      if (!file) return;
      const demo = getDemo();
      ensureNarration(demo);
      const dataUrl = await fileToDataUrl(file);
      demo.narration.background = { name: file.name, dataUrl };
      syncNarrationPanel();
      onChange();
      toast(t("toast.bgAdded"));
    });
    els.btnNarrationBgClear?.addEventListener("click", () => {
      const demo = getDemo();
      ensureNarration(demo);
      demo.narration.background = null;
      syncNarrationPanel();
      onChange();
      toast(t("toast.bgRemoved"));
    });

    document.getElementById("btn-add-step").addEventListener("click", () => addStep(false));
    document.getElementById("btn-add-slide").addEventListener("click", () => addStep(true));
    document.getElementById("btn-add-scene")?.addEventListener("click", () => openSceneModal("create"));
    document.getElementById("btn-cancel-scene")?.addEventListener("click", () => {
      document.getElementById("modal-scene")?.close();
    });
    document.getElementById("form-scene")?.addEventListener("submit", (e) => {
      e.preventDefault();
      commitSceneModal();
    });
    document.getElementById("btn-dup-step").addEventListener("click", duplicateStep);

    window.addEventListener("keydown", (e) => {
      const editorView = document.getElementById("view-editor");
      if (!editorView || editorView.hidden) return;
      if (editorView.classList.contains("is-presenting")) return;
      if (document.querySelector("dialog[open]")) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateStep();
        return;
      }

      if (mod || e.altKey) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!currentStep()) return;
      e.preventDefault();
      deleteStep();
    });
    document.getElementById("btn-empty-step")?.addEventListener("click", () => addStep(false));
    document.getElementById("btn-empty-slide")?.addEventListener("click", () => addStep(true));
    document.getElementById("btn-empty-images")?.addEventListener("click", () => {
      openImageModal("add");
    });

    function playFromSelected() {
      if (onPlayFrom) onPlayFrom(getSelectedIndex(), { autoplay: false });
    }
    function watchFromSelected() {
      if (onPlayFrom) onPlayFrom(getSelectedIndex(), { autoplay: true });
    }
    function closeSlidePreview() {
      if (!previewDriver) return;
      try {
        previewDriver.destroy();
      } catch {
        /* ignore */
      }
      previewDriver = null;
    }
    document.getElementById("btn-play-from")?.addEventListener("click", playFromSelected);
    document.getElementById("btn-watch-from")?.addEventListener("click", watchFromSelected);
    document.getElementById("canvas-slide-play")?.addEventListener("click", (e) => {
      if (document.getElementById("view-editor")?.classList.contains("is-presenting")) return;
      e.stopPropagation();
      closeSlidePreview();
      playFromSelected();
    });
    document.getElementById("canvas-slide-close")?.addEventListener("click", (e) => {
      if (document.getElementById("view-editor")?.classList.contains("is-presenting")) return;
      e.stopPropagation();
      closeSlidePreview();
    });

    document.getElementById("btn-add-images").addEventListener("click", () => {
      openImageModal("add");
    });

    els.imagesFile.addEventListener("change", async (e) => {
      const files = e.target.files;
      if (!files?.length) return;
      const createSteps = pickMode === "createSteps" || pickMode === "add";
      await ingestImageFiles(files, { createSteps });
      e.target.value = "";
      if (pickMode !== "add") pickMode = "replace";
    });

    document.getElementById("btn-pick-image").addEventListener("click", () => {
      openImageModal("replace");
    });

    document.getElementById("btn-close-image-modal").addEventListener("click", () => {
      els.imageModal.close();
    });

    document.getElementById("btn-upload-in-modal").addEventListener("click", () => {
      els.imagesFile.click();
    });

    els.imageSearch.addEventListener("input", renderImageGrid);

    els.imageGrid.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove-image]");
      if (remove) {
        removeCustomImage(remove.dataset.removeImage);
        return;
      }
      const tile = e.target.closest("[data-ref]");
      if (!tile) return;
      applyImageRef(tile.dataset.ref);
    });

    els.imageModal.addEventListener("click", (e) => {
      if (e.target === els.imageModal) els.imageModal.close();
    });

    els.imageModal.addEventListener("dragover", (e) => {
      const items = e.dataTransfer?.items;
      const hasFile = items ? [...items].some((item) => item.kind === "file") : e.dataTransfer?.files?.length;
      if (!hasFile) return;
      e.preventDefault();
      els.imageModal.classList.add("is-drop");
    });
    els.imageModal.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && els.imageModal.contains(e.relatedTarget)) return;
      els.imageModal.classList.remove("is-drop");
    });
    els.imageModal.addEventListener("drop", async (e) => {
      e.preventDefault();
      els.imageModal.classList.remove("is-drop");
      await ingestDroppedImages(e.dataTransfer);
    });
    els.imageModal.addEventListener("paste", (e) => {
      const files = imageFilesFromTransfer(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      ingestImageFiles(files, {
        createSteps: pickMode === "add" || pickMode === "createSteps",
      });
    });

    document.querySelectorAll("[data-theme-key]").forEach((input) => {
      input.addEventListener("input", () => {
        const demo = getDemo();
        demo.theme = formToTheme(demo.theme);
        applyTheme(demo.theme);
        onChange();
      });
    });

    window.addEventListener("resize", () => {
      const step = currentStep();
      if (!step) return;
      if (step.type === "slide") {
        sizeSlideLikeImage(els.canvasSlide, els.canvasStage, getDemo(), step, resolveImageSrc);
        return;
      }
      placeHotspot(step.hotspot);
      placeClickPoint(ensureClickPoint(step));
    });
  }

  function stopPreview() {
    if (previewDriver) {
      try {
        previewDriver.destroy();
      } catch {
        /* ignore */
      }
      previewDriver = null;
    }
    pauseCaption();
    stopSpeech();
    clickFx.reset();
    els.hotspot.classList.remove("is-previewing");
  }

  function refresh() {
    const demo = getDemo();
    if (demo && renumberScenes(demo)) onChange();
    fillImageSelect();
    renderFilmstrip();
    syncForm();
    renderCanvas();
    if (els.imageModal?.open) renderImageGrid();
  }

  bindFilmstripDnD();
  bindHotspotDrag();
  bindForm();

  return { refresh, selectStep, currentStep, pauseCaption, stopPreview };
}

function getImageContentRect(img) {
  return {
    left: 0,
    top: 0,
    width: img.clientWidth || img.naturalWidth,
    height: img.clientHeight || img.naturalHeight,
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}
