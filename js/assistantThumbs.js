/**
 * Miniaturas JPEG para a IA do assistente (canvas no browser).
 * No Node (testes) devolve null — os testes cobrem o filtro de nomes e o empacotamento do pedido.
 */
import { ASSISTANT_THUMB_MAX_SIDE, ASSISTANT_THUMB_QUALITY } from "./assistant.js";

/**
 * @param {string} dataUrl
 * @param {{ maxSide?: number, quality?: number }} [opts]
 * @returns {Promise<string|null>} data:image/jpeg;base64,... ou null
 */
export function makeAssistantThumbnail(dataUrl, opts = {}) {
  const maxSide = opts.maxSide ?? ASSISTANT_THUMB_MAX_SIDE;
  const quality = opts.quality ?? ASSISTANT_THUMB_QUALITY;
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return Promise.resolve(null);
  }
  if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(String(dataUrl || ""))) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w0 = img.naturalWidth || 0;
        const h0 = img.naturalHeight || 0;
        if (!(w0 > 0 && h0 > 0)) return resolve(null);
        const scale = Math.min(1, maxSide / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * @param {{ key: string, material: { dataUrl: string } }[]} entries
 * @returns {Promise<string[]>}
 */
export async function thumbnailsForAi(entries) {
  const out = [];
  for (const entry of entries || []) {
    const thumb = await makeAssistantThumbnail(entry.material?.dataUrl);
    if (thumb) out.push(thumb);
  }
  return out;
}
