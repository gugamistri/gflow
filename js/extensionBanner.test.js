import assert from "node:assert/strict";
import test from "node:test";
import { canOfferChromeExtension, shouldShowExtensionBanner } from "./extensionBanner.js";

test("mostra o aviso quando a extensão não está instalada em Chromium", () => {
  assert.equal(shouldShowExtensionBanner({}), true);
  assert.equal(
    shouldShowExtensionBanner({
      dismissed: false,
      isDesktop: false,
      installed: false,
      canOffer: true,
    }),
    true
  );
});

test("esconde o aviso se a pessoa dispensou, está no desktop, a extensão está instalada ou o navegador não oferece", () => {
  assert.equal(shouldShowExtensionBanner({ dismissed: true }), false);
  assert.equal(shouldShowExtensionBanner({ isDesktop: true }), false);
  assert.equal(shouldShowExtensionBanner({ installed: true }), false);
  assert.equal(shouldShowExtensionBanner({ canOffer: false }), false);
});

test("oferece a extensão só em Chromium desktop", () => {
  assert.equal(
    canOfferChromeExtension({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      hasChrome: true,
      maxTouchPoints: 0,
    }),
    true
  );
  assert.equal(
    canOfferChromeExtension({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      hasChrome: true,
      maxTouchPoints: 0,
    }),
    true
  );
  assert.equal(
    canOfferChromeExtension({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      hasChrome: false,
      maxTouchPoints: 0,
    }),
    false
  );
  assert.equal(
    canOfferChromeExtension({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
      hasChrome: false,
      maxTouchPoints: 0,
    }),
    false
  );
});

test("nunca oferece a extensão em celular ou iPad", () => {
  assert.equal(
    canOfferChromeExtension({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      hasChrome: false,
      maxTouchPoints: 5,
    }),
    false
  );
  assert.equal(
    canOfferChromeExtension({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      hasChrome: true,
      maxTouchPoints: 5,
    }),
    false
  );
  assert.equal(
    canOfferChromeExtension({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      hasChrome: false,
      maxTouchPoints: 5,
    }),
    false
  );
});
