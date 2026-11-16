/**
 * Config pública do PostHog a partir do ambiente da Vercel (POSTHOG_KEY / POSTHOG_HOST).
 * Mesma regra de js/posthogConfig.js readPosthogConfig: sem os dois válidos → null (nada inicializa).
 */
const KEY_RE = /^phc_[A-Za-z0-9_-]{10,}$/;

function readPosthogEnv(env = process.env) {
  const key = String(env.POSTHOG_KEY || "").trim();
  const hostRaw = String(env.POSTHOG_HOST || "").trim().replace(/\/+$/, "");
  if (!KEY_RE.test(key) || !hostRaw || /replace|changeme|example/i.test(key)) return null;
  try {
    const url = new URL(hostRaw);
    if (url.protocol !== "https:" || url.search || url.hash || (url.pathname && url.pathname !== "/")) return null;
    return { key, host: url.origin };
  } catch {
    return null;
  }
}

module.exports = { readPosthogEnv };
