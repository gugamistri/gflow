# MCP Registry: server.json

Entry for `pro.guiaflow/guiaflow` in the official MCP Registry (https://registry.modelcontextprotocol.io).
The remote server is `https://app.guiaflow.pro/mcp`. Its code lives in a private repo, so `repository` points to this public repo (editor, player and docs).

Authentication for the `pro.guiaflow` namespace uses the HTTP domain method: `https://guiaflow.pro/.well-known/mcp-registry-auth` serves `v=MCPv1; k=ed25519; p=<public key>` as `text/plain` (see `vercel.json`). There is no MCP TXT record on the apex; do not add one without a separate DNS approval.

A new Ed25519 key can replace the current one by updating that well-known file and logging in with the matching private key. The registry verifies the key currently published on the domain, not the key used for the first publish. Keep a single proof record in the file (a stale first line can fail verification on some registry versions).

## Republish (only with Gustavo's OK)

1. Bump `version` (the registry rejects a version that is already published).
2. Validate: `mcp-publisher validate` (or check `server.json` against https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json).
3. Install the publisher: download `mcp-publisher` from https://github.com/modelcontextprotocol/registry/releases (linux/darwin, amd64/arm64).
4. Log in with the HTTP domain proof:
   `mcp-publisher login http --domain guiaflow.pro --private-key <ed25519 private key hex>`
   The private key is never committed.
5. From this folder: `mcp-publisher publish`.
6. Check: `curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=guiaflow"`.
