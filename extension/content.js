(() => {
  const VERSION = 2;
  if (globalThis.__guiaCaptureInstalled === VERSION) return;
  document.querySelectorAll("[data-guia-capture]").forEach((el) => el.remove());
  globalThis.__guiaCaptureInstalled = VERSION;

  let active = false;
  let awaitingHotspot = false;

  const host = document.createElement("div");
  host.setAttribute("data-guia-capture", "");
  host.style.cssText = [
    "all: initial",
    "position: fixed",
    "right: 16px",
    "bottom: 16px",
    "z-index: 2147483647",
    "display: block",
    "width: max-content",
    "max-width: calc(100vw - 32px)",
    "height: auto",
    "margin: 0",
    "padding: 0",
    "border: 0",
    "background: transparent",
  ].join(" !important; ") + " !important;";

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .bar {
      all: initial;
      font: 13px/1.4 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #1a1a1a;
      color-scheme: light;
      background: #f4f4f5;
      border: 1px solid #e4e4e7;
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(15, 50, 72, 0.18);
      padding: 12px;
      display: grid;
      gap: 8px;
      width: 300px;
      max-width: calc(100vw - 32px);
      box-sizing: border-box;
      pointer-events: auto;
    }
    .row { display: flex; align-items: center; gap: 8px; }
    .mark { width: 22px; height: 22px; flex: none; display: block; }
    .titles { display: flex; flex-direction: column; min-width: 0; }
    strong { font-size: 14px; line-height: 1.2; font-weight: 700; }
    .count { color: #2a9d8f; font-weight: 700; font-size: 12px; line-height: 1.2; }
    .hint, .status { margin: 0; color: #3f3f46; font-size: 12px; }
    .status:empty { display: none; }
    .status.is-error { color: #dc2626; }
    .actions { display: grid; gap: 6px; }
    button {
      font: inherit;
      font-weight: 600;
      border-radius: 7px;
      border: 1px solid #e4e4e7;
      background: #fff;
      color: #1a1a1a;
      padding: 8px 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      text-align: left;
    }
    button .ico { width: 16px; height: 16px; flex: none; }
    button.primary { background: #1a4d6d; border-color: transparent; color: #fff; }
    button.primary:hover { background: #1f6b62; }
    button.strong { background: #fff; border-color: #b7c9d4; color: #1a4d6d; }
    button.strong:hover { border-color: #1a4d6d; background: #f3f8fb; }
    button.ghost { background: transparent; border-color: transparent; color: #3f3f46; }
    button.ghost:hover { background: #fff; }
    button:disabled { opacity: 0.4; cursor: default; }
    button:disabled:hover { background: inherit; border-color: inherit; }
    button.primary:disabled:hover { background: #1a4d6d; }
    .danger-slot { margin-top: 2px; padding-top: 8px; border-top: 1px solid #e4e4e7; }
    button.danger {
      width: 100%;
      justify-content: center;
      color: #dc2626;
      background: transparent;
      border-color: transparent;
      font-weight: 700;
    }
    button.danger:hover { background: #fef2f2; }
    button:focus-visible { outline: 2px solid #2a9d8f; outline-offset: 2px; }
  `;

  const ICONS = {
    capture:
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 5.4h2.1l1-1.6h5.4l1 1.6h2.1c.5 0 .9.4.9.9v6c0 .5-.4.9-.9.9H2.2a.9.9 0 0 1-.9-.9v-6c0-.5.4-.9.9-.9z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8.7" r="1.9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    create:
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    append:
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="6" y="6" width="8" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10 6V3.4A1.4 1.4 0 0 0 8.6 2H3.4A1.4 1.4 0 0 0 2 3.4v5.2A1.4 1.4 0 0 0 3.4 10H6" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    undo:
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 4.2 3.2 7.2l3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.6 7.2h6.1a3.1 3.1 0 0 1 0 6.2H8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    cancel:
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  const bar = document.createElement("div");
  bar.className = "bar";

  const row = document.createElement("div");
  row.className = "row";
  const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  mark.setAttribute("class", "mark");
  mark.setAttribute("viewBox", "19.99 1.49 530.34 530.34");
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML =
    '<defs><mask id="guia-bm" maskUnits="userSpaceOnUse" x="-200" y="-200" width="1200" height="1200"><rect x="-200" y="-200" width="1200" height="1200" fill="#fff"/><path d="M363.00 270.00 L521.73 314.86 L460.31 331.42 L529.32 400.44 L493.44 436.32 L424.42 367.31 L407.86 428.73 Z" fill="#000" stroke="#000" stroke-width="41" stroke-linejoin="round"/></mask></defs>' +
    '<path d="M272.07 140.67 A136 136 0 1 0 336.00 256.00 L212.00 256" fill="none" stroke="#2A9D8F" stroke-width="58" stroke-linecap="round" stroke-linejoin="round" mask="url(#guia-bm)"/>' +
    '<path d="M363.00 270.00 L521.73 314.86 L460.31 331.42 L529.32 400.44 L493.44 436.32 L424.42 367.31 L407.86 428.73 Z" fill="#2A9D8F" stroke="#2A9D8F" stroke-width="13" stroke-linejoin="round"/>';
  const titles = document.createElement("div");
  titles.className = "titles";
  const title = document.createElement("strong");
  title.textContent = "Captura";
  const uiFallback = {
    title: "Captura",
    capture: "Capturar",
    create: "Criar projeto",
    append: "Copiar para o projeto",
    undo: "Desfazer",
    cancel: "Cancelar",
    stepOne: "1 passo",
    stepsN: "{n} passos",
    hint: "Capturar congela esta tela. O clique seguinte marca o destaque.",
    hintHotspot: "Clique no elemento do destaque. Esse clique não tira outra foto.",
    lostApp: "A captura perdeu a conexão com o app.",
    lostExt: "A captura perdeu a conexão. Abra de novo o ícone da extensão.",
  };
  let ui = uiFallback;
  const countEl = document.createElement("span");
  countEl.className = "count";
  countEl.textContent = "0 passos";
  titles.append(title, countEl);
  row.append(mark, titles);

  const hintEl = document.createElement("p");
  hintEl.className = "hint";
  const statusEl = document.createElement("p");
  statusEl.className = "status";

  const actions = document.createElement("div");
  actions.className = "actions";
  const specs = [
    ["capture", "capture", "primary"],
    ["create", "create", "strong"],
    ["append", "append", "ghost"],
    ["undo", "undo", "ghost"],
  ];
  for (const spec of specs) {
    actions.append(makeButton(spec[0], spec[1], spec[2]));
  }
  const dangerSlot = document.createElement("div");
  dangerSlot.className = "danger-slot";
  dangerSlot.append(makeButton("cancel", "cancel", "danger"));
  actions.append(dangerSlot);

  function makeButton(action, label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.dataset.label = label;
    button.className = className;
    button.innerHTML = ICONS[action];
    const span = document.createElement("span");
    span.textContent = ui[label];
    button.append(span);
    return button;
  }

  bar.append(row, hintEl, actions, statusEl);
  shadow.append(style, bar);

  function mounted() {
    return host.isConnected;
  }

  function mount() {
    if (!mounted()) document.documentElement.append(host);
    showBar();
  }

  function unmount() {
    host.remove();
  }

  function hideForShot() {
    host.style.setProperty("visibility", "hidden", "important");
    host.style.setProperty("opacity", "0", "important");
  }

  function showBar() {
    host.style.setProperty("visibility", "visible", "important");
    host.style.setProperty("opacity", "1", "important");
  }

  function applyState(state) {
    if (!state?.active || state.show === false) {
      active = false;
      awaitingHotspot = false;
      unmount();
      return;
    }
    active = true;
    awaitingHotspot = Boolean(state.awaitingHotspot);
    mount();
    ui = { ...uiFallback, ...(state.ui || {}) };
    title.textContent = ui.title;
    for (const button of actions.querySelectorAll("button")) {
      const span = button.querySelector("span");
      if (span) span.textContent = ui[button.dataset.label] || span.textContent;
    }
    const count = state.count || 0;
    countEl.textContent = count === 1 ? ui.stepOne : String(ui.stepsN).replace("{n}", String(count));
    for (const name of ["create", "append", "undo"]) {
      const button = actions.querySelector(`[data-action="${name}"]`);
      if (button) button.disabled = count === 0;
    }
    hintEl.textContent = awaitingHotspot ? ui.hintHotspot : ui.hint;
    statusEl.textContent = state.error || state.status || "";
    statusEl.classList.toggle("is-error", Boolean(state.error));
  }

  function send(message) {
    if (globalThis.guiaDesktop?.send) {
      Promise.resolve(globalThis.guiaDesktop.send(message))
        .then((state) => {
          if (state?.ignore) return;
          applyState(state);
        })
        .catch(() => {
          showBar();
          statusEl.textContent = ui.lostApp;
          statusEl.classList.add("is-error");
        });
      return;
    }
    chrome.runtime.sendMessage(message, (state) => {
      if (chrome.runtime.lastError) {
        showBar();
        statusEl.textContent = ui.lostExt;
        statusEl.classList.add("is-error");
        return;
      }
      if (state?.ignore) return;
      applyState(state);
    });
  }

  bar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.action;
    if (action === "capture") {
      // hazard: the bar is painted in the tab, so it must be hidden before the screenshot
      hideForShot();
      send({ type: "CAPTURE_FROM_PAGE", title: document.title, url: location.href });
    }
    if (action === "create") send({ type: "CREATE_PROJECT" });
    if (action === "append") send({ type: "APPEND_TO_PROJECT" });
    if (action === "undo") send({ type: "UNDO" });
    if (action === "cancel") send({ type: "CANCEL" });
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!active || event.button !== 0) return;
      if (event.composedPath().includes(host)) return;
      const payload = {
        type: "PAGE_CLICK",
        x: event.clientX,
        y: event.clientY,
        vw: window.innerWidth,
        vh: window.innerHeight,
        title: document.title,
        url: location.href,
      };
      if (awaitingHotspot) {
        send(payload);
        return;
      }
      hideForShot();
      requestAnimationFrame(() => send(payload));
    },
    true
  );

  if (globalThis.guiaDesktop?.onState) {
    globalThis.guiaDesktop.onState((state) => applyState(state));
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "HIDE_OVERLAY") {
        hideForShot();
        requestAnimationFrame(() => requestAnimationFrame(() => sendResponse({ ok: true })));
        return true;
      }
      if (msg?.type === "STATE") applyState(msg);
      return false;
    });
  }

  send({ type: "STATUS" });
})();
