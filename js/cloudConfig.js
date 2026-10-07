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
export const CLOUD_PENDING_PUBLISH_KEY = "guiaflow.cloud.pendingPublish";
export const CLOUD_VERIFY_PATH = "/auth/verify";
export const CLOUD_AUTH_MESSAGE_TYPE = "guiaflow.cloud.auth";
export const CLOUD_AUTH_ERROR_KEY = "guiaflow.cloud.authError";
/** Página do editor que troca o code de uso único pela sessão. */
export const CLOUD_CALLBACK_PATH = "/auth/callback";
/** Origem do editor. A base HTTP da nuvem não aparece na interface. */
export const CLOUD_EDITOR_ORIGIN = "https://guiaflow.pro";

/** Pedidos HTTP da nuvem. O apex só serve este app. */
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

function decodeBase64UrlJson(segment) {
  try {
    const b64 = String(segment || "").replace(/-/g, "+").replace(/_/g, "/");
    if (!b64) return null;
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

/** JWT com exp no passado deixa de contar. Token opaco (sem exp) continua válido. */
function accessTokenExpired(token, now) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !parts[1]) return false;
  const payload = decodeBase64UrlJson(parts[1]);
  if (!payload || typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return false;
  return payload.exp * 1000 <= now;
}

export function readCloudSession(now = Date.now()) {
  const raw = readLocal(CLOUD_SESSION_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const accessToken = typeof data?.accessToken === "string" ? data.accessToken.trim() : "";
    if (!accessToken) return null;
    if (accessTokenExpired(accessToken, now)) {
      clearCloudSession();
      return null;
    }
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
const CLOUD_PUBLISH_INTENT_TTL_MS = 30 * 60 * 1000;
const CALLBACK_LOGIN_KEYS = ["guiaflow_login", "guiaflow_token"];
const CALLBACK_SESSION_KEYS = ["guiaflow_session", "access_token"];
const CALLBACK_STRIP_KEYS = [...CALLBACK_LOGIN_KEYS, ...CALLBACK_SESSION_KEYS];

function callbackUrlFrom(href) {
  const fallback = `${CLOUD_EDITOR_ORIGIN}${CLOUD_CALLBACK_PATH}`;
  let url;
  try {
    url = new URL(href);
  } catch {
    return fallback;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
  url.username = "";
  url.password = "";
  url.pathname = CLOUD_CALLBACK_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Para onde a nuvem manda o browser depois do email ou da senha.
 * why: o code volta em /auth/callback, nunca num host que a interface mostre.
 */
export function cloudLoginRedirectUrl(locationLike) {
  const fallback = `${CLOUD_EDITOR_ORIGIN}${CLOUD_CALLBACK_PATH}`;
  let href = "";
  if (typeof locationLike === "string") href = locationLike.trim();
  else if (locationLike && typeof locationLike.href === "string") href = locationLike.href;
  else {
    try {
      if (typeof location !== "undefined" && location.href) href = location.href;
    } catch {
      href = "";
    }
  }
  if (!href) return fallback;
  return callbackUrlFrom(href);
}

function pathnameOf(url) {
  return url.pathname.replace(/\/+$/, "") || "/";
}

/** Code de uso único só em /auth/callback. Dura cerca de 2 minutos na nuvem. */
export function readAuthCallbackCode(href) {
  let url;
  try {
    url = new URL(String(href || ""), `${CLOUD_EDITOR_ORIGIN}/`);
  } catch {
    return "";
  }
  if (pathnameOf(url) !== CLOUD_CALLBACK_PATH) return "";
  const code = url.searchParams.get("code");
  return code && code.trim() ? code.trim() : "";
}

/** Depois da troca, o browser fica na raiz do editor, sem o code. */
export function editorHomeFromCallback(href) {
  let url;
  try {
    url = new URL(String(href || ""), `${CLOUD_EDITOR_ORIGIN}/`);
  } catch {
    return `${CLOUD_EDITOR_ORIGIN}/`;
  }
  if (pathnameOf(url) === CLOUD_CALLBACK_PATH) url.pathname = "/";
  url.searchParams.delete("code");
  for (const key of CALLBACK_STRIP_KEYS) url.searchParams.delete(key);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : "";
  if (hash.includes("=")) {
    const params = new URLSearchParams(hash);
    for (const key of CALLBACK_STRIP_KEYS) params.delete(key);
    const next = params.toString();
    url.hash = next ? `#${next}` : "";
  }
  return url.toString();
}

function firstParam(params, keys) {
  for (const key of keys) {
    const value = params.get(key);
    if (value && value.trim()) return { key, token: value.trim() };
  }
  return null;
}

/**
 * Token de regresso do link mágico. JWT só no fragmento: a query iria para o log do editor.
 */
export function readCloudAuthCallback(href) {
  let url;
  try {
    url = new URL(String(href || ""), `${CLOUD_EDITOR_ORIGIN}/`);
  } catch {
    return null;
  }
  const query = firstParam(url.searchParams, CALLBACK_LOGIN_KEYS);
  if (query) return { token: query.token, via: "query", key: query.key, kind: "magic" };
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : "";
  if (!hash || !hash.includes("=")) return null;
  const hashParams = new URLSearchParams(hash);
  const login = firstParam(hashParams, CALLBACK_LOGIN_KEYS);
  if (login) return { token: login.token, via: "hash", key: login.key, kind: "magic" };
  const session = firstParam(hashParams, CALLBACK_SESSION_KEYS);
  if (session) return { token: session.token, via: "hash", key: session.key, kind: "bearer" };
  return null;
}

export function stripCloudAuthCallback(href) {
  let url;
  try {
    url = new URL(String(href || ""), `${CLOUD_EDITOR_ORIGIN}/`);
  } catch {
    return String(href || "");
  }
  for (const key of CALLBACK_STRIP_KEYS) url.searchParams.delete(key);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : "";
  if (hash.includes("=")) {
    const params = new URLSearchParams(hash);
    for (const key of CALLBACK_STRIP_KEYS) params.delete(key);
    const next = params.toString();
    url.hash = next ? `#${next}` : "";
  }
  return url.toString();
}

export function cloudAuthMessageOrigins(env) {
  const origins = new Set([CLOUD_EDITOR_ORIGIN]);
  const base = getCloudBaseUrl(env);
  if (base) {
    try {
      origins.add(new URL(base).origin);
    } catch {
      /* base inválida */
    }
  }
  const page = env && typeof env.pageOrigin === "string" ? env.pageOrigin : "";
  if (page) {
    try {
      const origin = new URL(page).origin;
      if (origin && origin !== "null") origins.add(origin);
    } catch {
      /* origem inválida */
    }
  } else {
    try {
      if (typeof location !== "undefined" && location.origin && location.origin !== "null") {
        origins.add(location.origin);
      }
    } catch {
      /* sem location */
    }
  }
  return origins;
}

export function parseCloudAuthMessage(data, origin, allowedOrigins) {
  if (!data || typeof data !== "object") return null;
  if (data.type !== CLOUD_AUTH_MESSAGE_TYPE) return null;
  const token = typeof data.token === "string" ? data.token.trim() : "";
  if (!token || token.length > 8192) return null;
  const allow = allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins || []);
  if (!origin || !allow.has(origin)) return null;
  const email = typeof data.email === "string" ? data.email.trim() : "";
  return { token, email };
}

export function writeCloudPublishIntent(projectId, now = Date.now()) {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  if (!id) return null;
  const intent = { projectId: id, at: now };
  writeLocal(CLOUD_PENDING_PUBLISH_KEY, JSON.stringify(intent));
  return intent;
}

export function clearCloudPublishIntent() {
  removeLocal(CLOUD_PENDING_PUBLISH_KEY);
}

function readCloudPublishIntent(now) {
  const raw = readLocal(CLOUD_PENDING_PUBLISH_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const projectId = typeof data?.projectId === "string" ? data.projectId.trim() : "";
    const at = Number(data?.at);
    if (!projectId || !Number.isFinite(at) || at > now + 60_000 || now - at > CLOUD_PUBLISH_INTENT_TTL_MS) {
      clearCloudPublishIntent();
      return null;
    }
    return { projectId, at };
  } catch {
    clearCloudPublishIntent();
    return null;
  }
}

/** Uma aba só. why: o link pode abrir noutra aba e as duas verem a sessão ao mesmo tempo. */
export function claimCloudPublishIntent(projectId, now = Date.now()) {
  const intent = readCloudPublishIntent(now);
  if (!intent || intent.projectId !== projectId) return false;
  clearCloudPublishIntent();
  return true;
}

export function requestMagicLink(email, env, options) {
  const trimmed = String(email || "").trim();
  if (!EMAIL_RE.test(trimmed)) {
    return Promise.resolve({ ok: false, error: "invalid_email", message: "" });
  }
  const redirect = cloudLoginRedirectUrl(options?.redirect);
  return cloudFetch(
    "/auth/magic-link",
    {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email: trimmed, redirect }),
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
  if (found) {
    const code = readAuthCallbackCode(candidate);
    if (code) return { kind: "code", token: code };
    const callback = readCloudAuthCallback(candidate);
    if (callback) return { kind: callback.kind, token: callback.token };
  }
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

export async function establishCloudSession(pasted, env, { emailHint = "", forceKind } = {}) {
  let parsed = parseCloudLoginPaste(pasted);
  const raw = String(pasted || "").trim();
  if (!parsed && raw && (forceKind === "magic" || forceKind === "bearer")) {
    parsed = { kind: forceKind, token: raw };
  }
  if (!parsed) return { ok: false, error: "invalid_token", message: "" };
  const hint = String(emailHint || "").trim();
  if (parsed.kind === "code") return exchangeCloudAuthCode(parsed.token, env, hint);
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

function sessionFromAuthPayload(result, emailHint) {
  const accessToken = typeof result?.data?.accessToken === "string" ? result.data.accessToken.trim() : "";
  if (!result?.ok || !accessToken) return null;
  const email = result.data?.user?.email || result.data?.email || emailHint || "";
  const safeEmail = typeof email === "string" ? email.trim() : "";
  writeCloudSession({ accessToken, email: safeEmail });
  return { ok: true, email: safeEmail };
}

/**
 * Troca o code de /auth/callback pelo accessToken e grava guiaflow.cloud.session.
 */
export async function exchangeCloudAuthCode(code, env, emailHint = "") {
  const trimmed = String(code || "").trim();
  if (!trimmed) return { ok: false, error: "invalid_token", message: "" };
  const result = await cloudFetch(
    CLOUD_CALLBACK_PATH,
    {
      method: "POST",
      auth: false,
      body: JSON.stringify({ code: trimmed }),
    },
    env
  );
  const stored = sessionFromAuthPayload(result, emailHint);
  if (stored) return stored;
  if (result.ok) return { ok: false, error: "invalid_token", message: "" };
  return result.error ? result : { ...result, error: "invalid_token" };
}

/**
 * Senha para quem já entrou antes. why: o regresso do browser continua a ser /auth/callback?code=
 * quando a nuvem não devolve o accessToken neste pedido.
 */
export async function loginWithPassword(email, password, env) {
  const trimmed = String(email || "").trim();
  const pass = String(password || "");
  if (!EMAIL_RE.test(trimmed) || !pass) {
    return { ok: false, error: "invalid_credentials", message: "" };
  }
  const result = await cloudFetch(
    "/auth/login",
    {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email: trimmed, password: pass }),
    },
    env
  );
  if (!result.ok) {
    if (result.status === 401 || result.error === "invalid_credentials" || result.error === "invalid_password") {
      return { ...result, error: "invalid_credentials" };
    }
    return result;
  }
  const stored = sessionFromAuthPayload(result, trimmed);
  if (stored) return stored;
  const code = typeof result.data?.code === "string" ? result.data.code.trim() : "";
  if (code) return exchangeCloudAuthCode(code, env, trimmed);
  const redirect = result.data?.redirect || result.data?.url;
  const redirectedCode = typeof redirect === "string" ? readAuthCallbackCode(redirect) : "";
  if (redirectedCode) return exchangeCloudAuthCode(redirectedCode, env, trimmed);
  return { ok: false, error: "invalid_token", message: "" };
}

export function stashCloudAuthError(code) {
  const value = String(code || "invalid_token");
  try {
    if (typeof sessionStorage === "undefined" || typeof sessionStorage.setItem !== "function") return;
    sessionStorage.setItem(CLOUD_AUTH_ERROR_KEY, value);
  } catch {
    /* modo privado */
  }
}

export function takeCloudAuthError() {
  try {
    if (typeof sessionStorage === "undefined" || typeof sessionStorage.getItem !== "function") return "";
    const value = sessionStorage.getItem(CLOUD_AUTH_ERROR_KEY) || "";
    if (value) sessionStorage.removeItem(CLOUD_AUTH_ERROR_KEY);
    return value;
  } catch {
    return "";
  }
}

/**
 * Consome /auth/callback?code= e devolve o URL do editor já sem o segredo.
 * Um link antigo com guiaflow_login ainda entra, para não deixar o token na barra.
 */
export async function completeCloudAuthCallback(href, env) {
  const code = readAuthCallbackCode(href);
  if (code) {
    const clean = editorHomeFromCallback(href);
    const session = await exchangeCloudAuthCode(code, env);
    return { ...session, consumed: true, href: clean };
  }
  const found = readCloudAuthCallback(href);
  if (!found) return { ok: false, consumed: false, href: String(href || "") };
  const clean = stripCloudAuthCallback(href);
  const session = await establishCloudSession(found.token, env, { forceKind: found.kind });
  return { ...session, consumed: true, href: clean };
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
    loginWithPassword,
    establishCloudSession,
    exchangeCloudAuthCode,
    completeCloudAuthCallback,
    endCloudSession,
    cloudVerifyUrl,
    cloudLoginRedirectUrl,
    readCloudAuthCallback,
    parseCloudAuthMessage,
  };
  host.GuiaFlowCloud = api;
  return api;
}

installCloudHooks();
