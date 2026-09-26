(() => {
  if (globalThis.__guiaBridgeInstalled) return;
  globalThis.__guiaBridgeInstalled = true;

  const SOURCE = "guia-capture";
  const EDITOR = "guia-editor";
  let delivered = false;
  let posted = false;
  let pending = null;
  let pendingMode = "create";

  function editorReady() {
    return document.documentElement?.dataset.guiaReady === "1";
  }

  function askHandoff() {
    chrome.runtime.sendMessage({ type: "HANDOFF_GET" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (!response?.handoff?.payload) return;
      tryDeliver(response.handoff.payload, response.handoff.mode);
    });
  }

  // invariant: postMessage only after the editor sets data-guia-ready, otherwise the listener is not bound yet and delivering stays stuck
  function tryDeliver(payload, mode) {
    if (delivered || posted) return;
    if (payload) {
      pending = payload;
      pendingMode = mode === "append" ? "append" : "create";
    }
    if (!pending || !Array.isArray(pending.steps) || !editorReady()) return;
    posted = true;
    const type = pendingMode === "append" ? "append-steps" : "import-project";
    window.postMessage(
      {
        source: SOURCE,
        type,
        payload: pending,
      },
      location.origin
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.source === EDITOR && data.type === "guia-ready") {
      askHandoff();
      return;
    }

    if (data.source === SOURCE && data.type === "import-ack") {
      delivered = true;
      chrome.runtime.sendMessage({
        type: "HANDOFF_ACK",
        ok: Boolean(data.ok),
        mode: data.mode || pendingMode,
        projectId: data.projectId || null,
        error: data.error || null,
      });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "HANDOFF_PUSH" && msg.payload) {
      tryDeliver(msg.payload, msg.mode);
    }
  });

  askHandoff();
})();
