/**
 * Data layer for Open History Line.
 *
 * The sidebar is a set of **composable layers**: each is an independent query
 * (Wikidata SPARQL or PeriodO), and any number can be switched on at once. The
 * timeline draws each active layer as its own swimlane, so you can lay, say,
 * "Famines & droughts" next to "Wars" and read the correlation across time.
 *
 * Everything is fetched live in the browser from open, CORS-enabled endpoints.
 * This file writes the queries; the component composes the active layers.
 */
import type { TimelineEvent } from '@openhistorymap/timeline-core';
import { fetchWikidataEvents } from '@openhistorymap/timeline-core/wikidata';
import { fetchPeriodo } from '@openhistorymap/timeline-core/periodo';

export interface Layer {
  id: string;
  label: string;
  category: string;
  source: 'Wikidata' | 'PeriodO';
  /** Lane colour (also the default colour for the layer's events). */
  color: string;
  /** Fetches the layer's events (untagged; the component tags them by layer). */
  load: () => Promise<TimelineEvent[]>;
  /** True for layers created on the fly from a search; these are removable. */
  dynamic?: boolean;
}

/**
 * The fixed scaffold wrapped around a user's custom query body. The user edits
 * only `CUSTOM_QUERY_BODY` (the triple patterns + filters that bind `?item` and,
 * optionally, `?class`); everything that makes the output adapter-compatible —
 * the SELECT columns, the date/end binding, the country and the label service —
 * is fixed.
 */
export const CUSTOM_QUERY_HEADER =
  'SELECT ?item ?itemLabel ?itemDescription ?date ?endDate ?classLabel ?countryLabel WHERE {';
export const CUSTOM_QUERY_FOOTER = `  OPTIONAL { ?item wdt:P585 ?pit. }
  OPTIONAL { ?item wdt:P580 ?st. }
  OPTIONAL { ?item wdt:P582 ?et. }
  BIND(COALESCE(?pit, ?st) AS ?date)
  BIND(?et AS ?endDate)
  FILTER(BOUND(?date))
  OPTIONAL { ?item wdt:P17 ?country. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?date
LIMIT 600`;

/** A starter body shown in the custom-query editor. */
export const CUSTOM_QUERY_EXAMPLE = `  # bind ?item (and optionally ?class for the lane/colour label)
  ?item wdt:P31 ?class .
  VALUES ?class { wd:Q3024240 }     # e.g. historical country
  ?item wdt:P30 wd:Q46 .            # located in Europe
  # add your own FILTERs here`;

/** Assemble a complete, adapter-compatible SPARQL query from an editable body. */
export function wrapCustomQuery(body: string): string {
  return `${CUSTOM_QUERY_HEADER}\n${body.trim()}\n${CUSTOM_QUERY_FOOTER}`;
}

/** A removable layer that runs a user's custom query body live against WDQS. */
export function customLayer(name: string, body: string, index: number): Layer {
  const sparql = wrapCustomQuery(body);
  return {
    id: `custom:${index}`,
    label: name.trim() || 'Custom query',
    category: 'Custom',
    source: 'Wikidata',
    color: DYNAMIC_COLORS[index % DYNAMIC_COLORS.length],
    dynamic: true,
    load: () => fetchWikidataEvents({ sparql, mapping: { description: 'classLabel' } }),
  };
}

/**
 * The country facet of an event, for "group by country" swimlanes. Reads the
 * Wikidata SPARQL binding (`countryLabel`) or a PeriodO period's spatial
 * coverage. Returns undefined when no place is known (those fall into "Other").
 */
export function eventCountry(e: TimelineEvent): string | undefined {
  const d = e.data as
    | (Record<string, { value?: string }> & {
        country?: string;
        spatialCoverageDescription?: string;
        spatialCoverage?: { label?: string }[];
      })
    | undefined;
  if (!d) return undefined;
  if (d.country) return d.country; // cached/normalized events
  const cl = (d as Record<string, { value?: string }>)['countryLabel'];
  if (cl?.value && !/^Q\d+$/.test(cl.value)) return cl.value; // live SPARQL binding
  if (d.spatialCoverageDescription) return d.spatialCoverageDescription;
  if (Array.isArray(d.spatialCoverage) && d.spatialCoverage[0]?.label) return d.spatialCoverage[0].label;
  return undefined;
}

