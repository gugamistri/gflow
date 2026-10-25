// Cole no nó Code do n8n (Run Once for All Items), depois do Webhook com Raw Body ligado.
// Troque o segredo pelo whsec_ do diálogo Leads. O corpo usado é o byte cru do POST.
const SECRET = "whsec_COLE_O_SEGREDO";

function guiaflowSignatureOk(input) {
  const id = input.id;
  const timestamp = input.timestamp;
  const signature = input.signature;
  const raw = input.raw;
  const nowSec = input.nowSec;
  const toleranceSec = 300;
  const ts = Number(timestamp);
  if (!id || timestamp == null || timestamp === "" || !signature || typeof raw !== "string") return false;
  if (!Number.isInteger(ts)) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const secret = String(input.secret || "");
  if (!secret.startsWith("whsec_")) return false;
  const b64 = secret.slice("whsec_".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false;
  let keyBytes;
  try {
    const bin = atob(b64);
    keyBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }
  if (!keyBytes.length) return false;
  let round = "";
  for (const b of keyBytes) round += String.fromCharCode(b);
  if (btoa(round).replace(/=+$/, "") !== b64.replace(/=+$/, "")) return false;
  return crypto.subtle
    .importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    .then(async (key) => {
      const signed = new TextEncoder().encode(`${id}.${ts}.${raw}`);
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
      let binary = "";
      for (const b of mac) binary += String.fromCharCode(b);
      const expected = btoa(binary);
      const expectedBytes = new TextEncoder().encode(expected);
      for (const part of String(signature).split(" ")) {
        const comma = part.indexOf(",");
        if (comma < 0 || part.slice(0, comma) !== "v1") continue;
        const got = new TextEncoder().encode(part.slice(comma + 1));
        if (got.length !== expectedBytes.length) continue;
        let diff = 0;
        for (let i = 0; i < got.length; i++) diff |= got[i] ^ expectedBytes[i];
        if (diff === 0) return true;
      }
      return false;
    });
}

const item = $input.first();
const headers = item.json.headers || {};
let raw;
try {
  raw = (await this.helpers.getBinaryDataBuffer(0, "data")).toString("utf8");
} catch (err) {
  throw new Error("Ative Raw Body nas opções do webhook.");
}
const ok = await guiaflowSignatureOk({
  secret: SECRET,
  id: headers["webhook-id"],
  timestamp: headers["webhook-timestamp"],
  signature: headers["webhook-signature"],
  raw,
  nowSec: Math.floor(Date.now() / 1000),
});
if (!ok) throw new Error("Assinatura do GuiaFlow inválida");

const body = JSON.parse(raw);
const lead = body.lead || {};
const tour = body.tour || {};
const context = body.context || {};
return [
  {
    json: {
      type: body.type || "",
      id: body.id || "",
      createdAt: body.createdAt || "",
      source: body.source || "",
      name: lead.name || "",
      email: lead.email || "",
      phone: lead.phone || "",
      message: lead.message || "",
      lang: lead.lang || "",
      consent: lead.consent && typeof lead.consent === "object" ? Boolean(lead.consent.given) : Boolean(lead.consent),
      tour: tour.title || "",
      tourUrl: tour.url || "",
      slug: tour.slug || "",
      referrerHost: context.referrerHost || "",
      utm_source: context.utm_source || "",
      utm_medium: context.utm_medium || "",
      utm_campaign: context.utm_campaign || "",
      embed: Boolean(context.embed),
      device: context.device || "",
    },
  },
];
