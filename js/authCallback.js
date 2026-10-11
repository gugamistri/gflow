/**
 * Página /auth/callback. why: a nuvem manda o browser para cá com ?code=
 * e o editor troca esse code pela sessão antes de voltar ao editor (/editor).
 */
import {
  completeCloudAuthCallback,
  stashCloudAuthError,
} from "./cloudConfig.js";

const status = document.getElementById("status");

function goHome(href) {
  let next = "/editor";
  try {
    const url = new URL(href || "/editor", location.origin);
    if (url.origin === location.origin) {
      next = `${url.pathname}${url.search}${url.hash}` || "/editor";
    }
  } catch {
    next = "/editor";
  }
  location.replace(next);
}

try {
  const result = await completeCloudAuthCallback(location.href);
  if (result.consumed && !result.ok) stashCloudAuthError(result.error || "invalid_token");
  goHome(result.href);
} catch {
  if (status) status.textContent = "Não foi possível entrar. Volte ao GuiaFlow e peça outro link.";
  setTimeout(() => goHome("/editor"), 1600);
}