/** Load a cached layer's events from a baked JSON file (regenerated monthly). */
async function loadLayerJson(id: string): Promise<TimelineEvent[]> {
  const url = new URL(`layers/${id}.json`, document.baseURI).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cached layer “${id}” unavailable (${res.status})`);
  return (await res.json()) as TimelineEvent[];
}

/** A curated Wikidata layer, served from cached JSON (see scripts/build_layers.py). */
function cached(id: string, label: string, category: string, color: string): Layer {
  return { id, label, category, source: 'Wikidata', color, load: () => loadLayerJson(id) };
}

/** A PeriodO region layer (a single lane of period definitions). */
function po(id: string, label: string, color: string, region: string): Layer {
  return {
    id,
    label,
    category: 'Periods (PeriodO)',
    source: 'PeriodO',
    color,
    load: async () => (await fetchPeriodo({ spatialCoverage: region, groupBy: 'none' })).events,
  };
}

export const LAYERS: Layer[] = [
  // Conflict (cached Wikidata)
  cached('wars', 'Wars', 'Conflict', 'oklch(0.66 0.14 28)'),
  cached('battles', 'Battles & sieges', 'Conflict', 'oklch(0.70 0.13 45)'),
  cached('revolts', 'Revolutions & coups', 'Conflict', 'oklch(0.64 0.13 12)'),

  // Nature & climate (cached Wikidata)
  cached('famine', 'Famines & droughts', 'Nature & climate', 'oklch(0.74 0.11 92)'),
  cached('plague', 'Pandemics & epidemics', 'Nature & climate', 'oklch(0.71 0.12 150)'),
  cached('quake', 'Earthquakes', 'Nature & climate', 'oklch(0.68 0.10 62)'),
  cached('eruption', 'Volcanic eruptions', 'Nature & climate', 'oklch(0.67 0.14 35)'),
  cached('flood', 'Floods', 'Nature & climate', 'oklch(0.70 0.11 232)'),

  // Society (cached Wikidata)
  cached('treaties', 'Treaties', 'Society', 'oklch(0.71 0.10 320)'),
  cached('emperors', 'Roman emperors', 'Society', 'oklch(0.74 0.115 78)'),

  // Periods (live PeriodO — a static CDN dump, not rate-limited)
  po('po-greece', 'Periods · Greece', 'oklch(0.70 0.11 200)', 'Greece'),
  po('po-levant', 'Periods · Levant', 'oklch(0.69 0.10 172)', 'Levant'),
  po('po-italy', 'Periods · Italy', 'oklch(0.71 0.11 138)', 'Italy'),
];

export const CATEGORIES = ['Conflict', 'Nature & climate', 'Society', 'Periods (PeriodO)'];

/* Colours cycled for search-created layers. */
const DYNAMIC_COLORS = [
  'oklch(0.73 0.11 95)',
  'oklch(0.70 0.11 260)',
  'oklch(0.72 0.12 320)',
  'oklch(0.71 0.11 175)',
];

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

/* --- Detail lookups (info panel) -------------------------------------------- */

/** A place referenced by an event/period, with links back out. */
export interface PlaceRef {
  qid: string;
  label: string;
}

/** Rich info for a Wikidata item, for the detail sidebar. */
export interface WikidataInfo {
  qid: string;
  label?: string;
  description?: string;
  /** English Wikipedia article URL, if the item has one. */
  wikipedia?: string;
  wikidataUrl: string;
  /** A Wikimedia Commons image URL (P18), if any. */
  image?: string;
}

/** Extract a `Q…` id from a Wikidata entity/wiki URL, if present. */
export function qidFromUrl(url?: string): string | undefined {
  const m = url && /(Q\d+)(?:$|[?#/])/.exec(url);
  return m ? m[1] : undefined;
}

/** The Wikidata places a PeriodO period covers (from `spatialCoverage`). */
export function placesFromData(data: unknown): PlaceRef[] {
  const sc = (data as { spatialCoverage?: { id?: string; label?: string }[] } | undefined)?.spatialCoverage;
  if (!Array.isArray(sc)) return [];
  const out: PlaceRef[] = [];
  for (const s of sc) {
    const qid = qidFromUrl(s.id);
    if (qid) out.push({ qid, label: s.label ?? qid });
  }
  return out;
}

/** Fetch label, description, English Wikipedia link, and lead image for a Wikidata item. */
export async function fetchWikidataInfo(qid: string, signal?: AbortSignal): Promise<WikidataInfo> {
  const url =
    'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*' +
    `&ids=${qid}&props=labels|descriptions|sitelinks|claims&languages=en&sitefilter=enwiki`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Wikidata fetch failed: ${res.status}`);
  const json = (await res.json()) as { entities?: Record<string, unknown> };
  const ent = (json.entities?.[qid] ?? {}) as {
    labels?: { en?: { value?: string } };
    descriptions?: { en?: { value?: string } };
    sitelinks?: { enwiki?: { title?: string } };
    claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] };
  };
  const title = ent.sitelinks?.enwiki?.title;
  const image = ent.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return {
    qid,
    label: ent.labels?.en?.value,
    description: ent.descriptions?.en?.value,
    wikipedia: title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` : undefined,
    wikidataUrl: `https://www.wikidata.org/wiki/${qid}`,
    image: image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image)}?width=360` : undefined,
  };
}

/** Build a removable layer from a chosen entity: dated events located in / about it. */
export function entityLayer(hit: EntityHit, index: number): Layer {
  const sparql = `SELECT ?item ?itemLabel ?itemDescription ?date ?endDate ?classLabel ?countryLabel WHERE {
  ?item wdt:P31 ?class .
  { ?item wdt:P276 wd:${hit.id} } UNION { ?item wdt:P17 wd:${hit.id} }
  UNION { ?item wdt:P710 wd:${hit.id} } UNION { ?item wdt:P361 wd:${hit.id} }
  OPTIONAL { ?item wdt:P585 ?pit. }
  OPTIONAL { ?item wdt:P580 ?st. }
  OPTIONAL { ?item wdt:P582 ?et. }
  BIND(COALESCE(?pit, ?st) AS ?date)
  BIND(?et AS ?endDate)
  FILTER(BOUND(?date))
  OPTIONAL { ?item wdt:P17 ?c1. }
  OPTIONAL { ?item wdt:P276 ?loc. ?loc wdt:P17 ?c2. }
  BIND(COALESCE(?c1, ?c2) AS ?country)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?date
LIMIT 400`;
  return {
    id: `entity:${hit.id}`,
    label: hit.label,
    category: 'Search',
    source: 'Wikidata',
    color: DYNAMIC_COLORS[index % DYNAMIC_COLORS.length],
    dynamic: true,
    load: () => fetchWikidataEvents({ sparql, mapping: { description: 'classLabel' } }),
  };
}
