export const EXT_BANNER_DISMISS_KEY = "ns-ext-banner-dismissed";

export function shouldShowExtensionBanner({ dismissed, isDesktop, installed } = {}) {
  return !dismissed && !isDesktop && !installed;
}
