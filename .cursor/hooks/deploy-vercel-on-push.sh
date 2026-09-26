#!/usr/bin/env bash
# why: após git push bem-sucedido no Cursor, publica produção no Vercel (guiaflow)
set -euo pipefail

input=$(cat)
parsed=$(printf '%s' "$input" | python3 -c '
import json, sys
d = json.load(sys.stdin)
cmd = d.get("command") or ""
code = d.get("exit_code", d.get("exitCode", 0))
try:
    code = int(float(code))
except Exception:
    code = 1
print(code)
print(cmd)
')

exit_code=$(printf '%s\n' "$parsed" | sed -n '1p')
command=$(printf '%s\n' "$parsed" | sed -n '2,$p')

if [[ "$exit_code" != "0" ]]; then
  exit 0
fi
if ! [[ "$command" =~ git[[:space:]]+push ]]; then
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI não encontrado; pulando deploy" >&2
  exit 0
fi

# hazard: produção — só após push com exit 0
vercel deploy --prod --yes --cwd "$ROOT" >&2 || {
  echo "Falha no deploy Vercel após git push" >&2
  exit 0
}

exit 0
