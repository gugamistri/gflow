export const EXT_BANNER_DISMISS_KEY = "ns-ext-banner-dismissed";

/**
 * Chromium desktop (Chrome, Edge, Brave, Opera, Arc) can install the extension.
 * Mobile, Safari, and Firefox cannot — including iPadOS that reports as MacIntel.
 *
 * @param {{ userAgent?: string, maxTouchPoints?: number, hasChrome?: boolean }} [env]
 */
export function canOfferChromeExtension(env = {}) {
  const ua = String(env.userAgent ?? "");
  const maxTouchPoints = Number(env.maxTouchPoints) || 0;
  const hasChrome = Boolean(env.hasChrome);

  // why: iPhone/iPad/Android never load MV3 from the Chrome Web Store
  if (/Android|iPhone|iPod|iPad|Mobile/i.test(ua)) return false;
  // why: iPadOS 13+ often claims MacIntel; touch points expose the tablet
  if (maxTouchPoints > 1 && /Macintosh/i.test(ua)) return false;

  if (/Firefox\//i.test(ua)) return false;
  // why: Safari desktop has Version/…Safari without Chrome/Chromium/Edg/OPR
  if (/Safari\//i.test(ua) && !/Chrome|Chromium|Edg|OPR|CriOS/i.test(ua)) return false;

  if (hasChrome) return true;
  return /Chrome\/|Chromium\/|Edg\/|OPR\//i.test(ua);
}

export function shouldShowExtensionBanner({
  dismissed,
  isDesktop,
  installed,
  canOffer,
} = {}) {
  const offer = canOffer === undefined ? true : Boolean(canOffer);
  return !dismissed && !isDesktop && !installed && offer;
}
