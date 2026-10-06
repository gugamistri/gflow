# GuiaFlow Cloud

Este arquivo marca a fronteira entre o editor aberto e o companheiro privado **GuiaFlow Cloud**. Nada neste repositório chama uma API paga.

O app público continua em [https://guiaflow-seven.vercel.app](https://guiaflow-seven.vercel.app).

## Promessa

**O editor é gratuito para sempre e continua MIT.** Este repositório (`gflow`) permanece código aberto para o editor e o player. Não há dependência obrigatória de um repositório privado.

**BYOK continua aqui.** Quem quiser IA ou voz traz a própria chave pelos módulos que já existem: `js/llm.js`, `js/cartesia.js` e os stores `js/llm-store.js` e `js/cartesia-store.js`. O Cloud não remove nem quebra esse caminho.

**GuiaFlow Cloud** é um companheiro privado, noutro código, fora deste repositório MIT (o nome do produto é `guiaflow-cloud`). Ele é opcional. Quando existir, pode acrescentar:

- IA sem BYOK (hospedada)
- TTS hospedado
- compartilhamentos permanentes
- marca (branding)
- analytics

## O que fica aberto e o que o Cloud acrescenta

| | Neste repositório (MIT) | Companheiro privado (não faz parte deste repo) |
| --- | --- | --- |
| Editor e player | Gratuitos para sempre | Não substitui o editor aberto |
| IA | A sua chave (BYOK) | IA hospedada, sem a chave no browser |
| TTS | A sua chave (BYOK) | Voz hospedada |
| Compartilhar | Preview temporário (Vercel Blob), como hoje | Links permanentes |
| Marca | Temas do próprio tour | Branding da conta |
| Analytics | Não | Uso do tour publicado |

O link de preview em `js/share.js` não muda. Este repositório não implementa compartilhamento permanente contra o Cloud.

## Hooks

`js/cloudConfig.js` só prepara o encaixe. Os helpers são stubs: não há Stripe, segredo, nem `fetch`.

O URL base da API, se um dia for configurado, vem só de um destes lugares (endereço, nunca chave):

1. `window.__GUIAFLOW_CLOUD__` — uma string `https://…` ou `{ baseUrl, flags? }`
2. `<meta name="guiaflow-cloud-base" content="https://…">`
3. `localStorage["guiaflow.cloud.baseUrl"]`

Userinfo, query e hash são descartados. Um valor que não seja `http:` ou `https:` conta como ausente.

Sem URL base:

- `isCloudEnabled()` devolve `false`
- `getCloudFlags()` devolve as cinco flags em `false`
- `callCloud` / `cloudFetch` devolvem `{ ok: false, stub: true, reason: "cloud-not-configured" }`

Com URL base, as flags passam a ler como disponíveis (`true`), ainda assim só como stub. Dá para desligar uma delas com `flags: { tts: false }`. A chamada continua sem rede e devolve `{ ok: false, stub: true, reason: "not-implemented" }`. A ligação real fica para depois, fora deste código MIT.

Flags: `hostedAi`, `tts`, `permanentShare`, `branding`, `analytics`.

Nenhum fluxo de LLM, Cartesia ou share consulta essas flags hoje. O editor só importa o módulo para o deixar disponível em `window.GuiaFlowCloud`.

## English

**The editor stays free forever under MIT.** This repo (`gflow`) remains open source for the editor and the player. There is no hard dependency on a private companion.

**BYOK stays in this OSS repo.** AI and TTS keep using your own keys through `js/llm.js`, `js/cartesia.js`, and their stores. Cloud must not remove or break that path.

**GuiaFlow Cloud** is a private companion (not part of this MIT repo; product name `guiaflow-cloud`). It may later add hosted AI without BYOK, hosted TTS, permanent shares, branding, and analytics.

Hooks here are stubs. With no Cloud API base URL every flag is false and helpers no-op. With a base URL set, flags may read as available, but `callCloud` / `cloudFetch` still return `{ ok: false, stub: true, reason: "not-implemented" }` and do not touch the network. The existing Vercel Blob preview share stays as it is.
