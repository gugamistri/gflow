/**
 * Encaixe do GuiaFlow Cloud.
 * why: o editor MIT fala com a API só quando há URL base; sem isso nada sai da máquina.
 * hazard: BYOK continua em llm.js / cartesia.js. Não gravar AUTH_SECRET nem chave de API.
 *         O bearer da sessão fica só no localStorage do navegador.
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
export const CLOUD_SESSION_KEY = "guiaflow.cloud.session";
export const CLOUD_VERIFY_PATH = "/auth/verify";

/** Editor publicado. A API Cloud ficou em api.guiaflow.pro; o apex só serve este app. */
export const PUBLISHED_CLOUD_BASE = "https://api.guiaflow.pro";
const PUBLISHED_CLOUD_HOSTS = new Set(["guiaflow.pro", "guiaflow-seven.vercel.app"]);

const INJECTED_KEYS = ["baseUrl", "globalValue", "metaContent", "storageValue", "flags", "hostname"];

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

function readLocationHost() {
  try {
    if (typeof location === "undefined" || !location.hostname) return "";
    return location.hostname;
  } catch {
    return "";
  }
}

/**
 * Base da API nos hosts do editor publicado. localhost e o app desktop ficam sem base.
 */
export function defaultCloudBaseForHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  return PUBLISHED_CLOUD_HOSTS.has(host) ? PUBLISHED_CLOUD_BASE : "";
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
 *   hostname?: string,
 * }} [env]  omitir para ler global, meta, localStorage e o host publicado
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
  const explicitBase = Object.prototype.hasOwnProperty.call(input, "baseUrl");

  if (explicitBase) {
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

  if (!baseUrl && !explicitBase) {
    const hostname = Object.prototype.hasOwnProperty.call(input, "hostname")
      ? input.hostname
      : injected
        ? ""
        : readLocationHost();
    baseUrl = defaultCloudBaseForHost(hostname);
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
 * why: IA hospedada, TTS, marca e analytics continuam fora deste repo.
 *      O link permanente usa cloudFetch, não este stub.
 */
export function callCloud(_path, _init, env) {
  return Promise.resolve(stubResult(env));
}

function readLocal(key) {
  try {
    if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") return "";
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeLocal(key, value) {
  try {
    if (typeof localStorage === "undefined" || typeof localStorage.setItem !== "function") return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeLocal(key) {
  try {
    if (typeof localStorage === "undefined" || typeof localStorage.removeItem !== "function") return;
    localStorage.removeItem(key);
  } catch {
    /* modo privado */
  }
}

export function readCloudSession() {
  const raw = readLocal(CLOUD_SESSION_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const accessToken = typeof data?.accessToken === "string" ? data.accessToken.trim() : "";
    if (!accessToken) return null;
    const email = typeof data?.email === "string" ? data.email.trim() : "";
    return { accessToken, email };
  } catch {
    return null;
  }
}

export function writeCloudSession(session) {
  const accessToken = typeof session?.accessToken === "string" ? session.accessToken.trim() : "";
  if (!accessToken) {
    clearCloudSession();
    return null;
  }
  const next = {
    accessToken,
    email: typeof session?.email === "string" ? session.email.trim() : "",
  };
  writeLocal(CLOUD_SESSION_KEY, JSON.stringify(next));
  return next;
}

export function clearCloudSession() {
  removeLocal(CLOUD_SESSION_KEY);
}

export function getCloudAccount() {
  const session = readCloudSession();
  if (!session) return { signedIn: false, email: "" };
  return { signedIn: true, email: session.email || "" };
}

function resolveAccessToken(request, env) {
  if (request && Object.prototype.hasOwnProperty.call(request, "accessToken")) {
    return String(request.accessToken || "").trim();
  }
  if (env && Object.prototype.hasOwnProperty.call(env, "accessToken")) {
    return String(env.accessToken || "").trim();
  }
  return readCloudSession()?.accessToken || "";
}

/**
 * Só caminhos relativos na URL base. why: o bearer não pode seguir para outro host.
 */
export function joinCloudUrl(baseUrl, path) {
  const base = normalizeCloudBaseUrl(baseUrl);
  const rel = typeof path === "string" ? path : "";
  if (!base || !rel.startsWith("/") || rel.startsWith("//")) {
    throw new Error("invalid_cloud_path");
  }
  return `${base}${rel}`;
}

function cloudErrorCode(data, status) {
  if (data && typeof data.error === "string" && data.error) return data.error;
  if (status === 401) return "unauthorized";
  return status ? `http_${status}` : "request_failed";
}

/**
 * Pedido real à API Cloud quando há URL base.
 * Sem URL, devolve o stub e não chama fetch.
 */
export async function cloudFetch(path, init, env) {
  const config = resolveCloudConfig(env);
  if (!config.enabled) {
    return { ok: false, stub: true, reason: "cloud-not-configured" };
  }
  const request = init && typeof init === "object" ? init : {};
  const useAuth = request.auth !== false;
  const token = useAuth ? resolveAccessToken(request, env) : "";
  let url;
  try {
    url = joinCloudUrl(config.baseUrl, path);
  } catch {
    return { ok: false, error: "invalid_path", message: "" };
  }
  const headers = new Headers(request.headers || undefined);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (request.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const { auth: _auth, accessToken: _token, headers: _headers, ...rest } = request;
  try {
    const res = await fetch(url, {
      ...rest,
      headers,
      credentials: rest.credentials || "omit",
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: cloudErrorCode(data, res.status),
        message: typeof data?.message === "string" ? data.message : "",
        data,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, error: "network", message: err?.message || "" };
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requestMagicLink(email, env) {
  const trimmed = String(email || "").trim();
  if (!EMAIL_RE.test(trimmed)) {
    return Promise.resolve({ ok: false, error: "invalid_email", message: "" });
  }
  return cloudFetch(
    "/auth/magic-link",
    {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email: trimmed }),
    },
    env
  ).then((result) => {
    if (result.ok && result.data && result.data.delivered === false) {
      return { ok: false, error: "email_failed", message: "", data: result.data };
    }
    return result;
  });
}

/**
 * Aceita o URL do email (?token=), o token de uso único, ou um JWT já emitido.
 */
export function parseCloudLoginPaste(value) {
  const raw = String(value || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return null;
  const found = raw.match(/https?:\/\/[^\s<>"']+/i);
  const candidate = found ? found[0] : raw;
  try {
    const url = new URL(candidate);
    const token = url.searchParams.get("token");
    if (token && token.trim()) return { kind: "magic", token: token.trim() };
  } catch {
    /* não é URL */
  }
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(candidate)) {
    return { kind: "bearer", token: candidate };
  }
  if (/^[A-Za-z0-9._~-]{16,}$/.test(candidate)) {
    return { kind: "magic", token: candidate };
  }
  return null;
}

export async function establishCloudSession(pasted, env, { emailHint = "" } = {}) {
  const parsed = parseCloudLoginPaste(pasted);
  if (!parsed) return { ok: false, error: "invalid_token", message: "" };
  const hint = String(emailHint || "").trim();
  if (parsed.kind === "bearer") {
    const session = await cloudFetch("/auth/session", { method: "GET", accessToken: parsed.token }, env);
    if (!session.ok) return session;
    const email =
      session.data?.user?.email || session.data?.email || hint;
    writeCloudSession({ accessToken: parsed.token, email: typeof email === "string" ? email : "" });
    return { ok: true, email: typeof email === "string" ? email : "" };
  }
  const verified = await cloudFetch(
    "/auth/verify",
    {
      method: "POST",
      auth: false,
      body: JSON.stringify({ token: parsed.token }),
    },
    env
  );
  const accessToken = verified.data?.accessToken;
  if (!verified.ok || typeof accessToken !== "string" || !accessToken.trim()) {
    if (verified.ok) return { ok: false, error: "invalid_token", message: "" };
    return verified.error ? verified : { ...verified, error: "invalid_token" };
  }
  const email = verified.data?.user?.email || hint;
  writeCloudSession({
    accessToken: accessToken.trim(),
    email: typeof email === "string" ? email : "",
  });
  return { ok: true, email: typeof email === "string" ? email : "" };
}

export async function endCloudSession(env) {
  if (readCloudSession() && isCloudEnabled(env)) {
    await cloudFetch("/auth/logout", { method: "POST" }, env);
  }
  clearCloudSession();
}

export function cloudVerifyUrl(env) {
  const base = getCloudBaseUrl(env);
  if (!base) return "";
  return `${base}${CLOUD_VERIFY_PATH}`;
}

export function installCloudHooks(target) {
  const host = target === undefined ? (typeof window !== "undefined" ? window : null) : target;
  if (!host || (typeof host !== "object" && typeof host !== "function")) return null;
  const api = {
    isCloudEnabled,
    getCloudFlags,
    getCloudBaseUrl,
    getCloudAccount,
    callCloud,
    cloudFetch,
    requestMagicLink,
    establishCloudSession,
    endCloudSession,
    cloudVerifyUrl,
  };
  host.GuiaFlowCloud = api;
  return api;
}

installCloudHooks();
