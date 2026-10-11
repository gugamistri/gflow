/* Worker de mídia: recodifica capturas (OffscreenCanvas) e narração (MP3 via LAME) fora da UI.
 * Script clássico de propósito: importScripts do LAME e nenhum import de módulo (Safari/Electron).
 * Mensagens: { id, kind: "image"|"mp3", ... } → { id, ok, ... } */
/* global lamejs */

let lameLoaded = false;

function loadLame() {
  if (lameLoaded) return;
  importScripts(new URL("../vendor/lamejs/lame.min.js", self.location.href).href);
  lameLoaded = true;
}

function fitWithin(width, height, maxEdge) {
  const long = Math.max(width, height);
  if (!maxEdge || long <= maxEdge) return { width, height, resized: false };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), resized: true };
}

function hasAlpha(bitmap) {
  const w = Math.min(160, bitmap.width);
  const h = Math.min(160, bitmap.height);
  const probe = new OffscreenCanvas(w, h);
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

async function encodeImage({ bytes, mime, maxEdge, quality }) {
  const source = new Blob([bytes], { type: mime });
  const bitmap = await createImageBitmap(source);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const fit = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = new OffscreenCanvas(fit.width, fit.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
  const candidates = [];
  const webp = await canvas.convertToBlob({ type: "image/webp", quality });
  if (webp.type === "image/webp") candidates.push(webp);
  else {
    const alpha = /png|webp|gif/i.test(mime) ? hasAlpha(canvas) : false;
    if (alpha) {
      const png = webp.type === "image/png" ? webp : await canvas.convertToBlob({ type: "image/png" });
      candidates.push(png);
    } else {
      const flat = new OffscreenCanvas(fit.width, fit.height);
      const fctx = flat.getContext("2d");
      fctx.fillStyle = "#ffffff";
      fctx.fillRect(0, 0, fit.width, fit.height);
      fctx.drawImage(canvas, 0, 0);
      candidates.push(await flat.convertToBlob({ type: "image/jpeg", quality }));
    }
  }
  bitmap.close?.();
  const best = candidates.sort((a, b) => a.size - b.size)[0];
  const out = new Uint8Array(await best.arrayBuffer());
  return {
    bytes: out,
    mime: best.type,
    width: fit.width,
    height: fit.height,
    sourceWidth,
    sourceHeight,
    resized: fit.resized,
  };
}

function encodeMp3({ channels, sampleRate, kbps }) {
  loadLame();
  const stereo = channels.length > 1;
  const enc = new lamejs.Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps);
  const block = 1152;
  const parts = [];
  let total = 0;
  const left = channels[0];
  const right = stereo ? channels[1] : null;
  for (let i = 0; i < left.length; i += block) {
    const chunk = stereo
      ? enc.encodeBuffer(left.subarray(i, i + block), right.subarray(i, i + block))
      : enc.encodeBuffer(left.subarray(i, i + block));
    if (chunk.length) {
      parts.push(new Uint8Array(chunk));
      total += chunk.length;
    }
  }
  const tail = enc.flush();
  if (tail.length) {
    parts.push(new Uint8Array(tail));
    total += tail.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return { bytes: out, mime: "audio/mpeg" };
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    let result;
    if (msg.kind === "image") result = await encodeImage(msg);
    else if (msg.kind === "mp3") result = encodeMp3(msg);
    else if (msg.kind === "ping") result = { pong: true, offscreen: typeof OffscreenCanvas !== "undefined" };
    else throw new Error("unknown_kind");
    self.postMessage({ id: msg.id, ok: true, ...result }, result.bytes ? [result.bytes.buffer] : []);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
};
