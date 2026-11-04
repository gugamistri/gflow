/**
 * Entrada identificada no /p (F1): `?lp=v1.<payload>.<assinatura>`.
 * O player tira o `lp` da barra (history.replaceState) antes de qualquer outra coisa, manda o token
 * uma vez para a Cloud com o id da sessão e, se valer, rastreia o progresso mesmo com DNT/GPC
 * (base legal: contrato/legítimo interesse, com aviso único). Token inválido = tour normal.
 * O token nunca vai para log, storage nem analytics.
 */

export const ENTRY_PARAM = "lp";
const TOKEN_RE = /^v1\.[A-Za-z0-9_-]{1,2000}\.[A-Za-z0-9_-]{1,200}$/;
const MAX_TOKEN = 2048;

/** Token do `?lp=` (só o formato; a assinatura é conferida na Cloud). */
export function readEntryToken(search) {
  try {
    const value = new URLSearchParams(String(search || "")).get(ENTRY_PARAM);
    if (!value || value.length > MAX_TOKEN || !TOKEN_RE.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/** A mesma URL sem o `lp` (mantém os outros parâmetros e o hash). null se não havia `lp`. */
export function stripEntryParam(href) {
  try {
    const url = new URL(String(href));
    if (!url.searchParams.has(ENTRY_PARAM)) return null;
    url.searchParams.delete(ENTRY_PARAM);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Tira o `lp` da barra e do histórico. Devolve o token lido antes (ou null). */
export function consumeEntryToken(loc = globalThis.location, hist = globalThis.history) {
  if (!loc) return null;
  const token = readEntryToken(loc.search);
  const clean = stripEntryParam(loc.href);
  if (clean != null) {
    try {
      hist?.replaceState(hist.state ?? null, "", clean);
    } catch {
      /* sem history (iframe sandbox): segue */
    }
  }
  return token;
}

/** Endereço da seção da política de privacidade no idioma da interface. */
export function privacyNoticeUrl(locale) {
  // why: as três versões da política usam os mesmos ids de seção
  const l = String(locale || "").toLowerCase();
  if (l.startsWith("en")) return "/en/privacy#treinamento-identificado";
  if (l.startsWith("es")) return "/es/privacidad#treinamento-identificado";
  return "/privacidade#treinamento-identificado";
}

export function noticeStorageKey(slug) {
  return `gf.entryNotice.${slug}`;
}

/** Aviso único por tour neste navegador. */
export function noticeAlreadySeen(storage, slug) {
  try {
    return storage?.getItem(noticeStorageKey(slug)) === "1";
  } catch {
    return false;
  }
}

export function markNoticeSeen(storage, slug) {
  try {
    storage?.setItem(noticeStorageKey(slug), "1");
  } catch {
    /* navegação privada: o aviso pode voltar, sem prejuízo */
  }
}

/** Resposta do POST /api/shares/:slug/entry → estado da sessão identificada (ou null). */
export function entryResult(res) {
  const data = res?.ok ? res.data : null;
  if (!data || data.identified !== true) return null;
  const company = typeof data.company === "string" && data.company.trim() ? data.company.trim().slice(0, 80) : null;
  return { identified: true, source: data.source === "api" ? "api" : "leadpronto", company };
}
