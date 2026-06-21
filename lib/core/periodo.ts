/**
 * PeriodO compatibility adapter
 * (subpath export `@openhistorymap/timeline-core/periodo`).
 *
 * [PeriodO](https://perio.do) is a gazetteer of scholarly definitions of
 * historical, art-historical, and archaeological periods. Each *period* has a
 * label, a temporal extent (`start`/`stop`, often BCE), a spatial coverage, and
 * a source *authority*. This adapter maps the PeriodO JSON-LD dataset into
 * timel.in {@link TimelineEvent}s — and, because periods are naturally grouped
 * by region or by authority, into {@link TimelineGroup} swimlanes.
 *
 * ```ts
 * import { fetchPeriodo } from '@openhistorymap/timeline-core/periodo';
 * const { events, groups } = await fetchPeriodo({ spatialCoverage: 'Levant' });
 * tl.setGroups(groups);
 * tl.setEvents(events);
 * ```
 *
 * Zero dependency on PeriodO; the types below describe just the fields we read.
 *
 * **Calendar note.** PeriodO years follow ISO 8601, which *has* a year zero
 * (so `-3499` is labelled "3500 B.C.E."). timel.in displays a negative year `N`
 * as "`|N|` BCE", so by default the adapter shifts BCE years by one
 * (`-3499` → `-3500`) to keep labels matching PeriodO. Pass `shiftBce: false`
 * to take the ISO integers verbatim.
 */

import type { TimelineEvent, TimelineGroup, DecimalYear } from './types';

export const PERIODO_DATASET_URL = 'https://data.perio.do/d.json';

/* --- Loose shapes of the bits of the PeriodO model we read --- */
interface PeriodoTerminus {
  year?: string;
  earliestYear?: string;
  latestYear?: string;
}
interface PeriodoBoundary {
  in?: PeriodoTerminus;
  label?: string;
}
interface PeriodoSpatial {
  id?: string;
  label?: string;
}
interface PeriodoSource {
  title?: string;
  yearPublished?: number | string;
  partOf?: { title?: string };
}
export interface PeriodoPeriod {
  id?: string;
  label?: string;
  localizedLabels?: Record<string, string[]>;
  languageTag?: string;
  start?: PeriodoBoundary;
  stop?: PeriodoBoundary;
  spatialCoverage?: PeriodoSpatial[];
  spatialCoverageDescription?: string;
  [key: string]: unknown;
}
export interface PeriodoAuthority {
  id?: string;
  source?: PeriodoSource;
  periods?: Record<string, PeriodoPeriod>;
  /* legacy schema */
  definitions?: Record<string, PeriodoPeriod>;
}
export interface PeriodoDataset {
  authorities?: Record<string, PeriodoAuthority>;
  /* legacy schema */
  periodCollections?: Record<string, PeriodoAuthority>;
}

export interface PeriodoOptions {
  /** How to derive swimlanes. Default `'spatialCoverage'`; `'none'` produces no groups. */
  groupBy?: 'spatialCoverage' | 'authority' | 'none';
  /** Preferred label language (matched against `localizedLabels`). Default `'en'`. */
  language?: string;
  /** Shift ISO-8601 BCE years by one so labels match PeriodO. Default true. */
  shiftBce?: boolean;
  /** Base used to build `event.url` from a period id. Default the PeriodO ARK resolver. */
  uriBase?: string;
  /** Assign distinct accent colours to derived groups. Default true. */
  colorGroups?: boolean;
  /** Keep only periods intersecting `[fromYear, toYear]` (decimal years, BCE negative). */
  fromYear?: number;
  toYear?: number;
  /** Keep only periods whose coverage label/description contains this (case-insensitive). */
  spatialCoverage?: string;
  /** Cap the number of events produced. */
  limit?: number;
}

/* A small palette of brass-compatible accents for derived groups. */
const GROUP_PALETTE = [
  'oklch(0.74 0.115 78)',
  'oklch(0.70 0.11 210)',
  'oklch(0.72 0.12 150)',
  'oklch(0.70 0.12 30)',
  'oklch(0.72 0.10 320)',
  'oklch(0.74 0.10 110)',
  'oklch(0.70 0.11 260)',
  'oklch(0.72 0.12 60)',
];

/**
 * Parse a PeriodO year string (ISO 8601, possibly negative) into a decimal year.
 * With `shiftBce` (default), years `<= 0` are decremented so PeriodO's "N B.C.E."
 * labels line up with timel.in's display. Returns `null` if unparseable.
 */
export function parsePeriodoYear(
  value: string | undefined | null,
  shiftBce = true,
): DecimalYear | null {
  if (value == null) return null;
  const m = /^\s*(-?\d+)/.exec(String(value));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n)) return null;
  return shiftBce && n <= 0 ? n - 1 : n;
}

function terminusYear(b: PeriodoBoundary | undefined, prefer: 'early' | 'late', shift: boolean) {
  const t = b?.in;
  if (!t) return null;
  const order = prefer === 'early' ? [t.year, t.earliestYear, t.latestYear] : [t.year, t.latestYear, t.earliestYear];
  for (const v of order) {
    const y = parsePeriodoYear(v, shift);
    if (y !== null) return y;
  }
  return null;
}

