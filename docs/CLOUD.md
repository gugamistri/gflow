# GuiaFlow Cloud

Este arquivo marca a fronteira entre o editor aberto e o companheiro privado **GuiaFlow Cloud**. Este repositório não embute chave paga. A API Cloud só é chamada quando há um URL base configurado.

O editor público está em [https://guiaflow.pro](https://guiaflow.pro) e em [https://guiaflow-seven.vercel.app](https://guiaflow-seven.vercel.app). A API Cloud está em [https://api.guiaflow.pro](https://api.guiaflow.pro).

## Promessa

**O editor é gratuito para sempre e continua MIT.** Este repositório (`gflow`) permanece código aberto para o editor e o player. Não há dependência obrigatória de um repositório privado.

**BYOK continua aqui.** Quem quiser IA ou voz traz a própria chave pelos módulos que já existem: `js/llm.js`, `js/cartesia.js` e os stores `js/llm-store.js` e `js/cartesia-store.js`. O Cloud não remove nem quebra esse caminho.

**GuiaFlow Cloud** é um companheiro privado, noutro código, fora deste repositório MIT (o nome do produto é `guiaflow-cloud`). Ele é opcional. Pode acrescentar:

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
| Compartilhar | Preview temporário (Vercel Blob), 7 dias | Link permanente (`POST /shares`) quando a URL base está configurada |
| Marca | Temas do próprio tour | Branding da conta |
| Analytics | Não | Uso do tour publicado |

O preview de 7 dias em `publishShareLink` (`js/share.js`) não muda. O link permanente é um caminho à parte, só quando a URL base existe e a flag `permanentShare` está ligada.

## Hooks

`js/cloudConfig.js` lê o URL base e, se ele existir, `cloudFetch` fala com essa API. Não há Stripe, `AUTH_SECRET` nem chave de API neste repositório. O bearer da sessão fica só no `localStorage` do navegador (`guiaflow.cloud.session`).

O URL base vem de um destes lugares (endereço, nunca chave):

1. `window.__GUIAFLOW_CLOUD__` — uma string `https://…` ou `{ baseUrl, flags? }`
2. `<meta name="guiaflow-cloud-base" content="https://…">`
3. `localStorage["guiaflow.cloud.baseUrl"]`

No app publicado (`guiaflow-seven.vercel.app` e `guiaflow.pro`) o editor define `window.__GUIAFLOW_CLOUD__ = "https://api.guiaflow.pro"` quando ninguém definiu antes. Em `localhost` e no app desktop isso não acontece: o preview no Blob continua a ser o único caminho.

Userinfo, query e hash são descartados. Um valor que não seja `http:` ou `https:` conta como ausente.

Sem URL base:

- `isCloudEnabled()` devolve `false`
- `getCloudFlags()` devolve as cinco flags em `false`
- `callCloud` / `cloudFetch` devolvem `{ ok: false, stub: true, reason: "cloud-not-configured" }` e não chamam `fetch`
- o menu Compartilhar mostra só o preview temporário

Com URL base, as flags passam a ler como disponíveis (`true`). Dá para desligar uma delas com `flags: { permanentShare: false }`. `cloudFetch` faz o pedido HTTP (Bearer se houver sessão). `callCloud` continua stub `{ ok: false, stub: true, reason: "not-implemented" }` para o que este repo não liga: IA hospedada, TTS, marca e analytics.

Flags: `hostedAi`, `tts`, `permanentShare`, `branding`, `analytics`.

### Link permanente

No menu **Compartilhar**, com a nuvem ligada:

1. **Preview temporário** — o fluxo Blob de 7 dias, como antes.
2. **Link permanente** — **Compartilhar na nuvem**.

Se não houver sessão, o painel pede o email (`POST /auth/magic-link`) e o link que chega no email. O editor confirma com `POST /auth/verify` e guarda o JWT. A página `https://api.guiaflow.pro/auth/verify` também entra na conta, mas a sessão dela fica no host da API; por isso a publicação continua quando o link do email é colado aqui.

Com sessão, `POST /shares` envia `{ title, tour }` e mostra o `url` (`https://api.guiaflow.pro/v/{slug}`) com botão de copiar. `share_limit` aparece como «Limite de links do plano Free» ou «Limite de links do plano Cloud». `401` pede para entrar de novo. Falha de rede diz que não foi possível contactar a nuvem.

O JSON público não leva `writeToken` nem o bearer. Exportar HTML, vídeo ou JSON local não depende da nuvem.

## English

**The editor stays free forever under MIT.** This repo (`gflow`) remains open source for the editor and the player. There is no hard dependency on a private companion.

**BYOK stays in this OSS repo.** AI and TTS keep using your own keys through `js/llm.js`, `js/cartesia.js`, and their stores. Cloud must not remove or break that path.

**GuiaFlow Cloud** is a private companion (not part of this MIT repo; product name `guiaflow-cloud`). It may later add hosted AI without BYOK, hosted TTS, permanent shares, branding, and analytics.

With no Cloud API base URL every flag is false and helpers do not touch the network. The published editor sets the base URL to `https://api.guiaflow.pro`; localhost and the desktop app stay Blob-only. Permanent share URLs are `https://api.guiaflow.pro/v/{slug}`. `cloudFetch` performs the permanent-share and magic-link calls. `callCloud` stays a stub for hosted AI, TTS, branding, and analytics. The 7-day Vercel Blob preview on this app (`/v/:id`) is unchanged.
