/**
 * Deep-time helpers.
 *
 * The timeline operates directly in **decimal years**, so it never has to push
 * a `Date` outside its comfortable range. These helpers exist for (a) labelling
 * the axis and the cursor in CE/BCE terms and (b) interoperating with code —
 * such as the OHM tileserver — that exchanges the same float-year encoding the
 * map viewer uses (`year + (month+1)/12 + day/(12·31) + …`).
 *
 * Ported faithfully from the OHM map's `DecimaldatePipe` / `NicedatePipe`, with
 * the same deliberate simplification: every month is treated as 31 days. Keep
 * that in sync with the tileserver if you change it.
 */

import type { DecimalYear } from './types';

/** Days-per-month used by the decimal-date decomposition (fixed at 31 by design). */
const DAYS_PER_MONTH = 31;

/** Coerce a possibly-string year (e.g. from a URL param) to a number. */
export function numericYear(v: number | string | null | undefined): DecimalYear {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Whole-year label in the historical idiom: `1492`, `753 BCE`, `0` for the
 * (astronomical) year zero. Mirrors the map ruler's `formatTickLabel`.
 */
export function formatYear(y: DecimalYear): string {
  const yr = Math.trunc(y);
  if (yr === 0) return '0';
  return yr > 0 ? `${yr}` : `${Math.abs(yr)} BCE`;
}

/** Cursor readout form: `1492 CE`, `753 BCE`, `0`. Mirrors `formatPlain`. */
export function formatPlainYear(y: DecimalYear): string {
  const yr = Math.trunc(y);
  if (yr === 0) return '0';
  return yr >= 0 ? `${yr} CE` : `${Math.abs(yr)} BCE`;
}

/** Render a [start, end] span compactly, e.g. `1914–1918`, `27 BCE – 14 CE`. */
export function formatYearRange(start: DecimalYear, end?: DecimalYear): string {
  if (end === undefined || Math.trunc(end) === Math.trunc(start)) {
    return formatPlainYear(start);
  }
  // Same era on both ends → drop the redundant era suffix on the left.
  const a = Math.trunc(start);
  const b = Math.trunc(end);
  if ((a >= 0 && b >= 0) || (a < 0 && b < 0)) {
    return `${Math.abs(a)}–${formatPlainYear(b)}`;
  }
  return `${formatPlainYear(start)} – ${formatPlainYear(end)}`;
}

/**
 * Decompose a decimal year into a JS `Date` (the OHM tileserver encoding).
 * Faithful port of `DecimaldatePipe.transform`. Note: only meaningful for years
 * that fit the `Date` range; intended for tile coordination, not axis drawing.
 */
export function decimalToDate(value: DecimalYear): Date {
  const y = Math.trunc(value);
  let rest = Math.abs(value - y);
  const m = Math.trunc(rest * 12);
  rest = rest * 12 - m;
  const d = Math.trunc(rest * DAYS_PER_MONTH);
  rest = rest * DAYS_PER_MONTH - d;
  const H = Math.trunc(rest * 24);
  rest = rest * 24 - H;
  const M = Math.trunc(rest * 60);
  rest = rest * 60 - M;
  const S = Math.trunc(rest * 60);
  rest = rest * 60 - S;

  const ret = new Date();
  ret.setFullYear(y);
  ret.setMonth(m);
  ret.setDate(d);
  ret.setHours(H);
  ret.setMinutes(M);
  ret.setSeconds(S);
  ret.setMilliseconds(rest);
  return ret;
}

/**
 * Inverse of {@link decimalToDate}: a JS `Date` → decimal year. Faithful port of
 * `MapComponent.toDateFloat`.
 */
export function dateToDecimal(date: Date): DecimalYear {
  let ret = date.getFullYear();
  ret += (date.getMonth() + 1) / 12;
  ret += date.getDate() * (1 / 12 / DAYS_PER_MONTH);
  ret += date.getHours() * (1 / 12 / DAYS_PER_MONTH / 24);
  ret += date.getMinutes() * (1 / 12 / DAYS_PER_MONTH / 24 / 60);
  ret += date.getSeconds() * (1 / 12 / DAYS_PER_MONTH / 24 / 60 / 60);
  return ret;
}

/** Replace anglocentric `AD`/`BC` with the neutral `CE`/`BCE`. Port of `NicedatePipe`. */
export function niceDate(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace('AD', 'CE').replace('BC', 'BCE');
}

/**
 * Build a decimal year from signed calendar parts using the simplified OHM
 * month model (every month = 31 days). The fraction always advances time
 * forward, so it is added for both CE and BCE (`-753-06` → `-753 + frac`).
 * Shared by the Wikidata and vis-timeline string parsers so they agree.
 */
export function partsToDecimalYear(
  sign: 1 | -1,
  year: number,
  month: number,
  day: number,
): DecimalYear {
  let frac = 0;
  if (month > 0) frac += (month - 1) / 12;
  if (day > 0) frac += (day - 1) / (12 * 31);
  return sign * year + frac;
}

/**
 * Convert a real calendar `Date` to a decimal year with a true day-of-year
 * fraction (leap years respected), e.g. `1 Jul 2020` → `2020.4986…`. Uses UTC
 * fields and avoids `Date.UTC`'s two-digit-year remapping, so years 0–99 and
 * negative (BCE) years are handled correctly. This is the inverse of
 * {@link decimalToCalendarDate}.
 */
export function calendarDecimal(date: Date): DecimalYear {
  const y = date.getUTCFullYear();
  const startOfYear = new Date(0);
  startOfYear.setUTCFullYear(y, 0, 1);
  startOfYear.setUTCHours(0, 0, 0, 0);
  const startOfNext = new Date(0);
  startOfNext.setUTCFullYear(y + 1, 0, 1);
  startOfNext.setUTCHours(0, 0, 0, 0);
  const span = startOfNext.getTime() - startOfYear.getTime();
  return y + (date.getTime() - startOfYear.getTime()) / span;
}

/** Inverse of {@link calendarDecimal}: a decimal year → a real calendar `Date`. */
export function decimalToCalendarDate(year: DecimalYear): Date {
  const y = Math.floor(year);
  const frac = year - y;
  const startOfYear = new Date(0);
  startOfYear.setUTCFullYear(y, 0, 1);
  startOfYear.setUTCHours(0, 0, 0, 0);
  const startOfNext = new Date(0);
  startOfNext.setUTCFullYear(y + 1, 0, 1);
  startOfNext.setUTCHours(0, 0, 0, 0);
  const span = startOfNext.getTime() - startOfYear.getTime();
  return new Date(startOfYear.getTime() + frac * span);
}

/** Decimal-year fractions of one month, one day, and one hour in the OHM model. */
export const MONTH = 1 / 12;
export const DAY = 1 / 12 / 31;
export const HOUR = 1 / 12 / 31 / 24;

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Decompose a decimal year into OHM-model components — `year` (calendar),
 * `month` 0–11, `day` 0–30, `hour` 0–23 — using floor so negative (BCE) years
 * stay monotonic. Matches the axis encoding (12 months, 31 days, 24 hours).
 */
export function decomposeYear(value: DecimalYear): {
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  const year = Math.floor(value);
  let rest = value - year;
  const month = Math.min(11, Math.floor(rest * 12));
  rest = rest * 12 - month;
  const day = Math.min(30, Math.floor(rest * 31));
  rest = rest * 31 - day;
  const hour = Math.min(23, Math.floor(rest * 24));
  return { year, month, day, hour };
}

/**
 * Cursor readout that grows more precise as you zoom: just the year for wide
 * spans, then month, day, and hour as `span` (visible years) shrinks.
 */
export function formatCursor(value: DecimalYear, span: number): string {
  const yr = formatPlainYear(value);
  if (span > 6) return yr;
  const { month, day, hour } = decomposeYear(value);
  if (span > 0.5) return `${MONTHS_SHORT[month]} ${yr}`;
  if (span > 0.04) return `${day + 1} ${MONTHS_SHORT[month]} ${yr}`;
  return `${day + 1} ${MONTHS_SHORT[month]} ${yr}, ${String(hour).padStart(2, '0')}h`;
}
