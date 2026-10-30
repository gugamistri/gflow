/**
 * Galeria no app (prévia do editor, /p, /v e embed): liga o núcleo (js/gallery.js) ao tour, ao analytics,
 * ao botão fixo do WhatsApp e à fachada de vídeo. O player guiado (player.js) delega para cá quando
 * `playback.mode === "gallery"`.
 */
import { t } from "./i18n.js";
import { createGallery } from "./gallery.js";
import { renderRichText, stripRichText } from "./tour-schema/richText.js";
import { resolveImageSrc } from "./store.js";
import { stepImageAlt } from "./a11y.js";
import { createVideoStage } from "./videoStage.js";
import { stepVideo, videoWatchUrl, videoProviderLabel } from "./tour-schema/video.js";
import { createStickyCta } from "./stickyCta.js";
import { stickyWhatsAppAction } from "./fixedSteps.js";

export const GALLERY_VIDEO_ID = "gf-gallery-video";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

/** Id do passo seguro para o analytics (mesma regra do player guiado). */
function safeStepId(step) {
  return typeof step?.id === "string" && /^[\w:.-]{1,80}$/.test(step.id) ? step.id : null;
}

/**
 * ctx: getDemo, setSelectedIndex, onRequestExit({ reason }), onVideoPlay, onVideoProgress, stickyCtaVars, onStickyCta.
 * lifecycle: createTourLifecycle (o mesmo do player guiado, para onStep/onComplete/onExit).
 */
export function createGalleryPlayer(ctx, lifecycle) {
  let running = false;
  let demo = null;
  const sticky = createStickyCta({ onAction: (action) => ctx.onStickyCta?.(action) });
  let videoStage = null;

  const gallery = createGallery({
    doc: document,
    t,
    richText: { render: (el, text) => renderRichText(el, text, document), strip: stripRichText },
    imageSrc: (step, d) => (step?.image ? resolveImageSrc(d, step.image) : ""),
    altOf: (step) => stepImageAlt(step),
    videoOf: (step) => stepVideo(step),
    mountVideo: (host, step, index) => {
      // why: a fachada do vídeo (#170) precisa do nó da foto atual; uma por slide, desmontada ao trocar
      videoStage?.destroy();
      videoStage = createVideoStage({
        id: GALLERY_VIDEO_ID,
        frame: host,
        onPlay: (info) => ctx.onVideoPlay?.(info),
        onProgress: (info) => ctx.onVideoProgress?.(info),
      });
      if (!videoStage.show(step, { index, interactive: true })) return null;
      const stage = videoStage;
      return {
        teardown: () => {
          stage.destroy();
          if (videoStage === stage) videoStage = null;
        },
      };
    },
    videoLink: (step) => {
      const v = stepVideo(step);
      return v ? { href: videoWatchUrl(v), label: t("video.openOn", { provider: videoProviderLabel(v.kind) }) } : null;
    },
    renderCta: (slot, index) => {
      const vars = ctx.stickyCtaVars?.() || { tour: String(demo?.name || "").trim() };
      sticky.update(stickyWhatsAppAction(demo, index, vars));
      const node = sticky.element();
      // why: na Galeria o botão fica na faixa da legenda (nunca cobre a foto nem a legenda)
      if (node && node.parentElement !== slot) slot.append(node);
    },
    onChange: (index) => {
      ctx.setSelectedIndex?.(index);
      const step = demo?.steps?.[index];
      lifecycle.step({ index, stepId: safeStepId(step), position: index, total: demo?.steps?.length || 0 });
    },
    onFinish: () => {
      running = false;
      sticky.hide();
      lifecycle.complete();
      ctx.onRequestExit?.({ reason: "complete" });
    },
    onClose: (reason) => {
      running = false;
      sticky.hide();
      lifecycle.exit(reason);
      ctx.onRequestExit?.({ reason });
    },
    reducedMotion: prefersReducedMotion,
    focus: ctx.focusOnOpen !== false,
  });

  return {
    play({ from = 0 } = {}) {
      demo = ctx.getDemo?.();
      if (!demo?.steps?.length) return false;
      if (gallery.isOpen()) gallery.teardown();
      lifecycle.start();
      running = gallery.open(demo, { from });
      return running;
    },
    stop() {
      if (!running && !gallery.isOpen()) return;
      running = false;
      sticky.hide();
      gallery.teardown();
    },
    exit(reason) {
      if (!gallery.isOpen()) return false;
      gallery.close(reason);
      return true;
    },
    closeLayer: () => gallery.closeLayer(),
    isRunning: () => running && gallery.isOpen(),
    isOpen: () => gallery.isOpen(),
    owns: (target) => Boolean(gallery.root && target && gallery.root.contains(target)),
    index: () => gallery.index(),
    get root() {
      return gallery.root;
    },
  };
}
