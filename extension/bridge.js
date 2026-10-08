(() => {
  const BRIDGE_VERSION = 2;
  if (globalThis.__guiaBridgeInstalled === BRIDGE_VERSION) return;
  globalThis.__guiaBridgeInstalled = BRIDGE_VERSION;

  const deliver = globalThis.__guiaHandoffDeliver;
  if (!deliver) return;

  const { initialHandoffState, reduceHandoff } = deliver;
  let state = initialHandoffState();

  function editorReady() {
    return document.documentElement?.dataset.guiaReady === "1";
  }

  function publish(result) {
    state = result.state;
    if (result.post) {
      const message = {
        source: "guia-capture",
        type: result.post.type,
        id: result.post.id,
        payload: result.post.payload,
      };
      window.postMessage(message, location.origin);
      document.dispatchEvent(new CustomEvent("guia-capture-handoff", { detail: message }));
      chrome.runtime.sendMessage({ type: "HANDOFF_RELAY", message });
    }
    if (result.ack) {
      chrome.runtime.sendMessage({
        type: "HANDOFF_ACK",
        id: result.ack.id,
        ok: Boolean(result.ack.ok),
        mode: result.ack.mode,
        projectId: result.ack.projectId || null,
        error: result.ack.error || null,
      });
    }
  }

  function apply(event) {
    publish(reduceHandoff(state, event));
  }

  function ingest(payload, mode, id) {
    apply({
      type: "handoff",
      payload,
      mode,
      id: id != null ? id : payload?.handoffId,
    });
  }

  function askHandoff() {
    chrome.runtime.sendMessage({ type: "HANDOFF_GET" }, (response) => {
      if (chrome.runtime.lastError) return;
      const handoff = response?.handoff;
      if (!handoff?.payload) return;
      ingest(handoff.payload, handoff.mode, handoff.id != null ? handoff.id : handoff.createdAt);
    });
  }

  // guia-ready nasce na página. No mundo isolado a janela da página é outra, então a origem e o source da mensagem bastam.
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.source === "guia-editor" && data.type === "guia-ready") {
      apply({ type: "editor-ready" });
      askHandoff();
      return;
    }

    if (data.source === "guia-capture" && data.type === "import-ack") {
      apply({
        type: "ack",
        id: data.id,
        ok: data.ok,
        mode: data.mode,
        projectId: data.projectId,
        error: data.error,
      });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "HANDOFF_PUSH" && msg.payload) {
      ingest(msg.payload, msg.mode, msg.id);
    }
  });

  function retryIfVisible() {
    if (document.visibilityState === "hidden") return;
    if (editorReady()) apply({ type: "editor-ready" });
    apply({ type: "retry" });
    askHandoff();
  }

  document.addEventListener("visibilitychange", retryIfVisible);
  window.addEventListener("focus", retryIfVisible);

  if (editorReady()) apply({ type: "editor-ready" });
  askHandoff();
})();
