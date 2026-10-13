# GuiaFlow Pro

**English** | [Português](CLOUD.pt-BR.md)

This file marks the boundary between the open editor and the paid **GuiaFlow Pro** plan. The companion code lives in the `guiaflow-cloud` repository. This repository embeds no paid key. The HTTP base is only called when it is configured.

The public editor is at [https://guiaflow.pro](https://guiaflow.pro). The old host `guiaflow-seven.vercel.app` redirects to that domain, preserving path and query.

**Operators:** the cloud HTTP base is not part of the UI. It lives in `window.__GUIAFLOW_CLOUD__` (`https://app.guiaflow.pro`). The apex `guiaflow.pro` remains the free editor. Product copy says GuiaFlow and guiaflow.pro.

## Promise

**The editor is free forever and stays MIT.** This repository (`gflow`) remains open source for the editor and the player. There is no hard dependency on a private repository.

**BYOK stays here.** Anyone who wants AI or voice brings their own key through the existing modules: `js/llm.js`, `js/cartesia.js`, and the stores `js/llm-store.js` and `js/cartesia-store.js`. Cloud does not remove or break that path.

**GuiaFlow Pro** is the paid plan. Its code lives in another repository, outside this MIT repo (named `guiaflow-cloud`). It is optional. It may add:

- AI without BYOK (hosted)
- hosted TTS
- permanent shares
- branding
- analytics

## What stays open and what Cloud adds

| | In this repository (MIT) | Private companion (not part of this repo) |
| --- | --- | --- |
| Editor and player | Free forever | Does not replace the open editor |
| AI | Your key (BYOK) | Hosted AI, no key in the browser |
| TTS | Your key (BYOK) | Hosted voice |
| Sharing | Temporary preview (Vercel Blob), 7 days | Permanent link (`POST /shares`) when the base URL is configured |
| Branding | The tour's own themes | Account branding |
| Analytics | No | Usage of the published tour |

The 7-day preview in `publishShareLink` (`js/share.js`) does not change. The permanent link is a separate path, only when the base URL exists and the `permanentShare` flag is on.

## Hooks

`js/cloudConfig.js` reads the base URL and, if present, `cloudFetch` talks to that base. There is no Stripe, `AUTH_SECRET`, or secret key in this repository. The session bearer lives only in the browser's `localStorage` (`guiaflow.cloud.session`).

The base URL comes from one of these places (an address, never a key):

1. `window.__GUIAFLOW_CLOUD__` — a `https://…` string or `{ baseUrl, flags? }`
2. `<meta name="guiaflow-cloud-base" content="https://…">`
3. `localStorage["guiaflow.cloud.baseUrl"]`

On the published editor (`guiaflow.pro`) the page sets `window.__GUIAFLOW_CLOUD__ = "https://app.guiaflow.pro"` when nothing set it before. The same applies if the HTML is still served on `guiaflow-seven.vercel.app`, before the redirect. A global already set — for example the previous host — stays as is. Meta and `localStorage["guiaflow.cloud.baseUrl"]` apply when the global is unset. On `localhost` and in the desktop app the page injects no base: the Blob preview remains the only path.

Userinfo, query, and hash are discarded. A value that is not `http:` or `https:` counts as absent.

Without a base URL:

- `isCloudEnabled()` returns `false`
- `getCloudFlags()` returns all five flags as `false`
- `callCloud` / `cloudFetch` return `{ ok: false, stub: true, reason: "cloud-not-configured" }` and do not call `fetch`
- the Share menu shows only the temporary preview

With a base URL, the flags read as available (`true`). You can turn one off with `flags: { permanentShare: false }`. `cloudFetch` makes the HTTP request (Bearer if there is a session). `callCloud` remains a stub `{ ok: false, stub: true, reason: "not-implemented" }` for what this repo does not wire up: hosted AI, TTS, branding, and analytics.

Flags: `hostedAi`, `tts`, `permanentShare`, `branding`, `analytics`.

### Permanent link

In the **Share** menu, with the cloud enabled:

1. **Temporary preview** — the 7-day Blob flow, as before. Unchanged.
2. **Permanent link** — **Share to cloud**.

If `localStorage["guiaflow.cloud.session"]` already has a valid access token (JWT with `exp` in the future, or an opaque token without `exp`), the panel shows «Connected as {email}» and the click publishes directly. It does not ask for an email or for a pasted link.

Without a session, the **Sign in** dialog asks for email and password and calls `POST /auth/login` with `{ email, password }`. If the response has `accessToken`, the session is stored immediately. If it has `code` or a return URL, the callback step below applies. Wrong email or password — including an account without a password — shows an error pointing to the link.

**Sign in without a password** calls `POST /auth/magic-link` with `{ email, redirect }`. `redirect` is `https://guiaflow.pro/auth/callback` on the published site (on another development origin, that same origin with this path). After sending: «We sent a link to {email}.» The same link creates the account or signs in for the first time.

After confirming the email or signing in with a password on the cloud, the browser opens `https://guiaflow.pro/auth/callback?code=…`. The code is single-use and lasts about 2 minutes. `auth/callback.html` does `POST {base}/auth/callback` with `{ code }`, stores `accessToken` in `guiaflow.cloud.session`, and returns to the editor root (`location.replace`). The code does not stay in the address bar. If the exchange fails, the root shows the error in the panel. With a still-valid intent to publish, the root continues the permanent link. Another tab in the same browser listens to `storage` and can also publish; only one claims the intent.

On another device, «Did the link open on another device?» still accepts pasting an old link. That shortcut is not the main path.

With a session, `POST /shares` sends `{ title, tour }` and shows the `url` the cloud returns, with a copy button. `share_limit` appears as the Free or Pro plan link limit. `401` clears the session and asks to sign in again. A network failure says the cloud could not be reached.

The public JSON carries neither `writeToken` nor the bearer. Exporting HTML, video, or local JSON does not depend on the cloud.

`401` clears the session and opens **Sign in**. `402` with `code: "subscription_required"` opens the subscription dialog (Monthly or Annual, no price in the editor). `429` with `quota_exceeded` warns that the monthly quota is used up. `503` says it is unavailable right now. The 7-day preview does not go through this gate.

### Subscription

The editor does not compute prices and does not store payment secrets. With a session, the account menu reads `GET /billing/entitlement`. Plan `cloud` with an active subscription shows **Pro** and **Manage subscription** (`POST /billing/portal` → `{ "portal": { "url" } }`). The free plan shows **Free** and **Subscribe to Pro**. In the UI the paid plan is called GuiaFlow Pro. The API field remains `plan: "cloud"`.

`POST /billing/checkout` with `{ "interval": "monthly" | "annual" }` returns `{ "checkout": { "url" } }`. The browser follows that URL if it is `http:` or `https:`.

Return on `https://guiaflow.pro`:

- `/?billing=success&session_id={CHECKOUT_SESSION_ID}` — `GET /billing/entitlement?session_id=cs_…`. If `active` is true, the notice says the subscription is active. The query is removed from the address bar.
- `/?billing=cancel` — neutral notice, without calling checkout again.
- `/?billing=portal` — just reads the entitlement again.

If `/billing/entitlement` responds `404` or `503`, the plan line disappears and the permanent link keeps the previous behavior. The temporary link stays free.

Entitlement shape read (direct body or in `entitlement` / `subscription`): `{ "plan": "free"|"cloud", "status": "active"|"trialing"|"past_due"|"canceled"|"none", "active": true|false, "interval": "monthly"|"annual"|null }`. `active: false` wins, even if `plan` still says `cloud`.

## Operator contract (`guiaflow-cloud`)

This section is not product copy. The host below is the HTTP base; the person using the editor does not see it.

`AUTH_BASE_URL` is the base for server requests (`https://app.guiaflow.pro`). The email link returns to the editor at `https://guiaflow.pro/auth/callback`. It does not open that base nor a page presenting itself as an «API».

Contract aligned with `guiaflow-cloud` PR #5. After confirming the magic link or signing in with a password, the browser opens:

`https://guiaflow.pro/auth/callback?code={code}`

The code is single-use and expires in about 2 minutes. The editor does not show the HTTP base host.

`POST /auth/magic-link`

```json
{ "email": "pessoa@example.com", "redirect": "https://guiaflow.pro/auth/callback" }
```

`POST /auth/login` (for users who already have a password, from the editor)

```json
{ "email": "pessoa@example.com", "password": "…" }
```

Response with a direct session: `{ "accessToken": "…", "user": { "email": "…" } }`. Alternatively, `{ "code": "…" }` or `{ "redirect": "https://guiaflow.pro/auth/callback?code=…" }`. `401` means wrong email or password.

`POST /auth/callback`

```json
{ "code": "…" }
```

Response: `{ "accessToken": "…", "user": { "email": "…" } }`. The editor stores only that in `localStorage["guiaflow.cloud.session"]` and replaces the address with `https://guiaflow.pro/`.

`redirect`, when the cloud honors it, may only be the editor origin plus `/auth/callback`. Allowlist (any other origin is an open redirect — respond `400` and do not redirect):

- `https://guiaflow.pro/auth/callback`
- `https://guiaflow-seven.vercel.app/auth/callback` (legacy; redirects to the apex and preserves the query)
- `http://localhost` and `http://127.0.0.1`, any port, development only

An old email still pointing to `{AUTH_BASE_URL}/auth/verify?token=` can still be pasted into the editor shortcut. The UI does not show that address.
