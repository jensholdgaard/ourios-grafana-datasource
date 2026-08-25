#!/usr/bin/env bash
# Regenerate src/generated/semconv.ts from the shared ourios-semconv
# registry repo at the ref pinned in semconv-registry.ref — the same
# fetch + weaver invocation the CI semconv job no-diff-gates.
# Requires weaver (open-telemetry/weaver) on PATH.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
ref="$(tr -d '[:space:]' < "$repo_root/semconv-registry.ref")"
# The pin must be a tag or branch NAME (git clone --branch takes no
# bare SHA), and it is interpolated into a path handed to rm -rf —
# constrain it to a conservative charset so a malformed pin can never
# traverse out of the checkout dir or read as a git/rm option.
case "$ref" in
    ''|-*|*[!A-Za-z0-9._-]*|*..*)
        echo "error: semconv-registry.ref must be a tag/branch name matching [A-Za-z0-9._-]+ (no leading '-', no '..'); got '$ref'" >&2
        exit 1;;
esac
command -v weaver >/dev/null || { echo "error: weaver not installed (open-telemetry/weaver)" >&2; exit 1; }

# SEMCONV_CHECKOUT_DIR is a BASE directory (a cache root); the
# ref-named checkout always lives one level below it, so the rm -rf
# on a partial checkout can never touch the base itself.
base="${SEMCONV_CHECKOUT_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}}"
dest="$base/ourios-semconv-$ref"
if [ ! -d "$dest/registry" ]; then
    rm -rf "$dest"
    git clone --quiet --depth 1 --branch "$ref" \
        https://github.com/jensholdgaard/ourios-semconv.git "$dest" >&2
fi

weaver registry generate ts "$repo_root/src/generated" \
    -t "$dest/templates" -r "$dest/registry" --future
