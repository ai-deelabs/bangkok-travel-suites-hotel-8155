#!/usr/bin/env bash
# Obtain a fresh Beds24 access token and persist it to .env.
#
# Two flows, auto-selected from .env:
#   1. BOOTSTRAP — if BEDS24_INVITE_CODE is set, call GET /authentication/setup
#      (header: code: <invite>) which returns { token, refreshToken, expiresIn }.
#      The invite code is single-use; it is consumed and then cleared from .env.
#   2. REFRESH  — else use BEDS24_REFRESH_TOKEN with GET /authentication/token.
#
# ⚠️  Beds24 ROTATES the refresh token on every exchange and on setup: the
# response carries a NEW refreshToken and the old one dies immediately. This
# script always writes BOTH the access token AND the rotated refresh token back
# to .env atomically, so a token can never be silently burned again.
#
# Usage: bash scripts/beds24-refresh.sh
# Prints only lengths/status — never the secret values.
set -euo pipefail
cd "$(dirname "$0")/.."

# single-process read (no pipe → safe under `set -o pipefail`)
getv() { awk -F= -v k="$1" '$1==k{sub(/^[^=]*=/,"");print;exit}' .env 2>/dev/null; }

INVITE=$(getv BEDS24_INVITE_CODE)
REFRESH=$(getv BEDS24_REFRESH_TOKEN)

if [ -n "$INVITE" ]; then
  echo "[setup] bootstrapping from invite code (len ${#INVITE})"
  RESP=$(curl -s -H "code: $INVITE" -H "accept: application/json" \
    "https://beds24.com/api/v2/authentication/setup")
  MODE=setup
elif [ -n "$REFRESH" ]; then
  echo "[refresh] exchanging refresh token (len ${#REFRESH})"
  RESP=$(curl -s -H "refreshToken: $REFRESH" -H "accept: application/json" \
    "https://beds24.com/api/v2/authentication/token")
  MODE=refresh
else
  echo "ERROR: set BEDS24_INVITE_CODE or BEDS24_REFRESH_TOKEN in .env first."
  exit 1
fi

# Parse response and rewrite .env atomically (preserves property/room lines).
python3 - "$RESP" "$MODE" <<'PY'
import sys, json, re, pathlib
resp_raw, mode = sys.argv[1], sys.argv[2]
try:
    resp = json.loads(resp_raw)
except Exception:
    print("EXCHANGE FAILED: non-JSON response:", resp_raw[:300]); sys.exit(2)
if not resp.get("token"):
    print("EXCHANGE FAILED:", json.dumps(resp)); sys.exit(2)

access  = resp["token"]
refresh = resp.get("refreshToken")    # rotated/new value when present
expires = resp.get("expiresIn")

p = pathlib.Path(".env"); lines = p.read_text().splitlines()
def setkv(lines, k, v):
    out, seen = [], False
    for ln in lines:
        if re.match(rf'^{k}=', ln): out.append(f"{k}={v}"); seen = True
        else: out.append(ln)
    if not seen: out.append(f"{k}={v}")
    return out

if refresh: lines = setkv(lines, "BEDS24_REFRESH_TOKEN", refresh)
lines = setkv(lines, "BEDS24_ACCESS_TOKEN", access)
if mode == "setup":
    # invite codes are single-use — clear it so we never replay a dead code
    lines = setkv(lines, "BEDS24_INVITE_CODE", "")
p.write_text("\n".join(lines) + "\n")
print(f"OK ({mode}): access len={len(access)}, expiresIn={expires}s, "
      f"refresh {'rotated/saved' if refresh else 'unchanged'}")
PY
