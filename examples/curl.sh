#!/usr/bin/env bash
# Logging from anything that can speak HTTP. Set LOGTRACK_URL / LOGTRACK_TOKEN as needed.
set -euo pipefail
URL="${LOGTRACK_URL:-http://localhost:3000}"
AUTH=()
[[ -n "${LOGTRACK_TOKEN:-}" ]] && AUTH=(-H "Authorization: Bearer $LOGTRACK_TOKEN")

# 1. One-liner with the quick syntax
curl -s "${AUTH[@]}" -X POST "$URL/api/activities/quick" \
  -H 'content-type: application/json' \
  -d '{"text":"45m deep work on the renderer @work #focus !4 ~5","source":"curl"}'
echo

# 2. Structured payload
curl -s "${AUTH[@]}" -X POST "$URL/api/activities" \
  -H 'content-type: application/json' \
  -d '{"title":"Morning run","category":"exercise","duration_min":35,"intensity":4,"mood":5,"tags":["cardio","outdoors"],"source":"curl"}'
echo

# 3. Start / stop a timer
curl -s "${AUTH[@]}" -X POST "$URL/api/timers/start" -H 'content-type: application/json' -d '{"text":"Writing the spec @work #docs"}'
echo
sleep 2
curl -s "${AUTH[@]}" -X POST "$URL/api/timers/stop" -H 'content-type: application/json' -d '{"mood":4}'
echo

# 4. Read metrics and the art envelopes
curl -s "$URL/api/metrics?range=7d&tz=$(python3 -c 'import time;print(time.tzname[0])' 2>/dev/null || echo UTC)" | head -c 400; echo
curl -s "$URL/api/art?range=24h" | head -c 300; echo

# 5. Export everything
curl -s "$URL/api/export.csv" | head -5
