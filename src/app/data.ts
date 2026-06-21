/**
 * Data layer for Open History Line.
 *
 * Everything the timeline shows comes from open knowledge bases, fetched live in
 * the browser: curated SPARQL "collections" and free-text entity lookups from
 * **Wikidata**, and scholarly period definitions from **PeriodO**. All of it is
 * mapped to timel.in events/groups by the library's own adapters — this file
 * only writes the queries and tags swimlanes by event class.
 */
import type { TimelineEvent, TimelineGroup } from '@openhistorymap/timeline-core';
import { fetchWikidataEvents } from '@openhistorymap/timeline-core/wikidata';
import { fetchPeriodo } from '@openhistorymap/timeline-core/periodo';

export interface LoadResult {
  events: TimelineEvent[];
  groups: TimelineGroup[];
  /** Suggested initial view [start, end] in decimal years. */
  view?: [number, number];
}

export interface Collection {
  id: string;
  label: string;
  blurb: string;
  source: 'Wikidata' | 'PeriodO';
  load: () => Promise<LoadResult>;
}

/* A palette of brass-compatible accents for swimlanes. */
const PALETTE = [
  'oklch(0.74 0.115 78)',
  'oklch(0.70 0.11 210)',
  'oklch(0.72 0.12 150)',
  'oklch(0.70 0.12 30)',
  'oklch(0.72 0.10 320)',
  'oklch(0.74 0.10 110)',
  'oklch(0.70 0.11 260)',
  'oklch(0.72 0.12 60)',
  'oklch(0.71 0.11 175)',
  'oklch(0.73 0.11 95)',
];

/** Drop duplicate ids (an item can match several P31 classes) and derive coloured lanes. */
function finalize(events: TimelineEvent[]): { events: TimelineEvent[]; groups: TimelineGroup[] } {
  const seen = new Set<string>();
  const deduped = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  const labels = [...new Set(deduped.map((e) => e.group).filter((g): g is string => !!g))].sort(
    (a, b) => a.localeCompare(b),
  );
  const groups: TimelineGroup[] = labels.map((label, i) => ({
    id: label,
    label,
    order: i,
    color: PALETTE[i % PALETTE.length],
  }));
  return { events: deduped, groups };
}

/** Format a (possibly BCE) year as a WDQS xsd:dateTime literal. */
function iso(year: number): string {
  const sign = year < 0 ? '-' : '+';
  const abs = Math.abs(year).toString().padStart(4, '0');
  return `${sign}${abs}-01-01T00:00:00Z`;
}

/**
 * SPARQL for dated events whose `instance of` (P31) is one of `classes`, taking
 * a point-in-time (P585) or a start/end (P580/P582). `?classLabel` becomes the
 * swimlane tag.
 */
function classQuery(classes: string[], fromYear: number, toYear: number, limit = 400): string {
  const values = classes.map((q) => `wd:${q}`).join(' ');
  return `SELECT ?item ?itemLabel ?itemDescription ?date ?endDate ?classLabel WHERE {
  VALUES ?class { ${values} }
  ?item wdt:P31 ?class .
  OPTIONAL { ?item wdt:P585 ?pit. }
  OPTIONAL { ?item wdt:P580 ?st. }
  OPTIONAL { ?item wdt:P582 ?et. }
  BIND(COALESCE(?pit, ?st) AS ?date)
  BIND(?et AS ?endDate)
  FILTER(BOUND(?date))
  FILTER(?date >= "${iso(fromYear)}"^^xsd:dateTime && ?date < "${iso(toYear)}"^^xsd:dateTime)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?date
LIMIT ${limit}`;
}

async function classCollection(classes: string[], from: number, to: number): Promise<LoadResult> {
  const events = await fetchWikidataEvents({
    sparql: classQuery(classes, from, to),
    mapping: { group: 'classLabel' },
  });
  return { ...finalize(events), view: [from, to] };
}

