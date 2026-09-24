/**
 * Animação compartilhada: cursor + ripple + press no destaque
 */

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{
 *   frame: HTMLElement,
 *   hotspot: HTMLElement,
 *   cursor: HTMLElement,
 *   clickFx: HTMLElement,
 * }} els
 */
export function createClickFxController(els) {
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

  /**
   * @param {{ x: number, y: number }} target coords relative to frame
   * @param {{ pressHotspot?: boolean }} [opts]
   */
  async function animateTo(target, opts = {}) {
    const pressHotspot = opts.pressHotspot !== false;
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
    // mantém ripple um pouco; limpa no fim
    reset();
  }

  return { reset, animateTo, playRippleAt };
}
