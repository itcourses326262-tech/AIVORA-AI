#!/usr/bin/env bash
# Smoke test of a RUNNING AIVORE server, through its public HTTP API only:
#   health -> landing page -> register -> Demo generation to "succeeded" -> download the result -> credits.
# Needs curl and jq. The server must run with the Demo provider on (ENABLE_MOCK_PROVIDER=true, the default),
# an inline or external worker, and APP_URL equal to the base URL given here (the sign-up request is
# same-origin checked). It registers one throw-away account per run, which needs the free credits: by
# default only Google sign-up earns them, so start the server with SIGNUP_BONUS_PROVIDER=any.
#
#   .github/scripts/smoke.sh http://localhost:3000
set -euo pipefail

BASE="${1:?usage: smoke.sh <base url, e.g. http://localhost:3000>}"
BASE="${BASE%/}"
WAIT_SEC="${SMOKE_WAIT_SEC:-120}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

step() { printf 'smoke: %s\n' "$*"; }
fail() { printf 'smoke: FAILED: %s\n' "$*" >&2; exit 1; }

# curl that never prints a progress bar, and keeps the response head and body in files
call() { curl -sS --max-time 30 -D "$work/head" -o "$work/body" -w '%{http_code}' "$@"; }

step "waiting for $BASE/api/health (up to ${WAIT_SEC}s)"
deadline=$((SECONDS + WAIT_SEC))
until curl -fsS --max-time 5 "$BASE/api/health" -o "$work/health" 2>/dev/null; do
  [ "$SECONDS" -lt "$deadline" ] || fail "no healthy answer from $BASE/api/health"
  sleep 1
done
[ "$(jq -r .status "$work/health")" = "ok" ] || fail "health says: $(cat "$work/health")"
[ "$(jq -r .db "$work/health")" = "true" ] || fail "database not reachable: $(cat "$work/health")"
step "health ok: $(jq -c . "$work/health")"

code="$(call "$BASE/")"
[ "$code" = "200" ] || fail "GET / answered $code"
step "landing page ok"

email="smoke-$(date +%s)-$RANDOM@example.com"
password="Smoke-$(date +%s)-Test-Pass"
body="$(jq -nc --arg email "$email" --arg password "$password" \
  '{email: $email, password: $password, name: "Smoke Test", locale: "en"}')"
code="$(call -X POST "$BASE/api/v1/auth/register" -H "Origin: $BASE" -H 'Content-Type: application/json' -d "$body")"
[ "$code" = "201" ] || fail "register answered $code: $(cat "$work/body")"
cookie="$(grep -i '^set-cookie: aivore_session=' "$work/head" | head -1 | sed -E 's/^[^:]+: (aivore_session=[^;]+).*/\1/' | tr -d '\r')"
[ -n "$cookie" ] || fail "register set no session cookie"
step "registered $email with $(jq -r .data.creditBalance "$work/body") credits"

body="$(jq -nc '{tool: "text-to-image", modelId: "aivore-demo-image", prompt: "a calm sunset over the sea", params: {count: 1}}')"
code="$(call -X POST "$BASE/api/v1/generations" -H "Cookie: $cookie" -H "Origin: $BASE" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: smoke-$RANDOM-$SECONDS" -d "$body")"
[ "$code" = "201" ] || fail "create generation answered $code: $(cat "$work/body")"
id="$(jq -r .data.id "$work/body")"
step "generation $id queued"

status=""
deadline=$((SECONDS + WAIT_SEC))
while [ "$status" != "succeeded" ]; do
  [ "$SECONDS" -lt "$deadline" ] || fail "generation $id still '$status' after ${WAIT_SEC}s (is a worker running? WORKER_MODE=$(jq -r .worker "$work/health"))"
  sleep 1
  code="$(call "$BASE/api/v1/generations/$id" -H "Cookie: $cookie")"
  [ "$code" = "200" ] || fail "poll answered $code: $(cat "$work/body")"
  status="$(jq -r .data.status "$work/body")"
  [ "$status" != "failed" ] || fail "generation failed: $(jq -c .data.error "$work/body")"
done
step "generation succeeded"

url="$(jq -r '.data.outputs[0].url' "$work/body")"
code="$(call "$BASE$url" -H "Cookie: $cookie")"
[ "$code" = "200" ] || fail "media answered $code"
type="$(grep -i '^content-type:' "$work/head" | tr -d '\r' | awk '{print $2}')"
size="$(wc -c <"$work/body" | tr -d ' ')"
[ "$size" -gt 1000 ] || fail "media is only $size bytes"
step "media ok: $type, $size bytes"

code="$(call "$BASE/api/v1/auth/me" -H "Cookie: $cookie")"
[ "$code" = "200" ] || fail "me answered $code"
balance="$(jq -r .data.creditBalance "$work/body")"
[ "$balance" = "49" ] || fail "expected 49 credits after one Demo image, got $balance"
step "credits ok: $balance"

step "all checks passed"