export const COLLECTIONS: Collection[] = [
  {
    id: 'conflicts',
    label: 'Wars & conflicts',
    blurb: 'Wars, battles, sieges, revolutions and coups — lane per kind.',
    source: 'Wikidata',
    load: () => classCollection(['Q198', 'Q178561', 'Q188055', 'Q10931', 'Q45382'], -800, 2025),
  },
  {
    id: 'disasters',
    label: 'Disasters & nature',
    blurb: 'Earthquakes, eruptions, pandemics, famines and floods.',
    source: 'Wikidata',
    load: () => classCollection(['Q7944', 'Q7692360', 'Q12184', 'Q168247', 'Q8068'], 0, 2025),
  },
  {
    id: 'space',
    label: 'The space age',
    blurb: 'Spaceflights and crewed missions, 1957 onward.',
    source: 'Wikidata',
    load: () => classCollection(['Q5916', 'Q2133344'], 1957, 2026),
  },
  {
    id: 'emperors',
    label: 'Roman emperors',
    blurb: 'Reigns as spans, from Augustus to the fall of the West.',
    source: 'Wikidata',
    load: async () => {
      const events = await fetchWikidataEvents({
        sparql: `SELECT ?item ?itemLabel ?date ?endDate WHERE {
          ?item p:P39 ?st . ?st ps:P39 wd:Q842606 .
          OPTIONAL { ?st pq:P580 ?date. } OPTIONAL { ?st pq:P582 ?endDate. }
          FILTER(BOUND(?date))
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        } ORDER BY ?date LIMIT 250`,
      });
      return { ...finalize(events), view: [-30, 500] };
    },
  },
  {
    id: 'periodo-greece',
    label: 'Periods — Greece',
    blurb: 'Scholarly period definitions for Greece, lane per authority.',
    source: 'PeriodO',
    load: async () => {
      const { events, groups } = await fetchPeriodo({ spatialCoverage: 'Greece', groupBy: 'authority' });
      return { events, groups, view: [-6500, 2000] };
    },
  },
  {
    id: 'periodo-levant',
    label: 'Periods — Levant',
    blurb: 'Period definitions for the Levant, lane per authority.',
    source: 'PeriodO',
    load: async () => {
      const { events, groups } = await fetchPeriodo({ spatialCoverage: 'Levant', groupBy: 'authority' });
      return { events, groups, view: [-4000, 2000] };
    },
  },
];

/* --- Free-text Wikidata entity search --------------------------------------- */

export interface EntityHit {
  id: string;
  label: string;
  description?: string;
}

/** Autocomplete entities via the Wikidata `wbsearchentities` API (CORS-enabled). */
export async function searchEntities(query: string, signal?: AbortSignal): Promise<EntityHit[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*' +
    `&language=en&uselang=en&type=item&limit=8&search=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Wikidata search failed: ${res.status}`);
  const json = (await res.json()) as { search?: { id: string; label?: string; description?: string }[] };
  return (json.search ?? []).map((s) => ({ id: s.id, label: s.label ?? s.id, description: s.description }));
}

/** Dated events located in / about a chosen entity, tagged by their class. */
export async function eventsForEntity(qid: string): Promise<LoadResult> {
  const sparql = `SELECT ?item ?itemLabel ?itemDescription ?date ?endDate ?classLabel WHERE {
  ?item wdt:P31 ?class .
  { ?item wdt:P276 wd:${qid} } UNION { ?item wdt:P17 wd:${qid} }
  UNION { ?item wdt:P710 wd:${qid} } UNION { ?item wdt:P361 wd:${qid} }
  OPTIONAL { ?item wdt:P585 ?pit. }
  OPTIONAL { ?item wdt:P580 ?st. }
  OPTIONAL { ?item wdt:P582 ?et. }
  BIND(COALESCE(?pit, ?st) AS ?date)
  BIND(?et AS ?endDate)
  FILTER(BOUND(?date))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?date
LIMIT 400`;
  const events = await fetchWikidataEvents({ sparql, mapping: { group: 'classLabel' } });
  const out = finalize(events);
  if (!out.events.length) return out;
  const years = out.events.map((e) => e.year);
  const lo = Math.min(...years);
  const hi = Math.max(...out.events.map((e) => e.endYear ?? e.year));
  const pad = Math.max(10, (hi - lo) * 0.08);
  return { ...out, view: [lo - pad, hi + pad] };
}
