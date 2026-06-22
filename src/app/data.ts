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

/** Format a (possibly BCE) year as a WDQS xsd:dateTime literal. */
function iso(year: number): string {
  const sign = year < 0 ? '-' : '+';
  return `${sign}${Math.abs(year).toString().padStart(4, '0')}-01-01T00:00:00Z`;
}

/** Dated items whose `instance of` is one of `classes`, point-in-time or start/end. */
function classQuery(classes: string[], from = -3000, to = 2031, limit = 1000): string {
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
  FILTER(?date >= "${iso(from)}"^^xsd:dateTime && ?date < "${iso(to)}"^^xsd:dateTime)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?date
LIMIT ${limit}`;
}

/** A Wikidata class layer: tooltip carries the precise class via the description. */
function wd(
  id: string,
  label: string,
  category: string,
  color: string,
  classes: string[],
): Layer {
  return {
    id,
    label,
    category,
    source: 'Wikidata',
    color,
    load: () => fetchWikidataEvents({ sparql: classQuery(classes), mapping: { description: 'classLabel' } }),
  };
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
  // Conflict
  wd('wars', 'Wars', 'Conflict', 'oklch(0.66 0.14 28)', ['Q198']),
  wd('battles', 'Battles & sieges', 'Conflict', 'oklch(0.70 0.13 45)', ['Q178561', 'Q188055']),
  wd('revolts', 'Revolutions & coups', 'Conflict', 'oklch(0.64 0.13 12)', ['Q10931', 'Q45382', 'Q124734']),

  // Nature & climate
  wd('famine', 'Famines & droughts', 'Nature & climate', 'oklch(0.74 0.11 92)', ['Q168247', 'Q43059']),
  wd('plague', 'Pandemics & epidemics', 'Nature & climate', 'oklch(0.71 0.12 150)', ['Q12184', 'Q44512']),
  wd('quake', 'Earthquakes', 'Nature & climate', 'oklch(0.68 0.10 62)', ['Q7944']),
  wd('eruption', 'Volcanic eruptions', 'Nature & climate', 'oklch(0.67 0.14 35)', ['Q7692360']),
  wd('flood', 'Floods', 'Nature & climate', 'oklch(0.70 0.11 232)', ['Q8068']),

  // Society
  wd('treaties', 'Treaties', 'Society', 'oklch(0.71 0.10 320)', ['Q625298']),
  {
    id: 'emperors',
    label: 'Roman emperors',
    category: 'Society',
    source: 'Wikidata',
    color: 'oklch(0.74 0.115 78)',
    load: () =>
      fetchWikidataEvents({
        sparql: `SELECT ?item ?itemLabel ?date ?endDate WHERE {
          ?item p:P39 ?st . ?st ps:P39 wd:Q842606 .
          OPTIONAL { ?st pq:P580 ?date. } OPTIONAL { ?st pq:P582 ?endDate. }
          FILTER(BOUND(?date))
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        } ORDER BY ?date LIMIT 250`,
      }),
  },

  // Periods
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
  const sparql = `SELECT ?item ?itemLabel ?itemDescription ?date ?endDate ?classLabel WHERE {
  ?item wdt:P31 ?class .
  { ?item wdt:P276 wd:${hit.id} } UNION { ?item wdt:P17 wd:${hit.id} }
  UNION { ?item wdt:P710 wd:${hit.id} } UNION { ?item wdt:P361 wd:${hit.id} }
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
