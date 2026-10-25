import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { signWebhook, verifyStandardWebhook } from "../downloads/webhooks/verify-signature.mjs";

const root = new URL("..", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

const secret = `whsec_${Buffer.from("0123456789abcdef01234567").toString("base64")}`;

function signed(body, { id = "lead_1", seconds = 1_700_000_000, extra = "" } = {}) {
  const signature = [signWebhook(secret, id, seconds, body), extra].filter(Boolean).join(" ");
  return { id, seconds, signature, body };
}

test("assinatura Standard Webhooks: aceita, recusa corpo trocado, assinatura velha e segredo errado", () => {
  const body = JSON.stringify({ type: "lead.created", id: "lead_1" });
  const good = signed(body);
  const now = good.seconds * 1000;
  assert.equal(verifyStandardWebhook({ secret, id: good.id, timestamp: String(good.seconds), signature: good.signature, body, now }), true);
  assert.equal(verifyStandardWebhook({ secret, id: good.id, timestamp: String(good.seconds), signature: good.signature, body: `${body} `, now }), false);
  assert.equal(verifyStandardWebhook({ secret, id: good.id, timestamp: String(good.seconds - 301), signature: signWebhook(secret, good.id, good.seconds - 301, body), body, now }), false);
  assert.equal(verifyStandardWebhook({ secret: `${secret}x`, id: good.id, timestamp: String(good.seconds), signature: good.signature, body, now }), false);
  const rotated = signed(body, { extra: "v1,aaaa" });
  assert.equal(verifyStandardWebhook({ secret, id: rotated.id, timestamp: String(rotated.seconds), signature: `v0,nope ${rotated.signature}`, body, now }), true);
});

test("o nó do n8n confere a mesma assinatura que verify-signature.mjs", async () => {
  const source = read("downloads/webhooks/n8n-verify.js");
  const start = source.indexOf("function guiaflowSignatureOk");
  const end = source.indexOf("const item = $input.first()");
  assert.ok(start > 0 && end > start);
  const fn = new Function(`${source.slice(start, end)}; return guiaflowSignatureOk;`)();
  const body = JSON.stringify({ type: "lead.test", lead: { email: "teste@guiaflow.pro" } });
  const sample = signed(body, { id: "test_1", seconds: 1_700_000_100 });
  const input = {
    secret,
    id: sample.id,
    timestamp: String(sample.seconds),
    signature: sample.signature,
    raw: body,
    nowSec: sample.seconds,
  };
  assert.equal(await fn(input), true);
  assert.equal(await fn({ ...input, raw: "{}" }), false);
  assert.match(source, /webhook-id/);
  assert.match(source, /\$\{id\}\.\$\{ts\}\.\$\{raw\}/);
});

test("a página de receitas está ligada em /integracoes e cita Zapier, Pipefy, planilha e Pipedrive", () => {
  const pt = read("integracoes/leads.html");
  const en = read("en/integrations/leads.html");
  const es = read("es/integraciones/leads.html");
  for (const html of [pt, en, es]) {
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.match(html, /Webhooks by Zapier/);
    assert.match(html, /Pipefy/);
    assert.match(html, /Google Sheets/);
    assert.match(html, /Pipedrive/);
    assert.match(html, /\/downloads\/webhooks\/verify-signature\.mjs/);
    assert.match(html, /\/downloads\/webhooks\/n8n-pipefy\.json/);
    assert.match(html, /\/downloads\/webhooks\/make-pipedrive\.json/);
    assert.match(html, /phase_id|phase/);
    assert.match(html, /"given": true/);
    assert.match(html, /E\.164/);
    assert.equal(html.includes('"consent": true'), false);
    assert.equal(html.includes("utm_term"), false);
    assert.equal(html.includes("{{"), false);
  }
  assert.match(pt, /href="\/integracoes#webhook"/);
  assert.match(read("integracoes.html"), /href="\/integracoes\/leads"/);
  assert.match(read("en/integrations.html"), /href="\/en\/integrations\/leads"/);
  assert.match(read("es/integraciones.html"), /href="\/es\/integraciones\/leads"/);
  assert.match(read("js/leadWebhook.js"), /pt: "\/integracoes\/leads"/);
  assert.match(read("editor.html"), /href="\/integracoes\/leads"/);
  assert.match(read("sitemap.xml"), /guiaflow\.pro\/integracoes\/leads/);
});

test("modelos do n8n e do Make trazem o gatilho, a assinatura e o destino", () => {
  const sheets = JSON.parse(read("downloads/webhooks/n8n-google-sheets.json"));
  const pipefy = JSON.parse(read("downloads/webhooks/n8n-pipefy.json"));
  const pipedrive = JSON.parse(read("downloads/webhooks/n8n-pipedrive.json"));
  for (const flow of [sheets, pipefy, pipedrive]) {
    assert.equal(flow.nodes[0].type, "n8n-nodes-base.webhook");
    assert.equal(flow.nodes[0].parameters.options.rawBody, true);
    assert.match(flow.nodes[1].parameters.jsCode, /guiaflowSignatureOk/);
    assert.equal(flow.connections.GuiaFlow.main[0][0].node, "Verificar assinatura");
  }
  assert.equal(sheets.nodes[2].type, "n8n-nodes-base.googleSheets");
  assert.equal(sheets.nodes[2].parameters.operation, "append");
  assert.match(pipefy.nodes[2].parameters.url, /api\.pipefy\.com\/graphql/);
  assert.match(pipefy.nodes[2].parameters.jsonBody, /createCard/);
  assert.match(pipefy.nodes[2].parameters.jsonBody, /phase_id/);
  assert.match(pipedrive.nodes[2].parameters.url, /\/api\/v2\/persons/);
  assert.match(pipedrive.nodes[3].parameters.url, /\/api\/v1\/leads/);
  assert.match(pipedrive.nodes[3].parameters.jsonBody, /Verificar assinatura/);

  for (const file of ["make-google-sheets.json", "make-pipefy.json", "make-pipedrive.json"]) {
    const blueprint = JSON.parse(read(`downloads/webhooks/${file}`));
    assert.ok(blueprint.name);
    assert.equal(blueprint.flow[0].module, "gateway:CustomWebHook");
    assert.equal(blueprint.flow[1].module, "http:MakeRequest");
    assert.equal(blueprint.flow[1].version, 4);
  }
  const makePipefy = JSON.parse(read("downloads/webhooks/make-pipefy.json"));
  assert.match(makePipefy.flow[1].mapper.body, /createCard/);
  assert.match(makePipefy.flow[1].mapper.url, /api\.pipefy\.com\/graphql/);
  const makeSheets = JSON.parse(read("downloads/webhooks/make-google-sheets.json"));
  assert.match(makeSheets.flow[1].mapper.url, /sheets\.googleapis\.com/);
  const makePipedrive = JSON.parse(read("downloads/webhooks/make-pipedrive.json"));
  assert.match(makePipedrive.flow[1].mapper.url, /\/api\/v2\/persons/);
  assert.match(makePipedrive.flow[2].mapper.url, /\/api\/v1\/leads/);
  assert.match(makePipedrive.flow[2].mapper.body, /\{\{2\.data\.id\}\}/);
});
