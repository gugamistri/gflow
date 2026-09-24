(() => {
  if (globalThis.__guiaCaptureInstalled) return;
  globalThis.__guiaCaptureInstalled = true;

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
  ].join(" !important; ") + " !important;";

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .bar {
      font: 13px/1.35 Inter, system-ui, sans-serif;
      color: #1a1a1a;
      background: #fff;
      border: 1px solid #d6e8f0;
      border-radius: 4px;
      box-shadow: 0 10px 30px rgba(15, 50, 72, 0.18);
      padding: 10px 12px;
      display: grid;
      gap: 8px;
      width: 280px;
    }
    .row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    strong { font-size: 13px; }
    .count { color: #1a4d6d; font-weight: 700; }
    .hint, .status { margin: 0; color: #3f3f46; }
    .status { min-height: 1.35em; }
    .status.is-error { color: #dc2626; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    button {
      font: inherit;
      border-radius: 4px;
      border: 1px solid #e4e4e7;
      background: #fff;
      padding: 6px 10px;
      cursor: pointer;
    }
    button.primary { background: #1a4d6d; border-color: #1a4d6d; color: #fff; }
    button.danger { color: #dc2626; }
  `;

  const bar = document.createElement("div");
  bar.className = "bar";

  const row = document.createElement("div");
  row.className = "row";
  const title = document.createElement("strong");
  title.textContent = "Captura do guia";
  const uiFallback = {
    title: "Captura do guia",
    capture: "Capturar",
    create: "Criar projeto",
    undo: "Desfazer",
    download: "Baixar JSON",
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
  row.append(title, countEl);

  const hintEl = document.createElement("p");
  hintEl.className = "hint";
  const statusEl = document.createElement("p");
  statusEl.className = "status";

  const actions = document.createElement("div");
  actions.className = "actions";
  for (const spec of [
    ["capture", "capture", "primary"],
    ["create", "create", "primary"],
    ["undo", "undo", ""],
    ["download", "download", ""],
    ["cancel", "cancel", "danger"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = spec[0];
    button.dataset.label = spec[1];
    button.textContent = ui[spec[1]];
    if (spec[2]) button.className = spec[2];
    actions.append(button);
  }

  bar.append(row, hintEl, actions, statusEl);
  shadow.append(style, bar);

  function mounted() {
    return host.isConnected;
  }

  function mount() {
    if (!mounted()) document.documentElement.append(host);
    host.style.setProperty("visibility", "visible", "important");
  }

  function unmount() {
    host.remove();
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
      button.textContent = ui[button.dataset.label] || button.textContent;
    }
    const count = state.count || 0;
    countEl.textContent = count === 1 ? ui.stepOne : String(ui.stepsN).replace("{n}", String(count));
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
          host.style.setProperty("visibility", "visible", "important");
          statusEl.textContent = ui.lostApp;
          statusEl.classList.add("is-error");
        });
      return;
    }
    chrome.runtime.sendMessage(message, (state) => {
      if (chrome.runtime.lastError) {
        host.style.setProperty("visibility", "visible", "important");
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
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.action;
    if (action === "capture") {
      send({ type: "CAPTURE_FROM_PAGE", title: document.title, url: location.href });
    }
    if (action === "create") send({ type: "CREATE_PROJECT" });
    if (action === "download") send({ type: "DOWNLOAD_JSON" });
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
      // hazard: the toolbar is painted in the tab, so it must be hidden before the screenshot or it shows up in every step
      host.style.setProperty("visibility", "hidden", "important");
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
        host.style.setProperty("visibility", "hidden", "important");
        requestAnimationFrame(() => requestAnimationFrame(() => sendResponse({ ok: true })));
        return true;
      }
      if (msg?.type === "STATE") applyState(msg);
      return false;
    });
  }

  send({ type: "STATUS" });
})();
