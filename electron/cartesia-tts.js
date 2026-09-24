/**
 * POST /tts/bytes no processo principal.
 * why: a chave só sai no header desta chamada; a resposta é áudio.
 */

const CARTESIA_URL = "https://api.cartesia.ai/tts/bytes";
const AUDIO_LIMIT = 1024 * 1024 * 8;

function clip(text) {
  const raw = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.length > 180 ? `${raw.slice(0, 179)}…` : raw;
}

async function synthesize({ apiKey, body, fetchImpl = fetch, redact = (value) => value }) {
  const key = String(apiKey || "");
  let response;
  try {
    response = await fetchImpl(CARTESIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Cartesia-Version": "2026-08-14",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    return { ok: false, error: "Não foi possível falar com a Cartesia." };
  }

  if (!response.ok) {
    const detail = redact(await response.text().catch(() => ""), key);
    let message = "";
    try {
      message = JSON.parse(detail).message || "";
    } catch {
      message = detail;
    }
    return { ok: false, error: clip(redact(message, key)) || "A síntese falhou." };
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > AUDIO_LIMIT) {
    return { ok: false, error: "O áudio gerado é inválido." };
  }
  return { ok: true, audioBase64: audio.toString("base64"), mime: "audio/mpeg" };
}

module.exports = { synthesize, CARTESIA_URL };
