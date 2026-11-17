/**
 * PostHog no editor (guiaflow.pro/editor): $pageview/$pageleave, identify só com o
 * user_id interno e grupo «workspace» (plan, is_demo). Sem autocapture, replay, pesquisas, flags nem script externo.
 *
 * - A config vem de GET /api/analytics-config (env da Vercel). Sem config válida → nada carrega.
 * - DNT/GPC → nada carrega.
 * - before_send: só os eventos liberados e propriedades sem PII (sanitizeProperties).
 * - before_send: todo evento leva $geoip_disable (sem país, cidade nem coordenadas), como o player /p.
 * - identify nunca leva e-mail ou nome (nem como distinct_id, nem em $set).
 */
import { editorInitOptions, looksLikePii, POSTHOG_CONFIG_PATH, POSTHOG_PRODUCT, readPosthogConfig, sanitizeProperties } from "./posthogConfig.js";
import { privacySignal } from "./viewAnalytics.js";

/** O SDK do editor só manda estes. Eventos de produto (funil) ficam no player e na nuvem. */
export const EDITOR_SDK_EVENTS = Object.freeze(["$pageview", "$pageleave", "$identify", "$groupidentify"]);

export const WORKSPACE_GROUP = "workspace";

/** before_send: descarta evento fora da lista e limpa propriedades, $set e $set_once. */
export function editorBeforeSend(event) {
  if (!event || typeof event !== "object") return null;
  if (!EDITOR_SDK_EVENTS.includes(event.event)) return null;
  const out = { ...event, properties: sanitizeProperties(event.properties) };
  if (out.properties.product !== POSTHOG_PRODUCT) out.properties.product = POSTHOG_PRODUCT;
  // why: sem localização aproximada (país/coordenadas) a partir do IP, igual ao player /p
  out.properties.$geoip_disable = true;
  if (event.$set) out.$set = sanitizeProperties(event.$set);
  if (event.$set_once) out.$set_once = sanitizeProperties(event.$set_once);
  if (looksLikePii(String(out.properties.distinct_id || ""))) return null;
  return out;
}

/** { userId, workspaceId, plan, isDemo } a partir do /auth/me (ids opacos); null sem conta. */
export function analyticsAccountFromMe(data) {
  const src = data && typeof data === "object" ? data : {};
  const a = src.analytics && typeof src.analytics === "object" ? src.analytics : {};
  const userId = String(a.userId || src.user?.id || "").trim();
  if (!userId || looksLikePii(userId) || userId.includes("@")) return null;
  const workspaceRaw = String(a.workspaceId || userId).trim();
  const workspaceId = workspaceRaw && !workspaceRaw.includes("@") ? workspaceRaw : userId;
  const planRaw = String(src.entitlements?.plan || src.user?.plan || "none");
  const plan = /^(pro|team|none)$/.test(planRaw) ? planRaw : "none";
  return { userId, workspaceId, plan, isDemo: a.isDemo === true };
}

async function defaultFetchConfig() {
  const res = await fetch(POSTHOG_CONFIG_PATH, { headers: { Accept: "application/json" }, credentials: "omit" });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.posthog || null;
}

function defaultLoadSdk() {
  return import("../vendor/posthog/module.no-external.js");
}

/**
 * opts: { fetchConfig, loadSdk, privacy: { dnt, windowDnt, msDnt, gpc } }
 * → { ready: Promise<boolean>, identify(account), reset() }. Nunca lança.
 */
export function createEditorPosthog(opts = {}) {
  const fetchConfig = opts.fetchConfig || defaultFetchConfig;
  const loadSdk = opts.loadSdk || defaultLoadSdk;
  let ph = null;
  let pending = null;
  let identified = "";

  function applyIdentify(account) {
    if (!ph || !account) return;
    if (identified === account.userId) return;
    identified = account.userId;
    // why: só o id interno; nada de e-mail, nome ou $set de pessoa
    ph.identify(account.userId);
    ph.group(WORKSPACE_GROUP, account.workspaceId, { plan: account.plan, is_demo: account.isDemo });
  }

  const ready = (async () => {
    if (privacySignal(opts.privacy || {})) return false;
    let config = null;
    try {
      config = readPosthogConfig(await fetchConfig());
    } catch {
      config = null;
    }
    if (!config) return false;
    try {
      const mod = await loadSdk();
      const sdk = mod?.default || mod?.posthog || mod;
      if (!sdk || typeof sdk.init !== "function") return false;
      sdk.init(config.key, editorInitOptions(config, { beforeSend: editorBeforeSend }));
      sdk.register({ product: POSTHOG_PRODUCT });
      ph = sdk;
      if (pending) applyIdentify(pending);
      pending = null;
      return true;
    } catch {
      ph = null;
      return false;
    }
  })();

  return {
    ready,
    identify(raw) {
      const account = raw && raw.userId ? raw : null;
      if (!account || looksLikePii(account.userId) || String(account.userId).includes("@")) return;
      if (ph) applyIdentify(account);
      else pending = account;
    },
    reset() {
      pending = null;
      if (!ph || !identified) return;
      identified = "";
      ph.reset();
    },
  };
}
