/**
 * GET /api/analytics-config — config pública do PostHog para o editor (guiaflow.pro/editor).
 * why: o site é estático; a chave pública phc_ fica no ambiente da Vercel e não no código.
 * Sem POSTHOG_KEY/POSTHOG_HOST responde { posthog: null } e o editor não inicializa nada.
 */
const { readPosthogEnv } = require("./lib/posthog-env.cjs");

module.exports = function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("method_not_allowed");
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(JSON.stringify({ posthog: readPosthogEnv(process.env) }));
};
