# GuiaFlow Cloud

Este arquivo marca a fronteira entre o editor aberto e o companheiro privado **GuiaFlow Cloud**. Este repositório não embute chave paga. A nuvem só é chamada quando há um URL base configurado.

O editor público está em [https://guiaflow.pro](https://guiaflow.pro). O host antigo `guiaflow-seven.vercel.app` redireciona para esse domínio, preservando caminho e query.

**Operadores:** a base HTTP da nuvem não entra na interface. Fica em `window.__GUIAFLOW_CLOUD__` (`https://app.guiaflow.pro`). O apex `guiaflow.pro` continua a ser o editor gratuito. A cópia do produto fala em GuiaFlow e guiaflow.pro.

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

`js/cloudConfig.js` lê o URL base e, se ele existir, `cloudFetch` fala com essa base. Não há Stripe, `AUTH_SECRET` nem chave secreta neste repositório. O bearer da sessão fica só no `localStorage` do navegador (`guiaflow.cloud.session`).

O URL base vem de um destes lugares (endereço, nunca chave):

1. `window.__GUIAFLOW_CLOUD__` — uma string `https://…` ou `{ baseUrl, flags? }`
2. `<meta name="guiaflow-cloud-base" content="https://…">`
3. `localStorage["guiaflow.cloud.baseUrl"]`

No editor publicado (`guiaflow.pro`) a página define `window.__GUIAFLOW_CLOUD__ = "https://app.guiaflow.pro"` quando ninguém definiu antes. O mesmo vale se o HTML ainda for servido em `guiaflow-seven.vercel.app`, antes do redirecionamento. Um global já definido — por exemplo o host anterior — fica como está. Meta e `localStorage["guiaflow.cloud.baseUrl"]` valem quando o global não está definido. Em `localhost` e no app desktop a página não injeta base: o preview no Blob continua a ser o único caminho.

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

1. **Preview temporário** — o fluxo Blob de 7 dias, como antes. Não muda.
2. **Link permanente** — **Compartilhar na nuvem**.

Se `localStorage["guiaflow.cloud.session"]` já tem um access token que ainda vale (JWT com `exp` no futuro, ou token opaco sem `exp`), o painel mostra «Conectado como {email}» e o clique publica direto. Não pede email nem para colar um link.

Sem sessão, o diálogo **Entrar** pede email e senha e chama `POST /auth/login` com `{ email, password }`. Se a resposta trouxer `accessToken`, a sessão fica gravada na hora. Se trouxer `code` ou um URL de regresso, vale o passo do callback abaixo. Email ou senha incorretos — inclusive conta sem senha — mostram um erro que aponta para o link.

**Entrar sem senha** chama `POST /auth/magic-link` com `{ email, redirect }`. `redirect` é `https://guiaflow.pro/auth/callback` no site publicado (noutra origem de desenvolvimento, a mesma origem com esse caminho). Depois do envio: «Enviamos um link para {email}.» O mesmo link cria a conta ou entra pela primeira vez.

O browser, depois de confirmar o email ou de entrar com senha na nuvem, abre `https://guiaflow.pro/auth/callback?code=…`. O code é de uso único e dura cerca de 2 minutos. `auth/callback.html` faz `POST {base}/auth/callback` com `{ code }`, grava `accessToken` em `guiaflow.cloud.session` e volta à raiz do editor (`location.replace`). O code não fica na barra. Se a troca falhar, a raiz mostra o erro no painel. Com intenção de publicar ainda válida, a raiz continua o link permanente. Outra aba do mesmo navegador ouve `storage` e também pode publicar; só uma reclama a intenção.

Noutro aparelho, «O link abriu noutro aparelho?» ainda aceita colar um link antigo. Esse atalho não é o caminho principal.

Com sessão, `POST /shares` envia `{ title, tour }` e mostra o `url` que a nuvem devolve, com botão de copiar. `share_limit` aparece como «Limite de links do plano Free» ou «Limite de links do plano Cloud». `401` apaga a sessão e pede para entrar de novo. Falha de rede diz que não foi possível contactar a nuvem.

O JSON público não leva `writeToken` nem o bearer. Exportar HTML, vídeo ou JSON local não depende da nuvem.

`401` apaga a sessão e abre **Entrar**. `402` com `code: "subscription_required"` abre o diálogo de assinatura (Mensal ou Anual, sem preço no editor). `429` com `quota_exceeded` avisa que a cota do mês acabou. `503` diz que está indisponível no momento. O preview de 7 dias não passa por esse gate.

### Assinatura

O editor não calcula preço e não guarda segredo de pagamento. Com sessão, o menu da conta lê `GET /billing/entitlement`. Plano `cloud` com assinatura ativa mostra **Cloud** e **Gerenciar assinatura** (`POST /billing/portal` → `{ "portal": { "url" } }`). Plano livre mostra **Grátis** e **Assinar Cloud**.

`POST /billing/checkout` com `{ "interval": "monthly" | "annual" }` devolve `{ "checkout": { "url" } }`. O browser segue esse URL se for `http:` ou `https:`.

Regresso em `https://guiaflow.pro`:

- `/?billing=success&session_id={CHECKOUT_SESSION_ID}` — `GET /billing/entitlement?session_id=cs_…`. Se `active` for verdadeiro, o aviso diz que a assinatura está ativa. A query sai da barra.
- `/?billing=cancel` — aviso neutro, sem chamar o checkout de novo.
- `/?billing=portal` — só volta a ler o entitlement.

Se `/billing/entitlement` responder `404` ou `503`, a linha do plano some e o link permanente segue o comportamento anterior. O link temporário continua grátis.

Forma lida do entitlement (corpo direto ou em `entitlement` / `subscription`): `{ "plan": "free"|"cloud", "status": "active"|"trialing"|"past_due"|"canceled"|"none", "active": true|false, "interval": "monthly"|"annual"|null }`. `active: false` manda, mesmo que `plan` ainda diga `cloud`.

## Contrato para operadores (`guiaflow-cloud`)

Esta secção não é cópia de produto. O host abaixo é a base HTTP; a pessoa que usa o editor não o vê.

`AUTH_BASE_URL` é a base dos pedidos do servidor (`https://app.guiaflow.pro`). O link do email volta ao editor em `https://guiaflow.pro/auth/callback`. Não abre essa base nem uma página que se apresente como «API».

Contrato alinhado ao PR `guiaflow-cloud` #5. Depois de confirmar o link mágico ou de entrar com senha, o browser abre:

`https://guiaflow.pro/auth/callback?code={code}`

O code é de uso único e expira em cerca de 2 minutos. O editor não mostra o host da base HTTP.

`POST /auth/magic-link`

```json
{ "email": "pessoa@example.com", "redirect": "https://guiaflow.pro/auth/callback" }
```

`POST /auth/login` (quem já tem senha, a partir do editor)

```json
{ "email": "pessoa@example.com", "password": "…" }
```

Resposta com sessão direta: `{ "accessToken": "…", "user": { "email": "…" } }`. Em alternativa, `{ "code": "…" }` ou `{ "redirect": "https://guiaflow.pro/auth/callback?code=…" }`. `401` é email ou senha incorretos.

`POST /auth/callback`

```json
{ "code": "…" }
```

Resposta: `{ "accessToken": "…", "user": { "email": "…" } }`. O editor grava só isso em `localStorage["guiaflow.cloud.session"]` e substitui o endereço por `https://guiaflow.pro/`.

`redirect`, quando a nuvem o honrar, só pode ser a origem do editor mais `/auth/callback`. Allowlist (qualquer outra origem é open redirect — responder `400` e não redirecionar):

- `https://guiaflow.pro/auth/callback`
- `https://guiaflow-seven.vercel.app/auth/callback` (legado; redireciona para o apex e preserva a query)
- `http://localhost` e `http://127.0.0.1`, com qualquer porta, só em desenvolvimento

Um email antigo que ainda aponte para `{AUTH_BASE_URL}/auth/verify?token=` continua a poder ser colado no atalho do editor. A interface não mostra esse endereço.

## English

**The editor stays free forever under MIT.** This repo (`gflow`) remains open source for the editor and the player. There is no hard dependency on a private companion.

**BYOK stays in this OSS repo.** AI and TTS keep using your own keys through `js/llm.js`, `js/cartesia.js`, and their stores. Cloud must not remove or break that path.

**GuiaFlow Cloud** is a private companion (not part of this MIT repo; product name `guiaflow-cloud`). It may later add hosted AI without BYOK, hosted TTS, permanent shares, branding, and analytics.

With no Cloud base URL every flag is false and helpers do not touch the network. The canonical editor is `https://guiaflow.pro` (`guiaflow-seven.vercel.app` redirects there). The published editor sets `window.__GUIAFLOW_CLOUD__` to `https://app.guiaflow.pro` for operators; that host is not shown in the product UI. Apex `guiaflow.pro` stays the free editor. A global set earlier stays in place, including a previous host. Meta and `guiaflow.cloud.baseUrl` apply when the global is unset. Localhost and the desktop app stay Blob-only. A stored `guiaflow.cloud.session` skips sign-in and publishes immediately («Connected as …»). Otherwise the Entrar dialog posts `{ email, password }` to `/auth/login`. **Sign in without a password** posts `{ email, redirect }` to `/auth/magic-link`, with `redirect` ending in `/auth/callback`; the same link creates the account. After email confirm or password login, the browser lands on `/auth/callback?code=…`; the editor `POST`s that code to `{base}/auth/callback`, stores `accessToken`, and returns to `/`. `callCloud` stays a stub for hosted AI, TTS, branding, and analytics. The 7-day Vercel Blob preview on this app (`/v/:id`) is unchanged. A `402` `subscription_required` opens the upgrade dialog. Checkout, the billing portal, and `GET /billing/entitlement` are UI hooks only; a `404` on entitlement hides the plan line. Return URLs are `/?billing=success&session_id=cs_…`, `/?billing=cancel`, and `/?billing=portal`.
