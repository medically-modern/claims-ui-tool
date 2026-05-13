#!/usr/bin/env bash
# Refresh the Monday board schema reference doc.
#
# Reads the Claims Board (18245429780) and Subitems board (18245429979) via
# the Monday GraphQL API and writes MONDAY_BOARD_SCHEMA.md at the repo root.
#
# Requires: MONDAY_API_TOKEN env var. Get a token from
# https://medicallymodern-force.monday.com → avatar → Developers → My Access Tokens.
#
# Usage:
#   MONDAY_API_TOKEN="eyJ..." ./scripts/refresh-monday-schema.sh
# Or put the token in a .env file at the repo root (gitignored) and:
#   set -a; source .env; set +a
#   ./scripts/refresh-monday-schema.sh
#
# The script writes to ./MONDAY_BOARD_SCHEMA.md. That file is gitignored — it
# lives in your working copy as a local reference only.

set -euo pipefail

if [[ -z "${MONDAY_API_TOKEN:-}" ]]; then
  echo "Error: MONDAY_API_TOKEN env var is not set." >&2
  echo "Get a token at https://medicallymodern-force.monday.com → Developers → My Access Tokens." >&2
  exit 1
fi

# Resolve repo root from this script's location (script lives in scripts/)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/MONDAY_BOARD_SCHEMA.md"
RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT

QUERY='{"query":"query { boards(ids: [18245429780, 18245429979, 18413019028, 18413019033]) { id name description state board_kind board_folder_id type item_terminology items_count updated_at workspace { id name kind } owners { id name email } groups { id title color position archived } columns { id title type description settings_str archived width } } }"}'

echo "Fetching Monday board schema..." >&2
HTTP_CODE=$(curl -sS -o "$RAW" -w "%{http_code}" \
  -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "API-Version: 2024-10" \
  -d "$QUERY")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Error: Monday API returned HTTP $HTTP_CODE" >&2
  cat "$RAW" >&2
  exit 1
fi

# Sanity-check the response
if grep -q '"errors"' "$RAW"; then
  echo "Error: Monday API returned errors:" >&2
  cat "$RAW" >&2
  exit 1
fi

echo "Formatting schema..." >&2
python3 "${ROOT}/scripts/format-monday-schema.py" < "$RAW" > "$OUT"

echo "Wrote $OUT"
wc -l "$OUT"
