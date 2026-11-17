/** Entrada do PostHog nas páginas do site (ver posthogLanding.js). Fora delas, não faz nada. */
import { createLandingPosthog, isLandingPath, wireLanding } from "./posthogLanding.js";

if (typeof document !== "undefined" && typeof location !== "undefined" && isLandingPath(location.pathname)) {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const ph = createLandingPosthog({
    pathname: location.pathname,
    privacy: { dnt: nav.doNotTrack, windowDnt: window.doNotTrack, msDnt: nav.msDoNotTrack, gpc: nav.globalPrivacyControl },
  });
  wireLanding(document, window, ph);
}
