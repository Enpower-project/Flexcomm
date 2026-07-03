#!/usr/bin/env bash
# One-command setup + launch for the SCOT demo stack (no Docker needed).
#   ./run.sh           set up everything, then start backend (:8000) and frontend (:3000)
#   ./run.sh --setup   set up everything, don't start the servers
set -euo pipefail
cd "$(dirname "$0")"

command -v python3 >/dev/null || { echo "ERROR: python3 not found"; exit 1; }
command -v npm     >/dev/null || { echo "ERROR: npm not found (install Node.js)"; exit 1; }

# ── Backend setup ────────────────────────────────────────────────────────────
if [ ! -d .venv ]; then
    echo "creating virtualenv..."
    python3 -m venv .venv
fi
echo "installing backend dependencies (first run takes a while)..."
.venv/bin/pip install -q -r fast_api/requirements.txt

if [ ! -f fast_api/.env ]; then
    cp fast_api/.env.example fast_api/.env
    echo "created fast_api/.env from template (placeholder values are fine for a demo run)"
fi

# ── Frontend setup ───────────────────────────────────────────────────────────
if [ ! -d frontend/node_modules ]; then
    echo "installing frontend dependencies..."
    (cd frontend && npm install)
fi

if [ ! -f frontend/.env ]; then
    cp frontend/.env.example frontend/.env
    echo "created frontend/.env from template"
    echo "NOTE: fill in the REACT_APP_KEYCLOAK_* values in frontend/.env before logging in"
fi

[ "${1:-}" = "--setup" ] && { echo "setup complete."; exit 0; }

# ── Launch ───────────────────────────────────────────────────────────────────
echo "starting backend on http://127.0.0.1:8000 ..."
(cd fast_api/apisrc && exec ../../.venv/bin/uvicorn service:app --reload) &
BACKEND_PID=$!
trap 'echo; echo "stopping..."; kill "$BACKEND_PID" 2>/dev/null; wait "$BACKEND_PID" 2>/dev/null' INT TERM EXIT

echo "starting frontend on http://localhost:3000 ..."
(cd frontend && BROWSER=none exec npm start)
