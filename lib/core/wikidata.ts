/**
 * Optional Wikidata adapter (subpath export `@openhistorymap/timeline-core/wikidata`).
 *
 * Dependency-free: it builds a SPARQL query, fetches from the Wikidata Query
 * Service, and maps the standard SPARQL-JSON bindings into {@link TimelineEvent}s
 * on the decimal-year scale — handling BCE (`-YYYY`) dates and date precision.
 * This is the path `ohm.openhistoryline.org` uses to turn "events from Wikidata"
 * into something the timeline can draw.
 */

import type { DecimalYear, TimelineEvent } from './types';
import { partsToDecimalYear } from './time';

export const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';

/**
 * Parse a Wikidata time literal (e.g. `+1492-10-12T00:00:00Z`, `-0753-01-01T00:00:00Z`)
 * into a decimal year. The integer part is the calendar year (sign-aware), and
 * any month/day is folded into the fraction so events sit precisely on the axis
 * (`+1492-01-01` → `1492.0`, mid-year → `1492.5`-ish). Returns `null` if unparseable.
 */
export function parseWikidataYear(iso: string | null | undefined): DecimalYear | null {
  if (!iso) return null;
  const m = /^([+-]?)(\d+)-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const year = parseInt(m[2], 10);
  const month = parseInt(m[3], 10); // 1..12 (0 when precision is year-only)
  const day = parseInt(m[4], 10); // 1..31 (0 when precision is year/month)
  return partsToDecimalYear(sign, year, month, day);
}

/** A single SPARQL-JSON binding row. */
type Binding = Record<string, { value: string; type?: string } | undefined>;

/** How to read columns out of the SPARQL result. Sensible defaults match {@link buildEventsQuery}. */
export interface WikidataMapping {
  /** Variable holding the item URI (used to derive a stable id). Default `item`. */
  id?: string;
  /** Variable holding the display title. Default `itemLabel`. */
  title?: string;
  /** Variable holding the point-in-time / start date. Default `date`. */
  date?: string;
  /** Optional variable holding an end date (turns the event into a span). Default `endDate`. */
  endDate?: string;
  /** Optional variable holding a description. Default `itemDescription`. */
  description?: string;
  /** Optional variable whose value tags each event's swimlane group (e.g. `classLabel`). */
  group?: string;
}

/** Map raw SPARQL-JSON bindings to timeline events, dropping rows without a parseable date. */
export function mapWikidataBindings(
  bindings: Binding[],
  mapping: WikidataMapping = {},
): TimelineEvent[] {
  const idVar = mapping.id ?? 'item';
  const titleVar = mapping.title ?? 'itemLabel';
  const dateVar = mapping.date ?? 'date';
  const endVar = mapping.endDate ?? 'endDate';
  const descVar = mapping.description ?? 'itemDescription';
  const groupVar = mapping.group;

  const out: TimelineEvent[] = [];
  for (const b of bindings) {
    const year = parseWikidataYear(b[dateVar]?.value);
    if (year === null) continue;
    const uri = b[idVar]?.value ?? '';
    const qid = uri.split('/').pop() || uri || `${out.length}`;
    const endYear = parseWikidataYear(b[endVar]?.value);
    out.push({
      id: qid,
      year,
      endYear: endYear !== null && endYear > year ? endYear : undefined,
      title: b[titleVar]?.value ?? qid,
      description: b[descVar]?.value,
      group: groupVar ? b[groupVar]?.value : undefined,
      url: uri || undefined,
      data: b,
    });
  }
  return out;
}

/** Options for {@link buildEventsQuery}. */
export interface EventsQueryOptions {
  /** Restrict to items that are an instance of (P31) this class. Default `Q1190554` (occurrence). */
  classQid?: string;
  /** Lower bound year (inclusive), CE. Use a negative number for BCE. */
  fromYear?: number;
  /** Upper bound year (inclusive), CE. */
  toYear?: number;
  /** Result cap. Default 500. */
  limit?: number;
  /** Label/description language. Default `en`. */
  language?: string;
}

/**
 * Build a parametric SPARQL query for dated events in a year range. WDQS is
 * sensitive to broad queries — narrow `classQid` and the year range for speed.
 * For anything bespoke, pass your own SPARQL to {@link fetchWikidataEvents}.
 */
export function buildEventsQuery(opts: EventsQueryOptions = {}): string {
  const cls = opts.classQid ?? 'Q1190554';
  const lang = opts.language ?? 'en';
  const limit = opts.limit ?? 500;
  const from = opts.fromYear !== undefined ? isoYear(opts.fromYear) : undefined;
  const to = opts.toYear !== undefined ? isoYear(opts.toYear + 1) : undefined;
  const dateFilter =
    from && to ? `  FILTER(?date >= "${from}"^^xsd:dateTime && ?date < "${to}"^^xsd:dateTime)` : '';

  return `SELECT ?item ?itemLabel ?itemDescription ?date ?endDate WHERE {
  ?item wdt:P31/wdt:P279* wd:${cls} .
  ?item wdt:P585 ?date .
  OPTIONAL { ?item wdt:P582 ?endDate . }
${dateFilter}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang}". }
}
ORDER BY ?date
LIMIT ${limit}`;
}

/** Format a (possibly BCE) year as a WDQS xsd:dateTime literal, e.g. `-0753-01-01T00:00:00Z`. */
function isoYear(year: number): string {
  const sign = year < 0 ? '-' : '+';
  const abs = Math.abs(year).toString().padStart(4, '0');
  return `${sign}${abs}-01-01T00:00:00Z`;
}

/** Options for {@link fetchWikidataEvents}. */
export interface FetchOptions extends EventsQueryOptions {
  /** A complete SPARQL query (overrides the built-in query builder). */
  sparql?: string;
  /** Endpoint URL. Default {@link WIKIDATA_ENDPOINT}. */
  endpoint?: string;
  /** Column mapping for the result. */
  mapping?: WikidataMapping;
  /** Passed through to `fetch` (e.g. an `AbortSignal`). */
  signal?: AbortSignal;
}

/**
 * Fetch events from the Wikidata Query Service and return them as
 * {@link TimelineEvent}s, ready to hand to `timeline.setEvents(...)`.
 *
 * ```ts
 * const events = await fetchWikidataEvents({ classQid: 'Q178561', fromYear: -100, toYear: 500 });
 * timeline.setEvents(events);
 * ```
 */
export async function fetchWikidataEvents(opts: FetchOptions = {}): Promise<TimelineEvent[]> {
  const endpoint = opts.endpoint ?? WIKIDATA_ENDPOINT;
  const query = opts.sparql ?? buildEventsQuery(opts);
  const url = `${endpoint}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json' },
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`Wikidata query failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { results?: { bindings?: Binding[] } };
  return mapWikidataBindings(json.results?.bindings ?? [], opts.mapping);
}
