#!/usr/bin/env bash
# The release version of the site, locally: what `npm run aws:deploy` would publish, except that
# it talks to the local market API (started here too) instead of the live one.
#   npm run preview:release      → http://localhost:4173
set -euo pipefail
cd "$(dirname "$0")/../.."
H2E_RELEASE=1 NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 npm run build -w frontend
node frontend/scripts/release-check.mjs --preview
npm run dev:api &
API=$!
trap 'kill $API 2>/dev/null || true' EXIT
echo "Release preview at http://localhost:4173 (Ctrl+C to stop)"
python3 -m http.server 4173 --bind 127.0.0.1 -d frontend/out
