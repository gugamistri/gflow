/**
 * Stubs do GuiaFlow Cloud.
 * why: o editor MIT precisa das flags sem chamar a API paga nem guardar segredo.
 * hazard: BYOK continua em llm.js / cartesia.js; não colocar chave, token ou fetch aqui.
 */

export const CLOUD_FLAG_KEYS = Object.freeze([
  "hostedAi",
  "tts",
  "permanentShare",
  "branding",
  "analytics",
]);

export const CLOUD_GLOBAL_KEY = "__GUIAFLOW_CLOUD__";
export const CLOUD_META_NAME = "guiaflow-cloud-base";
export const CLOUD_STORAGE_KEY = "guiaflow.cloud.baseUrl";

const INJECTED_KEYS = ["baseUrl", "globalValue", "metaContent", "storageValue", "flags"];

export function emptyCloudFlags() {
  return {
    hostedAi: false,
    tts: false,
    permanentShare: false,
    branding: false,
    analytics: false,
  };
}

/**
 * Aceita só http(s). Descarta userinfo, query e hash.
 * hazard: o URL base não é lugar de segredo.
 */
export function normalizeCloudBaseUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parseSource(source) {
  if (typeof source === "string") {
    return { baseUrl: normalizeCloudBaseUrl(source), flags: null };
  }
  if (!source || typeof source !== "object") {
    return { baseUrl: "", flags: null };
  }
  const rawUrl = source.baseUrl ?? source.url ?? "";
  const flags = source.flags && typeof source.flags === "object" ? source.flags : null;
  return { baseUrl: normalizeCloudBaseUrl(rawUrl), flags };
}

function readMeta() {
  try {
    if (typeof document === "undefined" || typeof document.querySelector !== "function") return "";
    const el = document.querySelector(`meta[name="${CLOUD_META_NAME}"]`);
    return el ? el.getAttribute("content") || "" : "";
  } catch {
    return "";
  }
}

function readStorage() {
  try {
    if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") return "";
    return localStorage.getItem(CLOUD_STORAGE_KEY) || "";
  } catch {
    // why: modo privado pode lançar ao ler localStorage
    return "";
  }
}

function readGlobal() {
  try {
    return globalThis[CLOUD_GLOBAL_KEY];
  } catch {
    return undefined;
  }
}

function isInjected(env) {
  if (!env || typeof env !== "object") return false;
  return INJECTED_KEYS.some((key) => Object.prototype.hasOwnProperty.call(env, key));
}

function applyFlags(enabled, overrides) {
  const flags = emptyCloudFlags();
  if (!enabled) return flags;
  // why: com URL base as flags leem como disponíveis, mas nenhuma chamada sai da máquina
  for (const key of CLOUD_FLAG_KEYS) {
    const value = overrides ? overrides[key] : undefined;
    flags[key] = typeof value === "boolean" ? value : true;
  }
  return flags;
}

/**
 * @param {{
 *   baseUrl?: string,
 *   globalValue?: unknown,
 *   metaContent?: string,
 *   storageValue?: string | null,
 *   flags?: Record<string, boolean> | null,
 * }} [env]  omitir para ler global, meta e localStorage
 */
export function resolveCloudConfig(env) {
  const injected = isInjected(env);
  const input = injected ? env : {};

  const globalValue = Object.prototype.hasOwnProperty.call(input, "globalValue")
    ? input.globalValue
    : injected
      ? undefined
      : readGlobal();
  const metaContent = Object.prototype.hasOwnProperty.call(input, "metaContent")
    ? input.metaContent
    : injected
      ? ""
      : readMeta();
  const storageValue = Object.prototype.hasOwnProperty.call(input, "storageValue")
    ? input.storageValue
    : injected
      ? ""
      : readStorage();

  let baseUrl = "";
  let flagSource = null;

  if (Object.prototype.hasOwnProperty.call(input, "baseUrl")) {
    baseUrl = normalizeCloudBaseUrl(input.baseUrl);
    flagSource = input.flags ?? null;
  } else {
    const parsedGlobal = parseSource(globalValue);
    if (parsedGlobal.baseUrl) {
      baseUrl = parsedGlobal.baseUrl;
      flagSource = parsedGlobal.flags;
    } else {
      baseUrl = normalizeCloudBaseUrl(metaContent) || normalizeCloudBaseUrl(storageValue);
      flagSource = input.flags ?? null;
    }
  }

  const enabled = Boolean(baseUrl);
  return {
    baseUrl: enabled ? baseUrl : "",
    enabled,
    flags: applyFlags(enabled, flagSource),
  };
}

export function isCloudEnabled(env) {
  return resolveCloudConfig(env).enabled;
}

export function getCloudFlags(env) {
  return resolveCloudConfig(env).flags;
}

export function getCloudBaseUrl(env) {
  return resolveCloudConfig(env).baseUrl;
}

function stubResult(env) {
  const enabled = isCloudEnabled(env);
  return {
    ok: false,
    stub: true,
    reason: enabled ? "not-implemented" : "cloud-not-configured",
  };
}

/**
 * why: o OSS não abre rede; o objeto estável deixa o chamador seguir sem Cloud.
 */
export function callCloud(_path, _init, env) {
  return Promise.resolve(stubResult(env));
}

export function cloudFetch(path, init, env) {
  return callCloud(path, init, env);
}

export function installCloudHooks(target) {
  const host = target === undefined ? (typeof window !== "undefined" ? window : null) : target;
  if (!host || (typeof host !== "object" && typeof host !== "function")) return null;
  const api = {
    isCloudEnabled,
    getCloudFlags,
    getCloudBaseUrl,
    callCloud,
    cloudFetch,
  };
  host.GuiaFlowCloud = api;
  return api;
}

installCloudHooks();
