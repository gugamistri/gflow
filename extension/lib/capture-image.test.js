import assert from "node:assert/strict";
import test from "node:test";
import {
  captureFileName,
  fitCaptureSize,
  optimizeCaptureDataUrl,
  preferEncodedCapture,
} from "./capture-image.js";

const png = `data:image/png;base64,${"A".repeat(400)}`;
const webpSmall = "data:image/webp;base64,BBB";
const webpHuge = `data:image/webp;base64,${"C".repeat(800)}`;

test("lado maior passa de 2560 e a proporção fica", () => {
  assert.deepEqual(fitCaptureSize(5120, 2560), { width: 2560, height: 1280, resized: true });
  assert.deepEqual(fitCaptureSize(800, 600), { width: 800, height: 600, resized: false });
});

test("WebP entra quando fica menor; redimensionar só entra se não crescer", () => {
  assert.equal(preferEncodedCapture({ sourceUrl: png, encodedUrl: webpSmall, resized: false }), true);
  assert.equal(preferEncodedCapture({ sourceUrl: png, encodedUrl: webpHuge, resized: false }), false);
  assert.equal(preferEncodedCapture({ sourceUrl: png, encodedUrl: webpHuge, resized: true }), false);
  assert.equal(preferEncodedCapture({ sourceUrl: png, encodedUrl: "data:image/jpeg;base64,AA", resized: false }), false);
});

test("a captura otimizada sai em WebP e o arquivo acompanha", async () => {
  const out = await optimizeCaptureDataUrl(png, {
    encode: async () => ({ dataUrl: webpSmall, resized: true }),
  });
  assert.equal(out.optimized, true);
  assert.equal(out.dataUrl, webpSmall);
  assert.equal(captureFileName(3, out.dataUrl), "passo-3.webp");
});

test("encoder que falha ou que aumenta o arquivo deixa a foto original", async () => {
  const failed = await optimizeCaptureDataUrl(png, {
    encode: async () => {
      throw new Error("no_canvas");
    },
  });
  assert.equal(failed.optimized, false);
  assert.equal(failed.dataUrl, png);
  assert.equal(captureFileName(1, failed.dataUrl), "passo-1.png");

  const bigger = await optimizeCaptureDataUrl(png, {
    encode: async () => ({ dataUrl: webpHuge, resized: false }),
  });
  assert.equal(bigger.dataUrl, png);
});

test("sem canvas no ambiente a origem permanece", async () => {
  const out = await optimizeCaptureDataUrl(png);
  assert.equal(out.optimized, false);
  assert.equal(out.dataUrl, png);
});
