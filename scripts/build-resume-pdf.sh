#!/usr/bin/env bash
#
# Rebuilds the downloadable résumé PDF from resume.html, which renders from
# data/data.json. Run this after editing the skills or resume sections of
# data/data.json, then commit the regenerated PDF.
#
# Usage: ./scripts/build-resume-pdf.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/jereme-hancock-resume.pdf"
PORT="${PORT:-8765}"

CHROME=""
for candidate in chromium chromium-browser google-chrome-stable google-chrome; do
	if command -v "$candidate" >/dev/null 2>&1; then
		CHROME="$candidate"
		break
	fi
done

if [ -z "$CHROME" ]; then
	echo "error: no Chromium or Chrome binary found on PATH" >&2
	exit 1
fi

# resume.html fetches data/data.json, so it needs a real origin, not file://.
python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
	if curl -fsS "http://127.0.0.1:$PORT/resume.html" >/dev/null 2>&1; then
		break
	fi
	sleep 0.25
done

"$CHROME" \
	--headless \
	--disable-gpu \
	--no-sandbox \
	--no-pdf-header-footer \
	--virtual-time-budget=10000 \
	--print-to-pdf="$OUT" \
	"http://127.0.0.1:$PORT/resume.html" 2>/dev/null

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
