# Open History Line — `ohm.openhistoryline.org`

An interactive timeline of history's events, drawn **live in the browser** from
[Wikidata](https://www.wikidata.org) and [PeriodO](https://perio.do), rendered
with the [timel.in](https://github.com/openhistorymap/timelin) timeline component
(`<timelin-timeline>`).

- **Curated collections** — wars & conflicts, disasters & nature, the space age,
  Roman emperors (Wikidata SPARQL), plus PeriodO period sets — each grouped into
  **swimlanes** by event class or authority.
- **Free Wikidata search** — look up any place, person, or empire and see the
  dated events located in / about it, lane-stacked by class.
- **Deep time** — one axis from antiquity (BCE) to now; drag to pan, scroll to
  zoom, click to set the year, click an event for its source.

Angular 21 (standalone), "library at night" aesthetic shared with the rest of OHM.

## Run it

This box isn't expected to have a compatible Node toolchain — build in Docker,
like `ohm-map`:

```bash
docker run --rm -it -v "$(pwd)":/app -w /app \
  -p 4200:4200 node:22 sh -c "npm install && npx ng serve --host 0.0.0.0"
```

`npm run build` produces `dist/openhistoryline/browser/`. The repo is
self-contained — no sibling checkout required.

## How it consumes the library

Until the `@openhistorymap/timeline-*` packages are on npm, the app uses a
**vendored snapshot** of the timel.in source under [`lib/`](lib/), wired up via
tsconfig path mappings:

```jsonc
"paths": {
  "@openhistorymap/timeline-core":          ["lib/core/index.ts"],
  "@openhistorymap/timeline-core/wikidata":  ["lib/core/wikidata.ts"],
  "@openhistorymap/timeline-core/periodo":   ["lib/core/periodo.ts"],
  "@openhistorymap/timeline-angular":        ["lib/angular/public-api.ts"]
}
```

The `<timelin-timeline>` standalone component is compiled together with the app.
Refresh the snapshot when the library changes:

```bash
bash scripts/sync-lib.sh ../timel.in   # then commit lib/
```

Once the packages are published, delete `lib/` + the `paths` block and add the
real npm dependencies — nothing else changes.

## Deployment

GitHub Pages via `.github/workflows/deploy.yml` (Angular build → SPA fallback →
`actions/deploy-pages`), on push to `master`. The project page is served at
`https://openhistorymap.github.io/openhistoryline/`; `--base-href` comes from the
`BASE_HREF` repo variable (default `/openhistoryline/`). For the custom domain
`ohm.openhistoryline.org`, set `BASE_HREF=/`, add a `CNAME` file, and point DNS.

## Data

- **Curated layers are cached** to `public/layers/<id>.json` (the app's normalized
  event shape), so they load instantly with **no WDQS rate limits**. Regenerate
  them whenever you like — say, monthly — and commit the result:
  ```bash
  python3 scripts/build_layers.py     # → public/layers/*.json (~860 KB)
  ```
  Add/remove a cached layer by editing both `CLASS_LAYERS` in that script and the
  `cached(...)` entries in `src/app/data.ts`.
- **PeriodO layers stay live** (a static CDN dump, not rate-limited).
- **Free search** (`wbsearchentities`) and the **Custom SPARQL layer** run live
  against Wikidata.
- **Custom queries**: the panel lets you edit only the query *body* (the patterns
  that bind `?item` / `?class` and your `FILTER`s). The app wraps it in a fixed
  `SELECT … BIND(date) … wikibase:label …` so the result is always
  adapter-compatible — see `wrapCustomQuery` in `src/app/data.ts`.
- Credentials: none. Everything is public, read-only, client-side.
