/**
 * HTML da página /v/:id com meta tags para crawlers (WhatsApp, Slack, etc.).
 */
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderViewPage({ id, name, origin, missing }) {
  const base = String(origin || "").replace(/\/$/, "");
  const title = missing
    ? "GuiaFlow"
    : name
      ? `${name} — GuiaFlow`
      : "GuiaFlow — Tour";
  const description = missing
    ? "Este link não está mais disponível."
    : name
      ? `Tour interativo: ${name}`
      : "Tour interativo no GuiaFlow";
  const canonical = id ? `${base}/v/${id}` : `${base}/`;
  const image = `${base}/og-share.png`;
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeName = escapeHtml(name || "");
  const safeId = escapeHtml(id || "");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <meta name="theme-color" content="#1A4D6D" />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="GuiaFlow" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <script>
    (function () {
      try {
        var stored = localStorage.getItem("ns-locale");
        var langs = navigator.languages || (navigator.language ? [navigator.language] : []);
        var pick = stored;
        if (!pick) {
          for (var i = 0; i < langs.length; i++) {
            var p = String(langs[i] || "").toLowerCase().split("-")[0];
            if (p === "pt" || p === "es" || p === "en") { pick = p; break; }
          }
        }
        if (pick !== "pt" && pick !== "es" && pick !== "en") pick = "en";
        document.documentElement.lang = pick === "pt" ? "pt-BR" : pick;
      } catch (e) {}
    })();
  </script>
  <script>
    (function () {
      try {
        var pref = localStorage.getItem("ns-appearance") || "system";
        var mode = pref;
        if (pref !== "documento" && pref !== "social") {
          mode = window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "social"
            : "documento";
        }
        document.documentElement.setAttribute("data-appearance", mode);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = mode === "social" ? "#101010" : "#1A4D6D";
      } catch (e) {}
    })();
  </script>
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" href="/favicon-16.png" type="image/png" sizes="16x16" />
  <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="stylesheet" href="/a/21/vendor/driver/driver.css" />
  <link rel="stylesheet" href="/a/21/css/theme.css" />
  <link rel="stylesheet" href="/a/21/css/app.css" />
  <script>window.__GF_SHARE = ${JSON.stringify({ id: id || null, name: name || null, missing: Boolean(missing) })};</script>
</head>
<body class="view-share">
  <header class="topbar">
    <div class="topbar-brand">
      <a class="logo" href="/">Guia<span>Flow</span></a>
      <span class="topbar-title" id="topbar-title">${missing ? escapeHtml("Este link não está mais disponível.") : safeName || "Carregando o tour…"}</span>
    </div>
  </header>

  <main id="view-editor" class="view view-editor is-presenting">
    <section class="canvas-wrap">
      <p class="present-hint" id="present-chrome" data-i18n="view.escHint">Clique fora ou Esc para recomeçar</p>
      <div class="canvas-stage" id="canvas-stage">
        <div class="view-share-status" id="view-share-status"${missing ? "" : ""}>
          <p id="view-share-status-text">${missing ? escapeHtml("Este link não está mais disponível.") : "Carregando o tour…"}</p>
        </div>
        <div class="canvas-frame" id="canvas-frame" hidden>
          <img id="canvas-image" alt="" hidden />
          <div class="image-missing" id="canvas-missing" hidden data-i18n="canvas.missing">Tela sem imagem</div>
          <div class="slide-card" id="canvas-slide" hidden>
            <button type="button" class="slide-card-close" id="canvas-slide-close" aria-label="Fechar" data-i18n-aria="canvas.close">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
            <p class="slide-kicker" id="canvas-slide-kicker"></p>
            <h2 id="canvas-slide-title"></h2>
            <p id="canvas-slide-body"></p>
            <button type="button" class="slide-card-play" id="canvas-slide-play" aria-label="Reproduzir" data-i18n-aria="canvas.play">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
            </button>
          </div>
          <div class="hotspot" id="hotspot" hidden>
            <span class="hotspot-label" data-i18n="canvas.hotspot">destaque</span>
          </div>
          <div class="click-point" id="click-point" hidden>
            <span class="click-point-ring"></span>
            <span class="click-point-dot"></span>
            <span class="click-point-label">click</span>
          </div>
          <div class="click-fx" id="editor-click-fx" hidden aria-hidden="true">
            <span class="click-fx-ring"></span>
            <span class="click-fx-ring click-fx-ring-2"></span>
            <span class="click-fx-burst"></span>
          </div>
          <div class="sim-cursor" id="editor-sim-cursor" hidden></div>
          <div class="caption-bar" id="canvas-caption" hidden></div>
        </div>
      </div>
    </section>
  </main>

  <div class="toast" id="toast" hidden></div>

  <script src="/a/21/vendor/driver/driver.js.iife.js"></script>
  <script type="module" src="/a/21/js/viewApp.js"></script>
</body>
</html>
`;
}

module.exports = { renderViewPage, escapeHtml };
