/**
 * Páginas em que a extensão não consegue (ou não deve) fotografar.
 * O ícone cinza e o aviso do popup usam a mesma regra.
 */

const STORE_HOSTS = new Set(["chromewebstore.google.com"]);

export function isRestrictedUrl(url, { fileAccess = false } = {}) {
  if (typeof url !== "string" || !url.trim()) return true;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol === "file:") return !fileAccess;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || "/";
  if (STORE_HOSTS.has(host)) return true;
  if (host === "chrome.google.com" && (path === "/webstore" || path.startsWith("/webstore/"))) return true;
  if (host === "microsoftedge.microsoft.com" && (path === "/addons" || path.startsWith("/addons/"))) return true;
  return false;
}

/** file:// só entra na captura se o Chrome deixou a extensão ler arquivos locais. */
export function fileSchemeAllowed() {
  return new Promise((resolve) => {
    const ask = globalThis.chrome?.extension?.isAllowedFileSchemeAccess;
    if (typeof ask !== "function") {
      resolve(false);
      return;
    }
    try {
      ask((allowed) => {
        resolve(!globalThis.chrome?.runtime?.lastError && Boolean(allowed));
      });
    } catch {
      resolve(false);
    }
  });
}
