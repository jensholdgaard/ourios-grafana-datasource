#!/usr/bin/env bash
# Regenerate src/generated/semconv.ts from the shared ourios-semconv
# registry repo at the ref pinned in semconv-registry.ref — the same
# fetch + weaver invocation the CI semconv job no-diff-gates.
# Requires weaver (open-telemetry/weaver) on PATH.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
ref="$(tr -d '[:space:]' < "$repo_root/semconv-registry.ref")"
[ -n "$ref" ] || { echo "error: semconv-registry.ref is empty" >&2; exit 1; }
command -v weaver >/dev/null || { echo "error: weaver not installed (open-telemetry/weaver)" >&2; exit 1; }

dest="${SEMCONV_CHECKOUT_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ourios-semconv-$ref}"
if [ ! -d "$dest/registry" ]; then
    rm -rf "$dest"
    git clone --quiet --depth 1 --branch "$ref" \
        https://github.com/jensholdgaard/ourios-semconv.git "$dest" >&2
fi

weaver registry generate ts "$repo_root/src/generated" \
    -t "$dest/templates" -r "$dest/registry" --future
