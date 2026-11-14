# MCP Registry: server.json

Entry for `pro.guiaflow/guiaflow` in the official MCP Registry (https://registry.modelcontextprotocol.io).
The remote server is `https://app.guiaflow.pro/mcp`. Its code lives in a private repo, so `repository` points to this public repo (editor, player and docs).

## Republish (only with Gustavo's OK)

1. Bump `version` (the registry rejects a version that is already published).
2. Validate: `curl -s https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` and check with any JSON Schema validator, or run `mcp-publisher validate` if available.
3. Install the publisher: download `mcp-publisher` from https://github.com/modelcontextprotocol/registry/releases (linux/darwin, amd64/arm64).
4. Log in for the `pro.guiaflow` namespace with HTTP domain proof (already live: `https://guiaflow.pro/.well-known/mcp-registry-auth` serves `v=MCPv1; k=ed25519; p=<public key>`):
   `mcp-publisher login http --domain guiaflow.pro --private-key <ed25519 private key hex>`
   The private key is the one used for the first publish. It is never committed.
5. From this folder: `mcp-publisher publish`.
6. Check: `curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=guiaflow"`.
