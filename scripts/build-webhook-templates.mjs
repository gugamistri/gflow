#!/usr/bin/env node
/**
 * Gera os JSON que a página /integracoes/leads oferece para importar.
 * Rode de novo se mudar o nó de assinatura: node scripts/build-webhook-templates.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "downloads/webhooks");
const verifyCode = readFileSync(join(OUT, "n8n-verify.js"), "utf8");

function n8nWebhook(path, id) {
  return {
    parameters: {
      httpMethod: "POST",
      path,
      responseMode: "lastNode",
      options: { rawBody: true },
    },
    id,
    name: "GuiaFlow",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2.1,
    position: [240, 300],
    webhookId: id,
  };
}

function n8nCode(id, x) {
  return {
    parameters: { mode: "runOnceForAllItems", jsCode: verifyCode },
    id,
    name: "Verificar assinatura",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [x, 300],
  };
}

function n8nHttp({ id, name, x, url, headers, jsonBody }) {
  return {
    parameters: {
      method: "POST",
      url,
      sendHeaders: true,
      headerParameters: { parameters: headers },
      sendBody: true,
      specifyBody: "json",
      jsonBody,
      options: { timeout: 4000 },
    },
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [x, 300],
  };
}

function workflow(name, nodes) {
  const connections = {};
  for (let i = 0; i < nodes.length - 1; i++) {
    connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: "main", index: 0 }]] };
  }
  return {
    name,
    nodes,
    connections,
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
    settings: { executionOrder: "v1" },
  };
}

const sheetsColumns = {
  mappingMode: "defineBelow",
  matchingColumns: [],
  schema: [],
  value: {
    id: "={{ $json.id }}",
    criado_em: "={{ $json.createdAt }}",
    origem: "={{ $json.source }}",
    nome: "={{ $json.name }}",
    email: "={{ $json.email }}",
    telefone: "={{ $json.phone }}",
    mensagem: "={{ $json.message }}",
    tour: "={{ $json.tour }}",
    url: "={{ $json.tourUrl }}",
    utm_source: "={{ $json.utm_source }}",
    utm_medium: "={{ $json.utm_medium }}",
    utm_campaign: "={{ $json.utm_campaign }}",
    referrer: "={{ $json.referrerHost }}",
    consentimento: "={{ $json.consent }}",
  },
};

const pipefyQuery = `mutation ($pipe: ID!, $phase: ID!, $title: String!, $name: String, $email: String, $phone: String) {
  createCard(input: {
    pipe_id: $pipe
    phase_id: $phase
    title: $title
    fields_attributes: [
      { field_id: "nome", field_value: $name }
      { field_id: "email", field_value: $email }
      { field_id: "telefone", field_value: $phone }
    ]
  }) { card { id } }
}`;

const n8n = {
  "n8n-google-sheets.json": workflow("GuiaFlow para Google Sheets", [
    n8nWebhook("guiaflow-sheets", "8f0c1a10-6fe3-4a11-9c01-000000000001"),
    n8nCode("8f0c1a10-6fe3-4a11-9c01-000000000002", 480),
    {
      parameters: {
        operation: "append",
        documentId: { __rl: true, mode: "id", value: "SEU_ID_DA_PLANILHA" },
        sheetName: { __rl: true, mode: "name", value: "Leads" },
        columns: sheetsColumns,
        options: {},
      },
      id: "8f0c1a10-6fe3-4a11-9c01-000000000003",
      name: "Acrescentar linha",
      type: "n8n-nodes-base.googleSheets",
      typeVersion: 4.7,
      position: [740, 300],
    },
  ]),
  "n8n-pipefy.json": workflow("GuiaFlow para Pipefy", [
    n8nWebhook("guiaflow-pipefy", "8f0c1a10-6fe3-4a11-9c02-000000000001"),
    n8nCode("8f0c1a10-6fe3-4a11-9c02-000000000002", 480),
    n8nHttp({
      id: "8f0c1a10-6fe3-4a11-9c02-000000000003",
      name: "Criar card",
      x: 740,
      url: "https://api.pipefy.com/graphql",
      headers: [
        { name: "Authorization", value: "Bearer SEU_TOKEN_PIPEFY" },
        { name: "Content-Type", value: "application/json" },
      ],
      jsonBody: `={{ JSON.stringify({ query: ${JSON.stringify(pipefyQuery)}, variables: { pipe: "0", phase: "0", title: $json.name || $json.email || "Lead GuiaFlow", name: $json.name, email: $json.email, phone: $json.phone } }) }}`,
    }),
  ]),
  "n8n-pipedrive.json": workflow("GuiaFlow para Pipedrive", [
    n8nWebhook("guiaflow-pipedrive", "8f0c1a10-6fe3-4a11-9c03-000000000001"),
    n8nCode("8f0c1a10-6fe3-4a11-9c03-000000000002", 460),
    n8nHttp({
      id: "8f0c1a10-6fe3-4a11-9c03-000000000003",
      name: "Criar pessoa",
      x: 700,
      url: "https://SUA_EMPRESA.pipedrive.com/api/v2/persons",
      headers: [
        { name: "x-api-token", value: "SEU_TOKEN_PIPEDRIVE" },
        { name: "Content-Type", value: "application/json" },
      ],
      jsonBody: `={{ JSON.stringify({ name: $json.name || $json.email || "Lead GuiaFlow", emails: $json.email ? [{ value: $json.email, primary: true }] : undefined, phones: $json.phone ? [{ value: $json.phone, primary: true }] : undefined }) }}`,
    }),
    n8nHttp({
      id: "8f0c1a10-6fe3-4a11-9c03-000000000004",
      name: "Criar lead",
      x: 960,
      url: "https://SUA_EMPRESA.pipedrive.com/api/v1/leads",
      headers: [
        { name: "x-api-token", value: "SEU_TOKEN_PIPEDRIVE" },
        { name: "Content-Type", value: "application/json" },
      ],
      jsonBody: `={{ JSON.stringify({ title: ($("Verificar assinatura").first().json.name || $("Verificar assinatura").first().json.email || "Lead GuiaFlow") + " — " + ($("Verificar assinatura").first().json.tour || "tour"), person_id: $json.data.id, origin_id: String($("Verificar assinatura").first().json.id || "") }) }}`,
    }),
  ]),
};

function webhookModule(id, x) {
  return {
    id,
    module: "gateway:CustomWebHook",
    version: 1,
    parameters: { hook: null, maxResults: 1 },
    mapper: {},
    metadata: {
      designer: { x, y: 0 },
      restore: { parameters: { hook: { label: "Crie um webhook novo ao importar" } } },
    },
  };
}

function httpModule(id, x, url, headers, body) {
  return {
    id,
    module: "http:MakeRequest",
    version: 4,
    parameters: { authenticationType: "noAuth", tlsType: "", proxyKeychain: "" },
    mapper: {
      url,
      method: "post",
      headers,
      qs: [],
      bodyType: "raw",
      contentType: "application/json",
      parseResponse: true,
      body,
    },
    metadata: { designer: { x, y: 0 } },
  };
}

function scenario(name, flow) {
  return {
    name,
    flow,
    metadata: {
      version: 1,
      instant: true,
      scenario: {
        roundtrips: 1,
        maxErrors: 3,
        autoCommit: true,
        autoCommitTriggerLast: true,
        sequential: false,
        confidential: false,
        dataloss: false,
        dlq: false,
        freshVariables: false,
      },
      designer: { orphans: [] },
    },
  };
}

const sheetRow = JSON.stringify({
  values: [[
    "{{1.id}}",
    "{{1.createdAt}}",
    "{{1.source}}",
    "{{1.lead.name}}",
    "{{1.lead.email}}",
    "{{1.lead.phone}}",
    "{{1.lead.message}}",
    "{{1.tour.title}}",
    "{{1.tour.url}}",
    "{{1.context.utm_source}}",
    "{{1.context.utm_medium}}",
    "{{1.context.utm_campaign}}",
    "{{1.context.referrerHost}}",
    "{{1.lead.consent.given}}",
  ]],
});
// Cabeçalhos da aba Leads, nesta ordem: id, criado_em, origem, nome, email, telefone, mensagem, tour, url, utm_source, utm_medium, utm_campaign, referrer, consentimento.

const pipefyBody = JSON.stringify({
  query: pipefyQuery,
  variables: {
    pipe: "0",
    phase: "0",
    title: "{{1.lead.name}}",
    name: "{{1.lead.name}}",
    email: "{{1.lead.email}}",
    phone: "{{1.lead.phone}}",
  },
});

const personBody = JSON.stringify({
  name: "{{1.lead.name}}",
  emails: [{ value: "{{1.lead.email}}", primary: true }],
  phones: [{ value: "{{1.lead.phone}}", primary: true }],
});

const leadBody = JSON.stringify({
  title: "{{1.tour.title}} — {{1.lead.email}}",
  person_id: "{{2.data.id}}",
  origin_id: "{{1.id}}",
});

const make = {
  "make-google-sheets.json": scenario("GuiaFlow para Google Sheets", [
    webhookModule(1, 0),
    httpModule(
      2,
      320,
      "https://sheets.googleapis.com/v4/spreadsheets/SEU_ID_DA_PLANILHA/values/Leads!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
      [
        { name: "Authorization", value: "Bearer SEU_TOKEN_GOOGLE" },
        { name: "Content-Type", value: "application/json" },
      ],
      sheetRow,
    ),
  ]),
  "make-pipefy.json": scenario("GuiaFlow para Pipefy", [
    webhookModule(1, 0),
    httpModule(
      2,
      320,
      "https://api.pipefy.com/graphql",
      [
        { name: "Authorization", value: "Bearer SEU_TOKEN_PIPEFY" },
        { name: "Content-Type", value: "application/json" },
      ],
      pipefyBody,
    ),
  ]),
  "make-pipedrive.json": scenario("GuiaFlow para Pipedrive", [
    webhookModule(1, 0),
    httpModule(
      2,
      320,
      "https://SUA_EMPRESA.pipedrive.com/api/v2/persons",
      [
        { name: "x-api-token", value: "SEU_TOKEN_PIPEDRIVE" },
        { name: "Content-Type", value: "application/json" },
      ],
      personBody,
    ),
    httpModule(
      3,
      640,
      "https://SUA_EMPRESA.pipedrive.com/api/v1/leads",
      [
        { name: "x-api-token", value: "SEU_TOKEN_PIPEDRIVE" },
        { name: "Content-Type", value: "application/json" },
      ],
      leadBody,
    ),
  ]),
};

for (const [file, data] of Object.entries({ ...n8n, ...make })) {
  writeFileSync(join(OUT, file), `${JSON.stringify(data, null, 2)}\n`);
}
console.log(`webhook templates: ${Object.keys(n8n).length + Object.keys(make).length} arquivos`);
