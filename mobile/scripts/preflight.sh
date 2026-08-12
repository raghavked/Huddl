#!/usr/bin/env bash
#
# Preflight — the checks that must pass before an iOS simulator run.
#
# These are the platform-independent ones: they run anywhere Node runs, so CI
# and a Linux box catch a broken bundle before it ever reaches a Mac. They do
# NOT boot a simulator (that needs Xcode) — `npm run simulator` does that, and
# only makes sense on macOS. Run this first; if it is green, the JavaScript
# side is sound and any remaining failure is native toolchain, not the app.
#
#   npm run preflight
#
# Exits non-zero on the first failure so it is safe to gate CI on.

set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

step "TypeScript (tsc --noEmit)"
./node_modules/.bin/tsc --noEmit

step "iOS bundle (expo export --platform ios)"
# Proves every route and every import resolves and Metro can build the graph —
# the same bundling step a real device build runs, minus the native compile.
npx expo export --platform ios >/dev/null

step "Done"
echo "Preflight passed. The JS side is ready; run 'npm run simulator' on a Mac."
