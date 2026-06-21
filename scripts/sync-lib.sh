#!/usr/bin/env bash
# Refresh the vendored timel.in library source under lib/.
#
# The app consumes the @openhistorymap/timeline-* packages from a vendored
# snapshot (so it builds in CI without the library being on npm or reachable as
# a private submodule). Run this whenever the library changes upstream, then
# commit the result. Expects the timel.in repo checked out as a sibling.
#
#   bash scripts/sync-lib.sh [path-to-timel.in]
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-../timel.in}"
[ -d "$SRC/packages/core/src" ] || { echo "timel.in not found at $SRC"; exit 1; }

rm -rf lib/core lib/angular
mkdir -p lib/core lib/angular
cp "$SRC"/packages/core/src/*.ts lib/core/
cp "$SRC"/packages/angular/src/public-api.ts "$SRC"/packages/angular/src/timeline.component.ts lib/angular/

pin="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "Vendored timel.in @ $pin into lib/."