function pickLabel(p: PeriodoPeriod, lang: string): string {
  const loc = p.localizedLabels;
  if (loc && loc[lang] && loc[lang].length) return loc[lang][0];
  if (p.label) return p.label;
  if (loc) {
    for (const k of Object.keys(loc)) if (loc[k]?.length) return loc[k][0];
  }
  return p.id ?? 'period';
}

function sourceTitle(a: PeriodoAuthority): string {
  return a.source?.title ?? a.source?.partOf?.title ?? a.id ?? 'source';
}

function coverageLabel(p: PeriodoPeriod): string {
  if (p.spatialCoverageDescription) return p.spatialCoverageDescription;
  const first = p.spatialCoverage?.find((s) => s.label)?.label;
  return first ?? 'Unspecified';
}

/** Map a single PeriodO period to a {@link TimelineEvent}, or `null` if it has no usable date. */
export function periodToEvent(
  period: PeriodoPeriod,
  authority?: PeriodoAuthority,
  opts: PeriodoOptions = {},
): TimelineEvent | null {
  const shift = opts.shiftBce !== false;
  const lang = opts.language ?? 'en';
  const start = terminusYear(period.start, 'early', shift);
  const stop = terminusYear(period.stop, 'late', shift);
  if (start === null && stop === null) return null;

  const year = start ?? (stop as number);
  const end = start !== null && stop !== null && stop > start ? stop : undefined;

  const group =
    opts.groupBy === 'authority'
      ? authority
        ? sourceTitle(authority)
        : undefined
      : opts.groupBy === 'none'
        ? undefined
        : coverageLabel(period);

  const cov = period.spatialCoverageDescription;
  const src = authority ? sourceTitle(authority) : undefined;
  const yr = authority?.source?.yearPublished;
  const description = [cov, src && (yr ? `${src} (${yr})` : src)].filter(Boolean).join(' · ') || undefined;

  const base = opts.uriBase ?? 'https://n2t.net/ark:/99152/';

  return {
    id: period.id ?? pickLabel(period, lang),
    year,
    endYear: end,
    title: pickLabel(period, lang),
    description,
    group,
    url: period.id ? base + period.id : undefined,
    data: period,
  };
}

/**
 * Map a whole PeriodO dataset (current `authorities` schema or the legacy
 * `periodCollections` schema) to events and derived swimlane groups.
 */
export function fromPeriodoDataset(
  dataset: PeriodoDataset,
  opts: PeriodoOptions = {},
): { events: TimelineEvent[]; groups: TimelineGroup[] } {
  const authorities = dataset.authorities ?? dataset.periodCollections ?? {};
  const filter = opts.spatialCoverage?.toLowerCase();
  const events: TimelineEvent[] = [];

  outer: for (const aId of Object.keys(authorities)) {
    const authority = authorities[aId];
    const periods = authority.periods ?? authority.definitions ?? {};
    for (const pId of Object.keys(periods)) {
      const ev = periodToEvent(periods[pId], authority, opts);
      if (!ev) continue;

      if (filter) {
        const p = periods[pId];
        const hay = [
          p.spatialCoverageDescription ?? '',
          ...(p.spatialCoverage ?? []).map((s) => s.label ?? ''),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(filter)) continue;
      }
      if (opts.fromYear !== undefined || opts.toYear !== undefined) {
        const lo = opts.fromYear ?? -Infinity;
        const hi = opts.toYear ?? Infinity;
        const evEnd = ev.endYear ?? ev.year;
        if (evEnd < lo || ev.year > hi) continue;
      }

      events.push(ev);
      if (opts.limit !== undefined && events.length >= opts.limit) break outer;
    }
  }

  const groups = opts.groupBy === 'none' ? [] : deriveGroups(events, opts.colorGroups !== false);
  return { events, groups };
}

function deriveGroups(events: TimelineEvent[], colorize: boolean): TimelineGroup[] {
  const labels = [...new Set(events.map((e) => e.group).filter((g): g is string => !!g))].sort(
    (a, b) => a.localeCompare(b),
  );
  return labels.map((label, i) => ({
    id: label,
    label,
    order: i,
    color: colorize ? GROUP_PALETTE[i % GROUP_PALETTE.length] : undefined,
  }));
}

export interface FetchPeriodoOptions extends PeriodoOptions {
  /** Dataset URL. Default {@link PERIODO_DATASET_URL} (the full dump — narrow with filters). */
  url?: string;
  /** Passed through to `fetch` (e.g. an `AbortSignal`). */
  signal?: AbortSignal;
}

/**
 * Fetch the PeriodO dataset and map it. The full dump is large — pass
 * `spatialCoverage`, `fromYear`/`toYear`, or `limit` to narrow it.
 */
export async function fetchPeriodo(
  opts: FetchPeriodoOptions = {},
): Promise<{ events: TimelineEvent[]; groups: TimelineGroup[] }> {
  const url = opts.url ?? PERIODO_DATASET_URL;
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`PeriodO fetch failed: ${res.status} ${res.statusText}`);
  const dataset = (await res.json()) as PeriodoDataset;
  return fromPeriodoDataset(dataset, opts);
}
