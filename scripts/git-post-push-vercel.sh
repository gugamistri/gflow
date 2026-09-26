#!/usr/bin/env bash
# why: post-push local — publica no Vercel quando o push do git termina com sucesso
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "$ROOT"

if ! command -v vercel >/dev/null 2>&1; then
  echo "post-push: vercel CLI não encontrado; pulando deploy" >&2
  exit 0
fi

echo "post-push: publicando produção no Vercel (guiaflow)..." >&2
vercel deploy --prod --yes --cwd "$ROOT" >&2 || {
  echo "post-push: falha no deploy Vercel (push do git já concluído)" >&2
  exit 0
}
