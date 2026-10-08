/** Barrinha de tempo até o próximo passo no preview automático. */
export function createPresentProgress() {
  let anim = null;

  function root() {
    return document.getElementById("present-progress");
  }

  function fill() {
    return document.getElementById("present-progress-fill");
  }

  function hide() {
    anim?.cancel?.();
    anim = null;
    const el = root();
    const bar = fill();
    if (el) el.hidden = true;
    if (bar) {
      bar.style.transform = "scaleX(0)";
      bar.getAnimations?.().forEach((a) => a.cancel());
    }
  }

  function start(durationMs) {
    const el = root();
    const bar = fill();
    const ms = Math.max(0, Number(durationMs) || 0);
    if (!el || !bar || ms <= 0) {
      hide();
      return;
    }
    anim?.cancel?.();
    bar.getAnimations?.().forEach((a) => a.cancel());
    el.hidden = false;
    bar.style.transform = "scaleX(0)";
    void bar.offsetWidth;
    anim = bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      duration: ms,
      easing: "linear",
      fill: "forwards",
    });
  }

  return { start, hide };
}
