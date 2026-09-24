(() => {
  if (globalThis.__guiaBridgeInstalled) return;
  globalThis.__guiaBridgeInstalled = true;

  const SOURCE = "guia-capture";
  const EDITOR = "guia-editor";
  let delivered = false;
  let posted = false;
  let pending = null;

  function editorReady() {
    return document.documentElement?.dataset.guiaReady === "1";
  }

  function askHandoff() {
    chrome.runtime.sendMessage({ type: "HANDOFF_GET" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (!response?.handoff?.payload) return;
      tryDeliver(response.handoff.payload);
    });
  }

  // invariant: postMessage only after the editor sets data-guia-ready, otherwise the listener is not bound yet and delivering stays stuck
  function tryDeliver(payload) {
    if (delivered || posted) return;
    if (payload) pending = payload;
    if (!pending || !Array.isArray(pending.steps) || !editorReady()) return;
    posted = true;
    window.postMessage(
      {
        source: SOURCE,
        type: "import-project",
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
        projectId: data.projectId || null,
        error: data.error || null,
      });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "HANDOFF_PUSH" && msg.payload) {
      tryDeliver(msg.payload);
    }
  });

  askHandoff();
})();
