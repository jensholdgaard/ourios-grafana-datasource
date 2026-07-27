#!/usr/bin/env bash
#
# RFC0041.1/.2 container e2e: drive the plugin's datasource client and
# log-query mapping against the released ourios-server image.
#
#   OURIOS_IMAGE=ghcr.io/jensholdgaard/ourios:0.5.0 bash e2e/run-e2e.sh
#
# Flush model: the served sink writes Parquet on graceful shutdown (no
# config knob — the collector-interop test's pattern), so each fixture
# server is seeded, stopped (SIGTERM + grace), and started again before
# the suite queries it.
set -euo pipefail

IMAGE="${OURIOS_IMAGE:-ghcr.io/jensholdgaard/ourios:0.5.0}"
E2E_TOKEN_GOOD="${E2E_TOKEN_GOOD:-e2e-good-token-0123456789abcdef}"
E2E_TOKEN_OTHER="${E2E_TOKEN_OTHER:-e2e-other-token-0123456789abcdef}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPEN=ourios-e2e-open
AUTH=ourios-e2e-auth

cleanup() {
  docker rm -f "$OPEN" "$AUTH" >/dev/null 2>&1 || true
  docker volume rm -f "$OPEN-data" "$AUTH-data" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The image runs nonroot (uid 65532); named volumes initialize
# root-owned, and host bind mounts don't survive colima's uid mapping —
# so create the volumes and hand them to 65532 explicitly first.
for vol in "$OPEN-data" "$AUTH-data"; do
  docker volume create "$vol" >/dev/null
  docker run --rm -v "$vol:/data" busybox chown 65532:65532 /data
done

start_server() { # name, config, data dir, http port, query port, extra docker args...
  local name="$1" config="$2" data="$3" http="$4" query="$5"; shift 5
  docker run -d --name "$name" \
    -p "127.0.0.1:${http}:4318" -p "127.0.0.1:${query}:4319" \
    -v "$HERE/$config:/etc/ourios/config.yaml:ro" \
    -v "$data:/data" \
    "$@" \
    "$IMAGE" --config /etc/ourios/config.yaml >/dev/null
}

wait_port() { # port
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "http://127.0.0.1:$1/" && return 0 || true
    sleep 1
  done
  echo "port $1 never answered; container logs:" >&2
  docker logs "$OPEN" >&2 2>&1 || true
  docker logs "$AUTH" >&2 2>&1 || true
  return 1
}

echo "== open-mode server =="
start_server "$OPEN" config-open.yaml "$OPEN-data" 15418 15419
wait_port 15419
node "$HERE/seed.mjs" http://127.0.0.1:15418
docker stop --time 30 "$OPEN" >/dev/null   # graceful: flushes WAL -> Parquet
docker start "$OPEN" >/dev/null
wait_port 15419

echo "== enforcement server =="
start_server "$AUTH" config-auth.yaml "$AUTH-data" 15518 15519 \
  -e E2E_TOKEN_GOOD="$E2E_TOKEN_GOOD" -e E2E_TOKEN_OTHER="$E2E_TOKEN_OTHER"
wait_port 15519
node "$HERE/seed.mjs" http://127.0.0.1:15518 "$E2E_TOKEN_GOOD"
docker stop --time 30 "$AUTH" >/dev/null
docker start "$AUTH" >/dev/null
wait_port 15519

echo "== suites =="
OPEN_QUERY_URL=http://127.0.0.1:15419 \
AUTH_QUERY_URL=http://127.0.0.1:15519 \
E2E_TOKEN_GOOD="$E2E_TOKEN_GOOD" \
E2E_TOKEN_OTHER="$E2E_TOKEN_OTHER" \
  npx jest --config jest.e2e.config.js --runInBand
