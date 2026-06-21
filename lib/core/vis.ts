/**
 * vis-timeline compatibility adapter
 * (subpath export `@openhistorymap/timeline-core/vis`).
 *
 * Maps the [vis-timeline](https://github.com/visjs/vis-timeline) item/group data
 * format to and from {@link TimelineEvent}, so existing vis data (or the OHM
 * map's original `vis.DataSet` items) drops straight in:
 *
 * ```ts
 * import { fromVisItems } from '@openhistorymap/timeline-core/vis';
 * timeline.setEvents(fromVisItems(myVisDataSet));
 * ```
 *
 * Field mapping:
 *  - vis `content`  → `title`        (HTML stripped to text by default)
 *  - vis `title`    → `description`  (vis's tooltip)
 *  - vis `start`    → `year`         (Date | ms-number | string | decimal year)
 *  - vis `end`      → `endYear`      (turns the event into a span)
 *  - vis `type`     → point/span     (`point`/`box` are points; `range`/`background` are spans)
 *  - vis `style`    → `color`        (parsed from `background-color`/`color`)
 *  - the whole original item is preserved on `event.data`.
 *
 * Zero dependency on vis itself — the types below mirror its `DataItem`/`DataGroup`.
 */

import type { DecimalYear, TimelineEvent, TimelineGroup } from './types';
import {
  calendarDecimal,
  decimalToCalendarDate,
  partsToDecimalYear,
} from './time';

export type VisId = string | number;
export type VisDateType = Date | number | string;
export type VisItemType = 'box' | 'point' | 'range' | 'background';

/** A vis-timeline data item (subset of fields, plus passthrough). */
export interface VisDataItem {
  id?: VisId;
  content?: string;
  start: VisDateType;
  end?: VisDateType;
  type?: VisItemType;
  group?: VisId;
  className?: string;
  style?: string;
  /** vis tooltip (HTML). */
  title?: string;
  [key: string]: unknown;
}

/** A vis-timeline data group (subset of fields). */
export interface VisDataGroup {
  id: VisId;
  content?: string;
  className?: string;
  style?: string;
  order?: number;
  visible?: boolean;
  [key: string]: unknown;
}

/** Minimal shape of a vis `DataSet` (anything with a `.get()` returning an array). */
interface VisDataSetLike<T> {
  get(): T[];
}

function isDataSet<T>(x: unknown): x is VisDataSetLike<T> {
  return (
    !!x &&
    !Array.isArray(x) &&
    typeof (x as { get?: unknown }).get === 'function'
  );
}

export interface FromVisOptions {
  /**
   * Override how a vis time value becomes a decimal year. Defaults to
   * {@link decodeVisTime}. For round-tripping the OHM map's vis items (whose
   * `start` Dates came from `DecimaldatePipe`), pass `decodeTime: dateToDecimal`.
   */
  decodeTime?: (value: VisDateType | undefined | null) => DecimalYear | null;
  /** Strip HTML tags from `content`/`title`. Default true. */
  stripHtml?: boolean;
  /** Derive `color` from the item's inline `style`. Default true. */
  colorFromStyle?: boolean;
}

export interface ToVisOptions {
  /** Override how a decimal year becomes a vis time value. Default: a calendar `Date`. */
  encodeTime?: (year: DecimalYear) => VisDateType;
  /** Force a vis `type`, or compute one per event. Default: `range` for spans, `point` otherwise. */
  type?: VisItemType | ((event: TimelineEvent) => VisItemType);
}

/**
 * Decode a vis time value into a decimal year.
 *
 * - `Date` → true day-of-year fraction (leap-aware), BCE-safe.
 * - `number` → treated as a **decimal year** (so `start: 1492` means the year).
 *   If you genuinely have epoch-millisecond timestamps, pass
 *   `decodeTime: (n) => calendarDecimal(new Date(n as number))`.
 * - `string` → a bare year (`"1492"`, `"-753"`) or an ISO-ish date
 *   (`"+1492-10-12T..."`, BCE included); otherwise parsed via `Date`.
 *
 * Returns `null` when the value can't be understood.
 */
export function decodeVisTime(value: VisDateType | undefined | null): DecimalYear | null {
  if (value === undefined || value === null) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : calendarDecimal(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    const iso = /^([+-]?)(\d{1,7})-(\d{2})-(\d{2})/.exec(s);
    if (iso) {
      const sign = iso[1] === '-' ? -1 : 1;
      return partsToDecimalYear(sign, parseInt(iso[2], 10), parseInt(iso[3], 10), parseInt(iso[4], 10));
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : calendarDecimal(new Date(t));
  }
  // Moment-like / valueOf-able objects.
  const maybe = value as { toDate?: () => Date; valueOf?: () => unknown };
  if (typeof maybe.toDate === 'function') return calendarDecimal(maybe.toDate());
  if (typeof maybe.valueOf === 'function') {
    const v = maybe.valueOf();
    if (typeof v === 'number' && Number.isFinite(v)) return calendarDecimal(new Date(v));
  }
  return null;
}

/** Encode a decimal year into a vis time value (a calendar `Date`; lossy outside the `Date` range). */
export function encodeDecimalToVis(year: DecimalYear): VisDateType {
  return decimalToCalendarDate(year);
}

/** Map one vis item to a {@link TimelineEvent}, or `null` if its `start` is unparseable. */
export function fromVisItem(item: VisDataItem, opts: FromVisOptions = {}): TimelineEvent | null {
  const decode = opts.decodeTime ?? decodeVisTime;
  const year = decode(item.start);
  if (year === null) return null;

  const isPointType = item.type === 'point' || item.type === 'box';
  let endYear = !isPointType && item.end != null ? decode(item.end) : null;
  if (endYear !== null && endYear <= year) endYear = null;

  const strip = opts.stripHtml !== false;
  const title = cleanText(item.content, strip) || (item.id != null ? String(item.id) : '');
  const description = item.title ? cleanText(item.title, strip) : undefined;
  const color =
    opts.colorFromStyle !== false && item.style ? parseColor(item.style) : undefined;

  return {
    id: item.id != null ? String(item.id) : title,
    year,
    endYear: endYear ?? undefined,
    title,
    description,
    color,
    group: item.group != null ? String(item.group) : undefined,
    url: typeof item['url'] === 'string' ? (item['url'] as string) : undefined,
    data: item,
  };
}

/** Map an array (or vis `DataSet`) of vis items to {@link TimelineEvent}s, dropping unparseable ones. */
export function fromVisItems(
  items: VisDataItem[] | VisDataSetLike<VisDataItem>,
  opts: FromVisOptions = {},
): TimelineEvent[] {
  const arr = isDataSet<VisDataItem>(items) ? items.get() : items;
  const out: TimelineEvent[] = [];
  arr.forEach((it, i) => {
    const ev = fromVisItem(it, opts);
    if (!ev) return;
    if (!ev.id) ev.id = `vis-${i}`;
    out.push(ev);
  });
  return out;
}

/** Map a {@link TimelineEvent} to a vis item. */
export function toVisItem(event: TimelineEvent, opts: ToVisOptions = {}): VisDataItem {
  const encode = opts.encodeTime ?? encodeDecimalToVis;
  const isSpan = event.endYear !== undefined && event.endYear > event.year;
  const type =
    typeof opts.type === 'function' ? opts.type(event) : opts.type ?? (isSpan ? 'range' : 'point');

  const item: VisDataItem = {
    id: event.id,
    content: event.title,
    start: encode(event.year),
    type,
  };
  if (isSpan) item.end = encode(event.endYear as number);
  if (event.description) item.title = event.description;
  if (event.color) item.style = `background-color: ${event.color};`;
  if (event.group) item.group = event.group;
  if (event.url) item['url'] = event.url;
  return item;
}

/** Map a vis-timeline group to a {@link TimelineGroup} swimlane. */
export function fromVisGroup(g: VisDataGroup, opts: FromVisOptions = {}): TimelineGroup {
  const strip = opts.stripHtml !== false;
  return {
    id: String(g.id),
    label: cleanText(g.content, strip) || String(g.id),
    color: opts.colorFromStyle !== false && g.style ? parseColor(g.style) : undefined,
    order: typeof g.order === 'number' ? g.order : undefined,
    visible: g.visible,
    className: g.className,
    data: g,
  };
}

/** Map vis groups (array or `DataSet`) to {@link TimelineGroup}s. */
export function fromVisGroups(
  groups: VisDataGroup[] | VisDataSetLike<VisDataGroup>,
  opts: FromVisOptions = {},
): TimelineGroup[] {
  const arr = isDataSet<VisDataGroup>(groups) ? groups.get() : groups;
  return arr.map((g) => fromVisGroup(g, opts));
}

/** Map a {@link TimelineGroup} to a vis group. */
export function toVisGroup(group: TimelineGroup): VisDataGroup {
  const g: VisDataGroup = { id: group.id };
  if (group.label) g.content = group.label;
  if (group.color) g.style = `color: ${group.color};`;
  if (group.order !== undefined) g.order = group.order;
  if (group.visible !== undefined) g.visible = group.visible;
  if (group.className) g.className = group.className;
  return g;
}

/** Map {@link TimelineGroup}s to vis groups. */
export function toVisGroups(groups: TimelineGroup[]): VisDataGroup[] {
  return groups.map(toVisGroup);
}

/** Map {@link TimelineEvent}s to vis items (e.g. to feed a real vis-timeline). */
export function toVisItems(events: TimelineEvent[], opts: ToVisOptions = {}): VisDataItem[] {
  return events.map((e) => toVisItem(e, opts));
}

/** Convenience: decode vis items and push them onto a timeline. */
export function applyVisItems(
  timeline: { setEvents(events: TimelineEvent[]): void },
  items: VisDataItem[] | VisDataSetLike<VisDataItem>,
  opts: FromVisOptions = {},
): void {
  timeline.setEvents(fromVisItems(items, opts));
}

/** Convenience: decode a vis `{ items, groups }` pair (the swimlane case) onto a timeline. */
export function applyVisData(
  timeline: {
    setEvents(events: TimelineEvent[]): void;
    setGroups(groups: TimelineGroup[]): void;
  },
  data: {
    items: VisDataItem[] | VisDataSetLike<VisDataItem>;
    groups?: VisDataGroup[] | VisDataSetLike<VisDataGroup>;
  },
  opts: FromVisOptions = {},
): void {
  if (data.groups) timeline.setGroups(fromVisGroups(data.groups, opts));
  timeline.setEvents(fromVisItems(data.items, opts));
}

/* ----------------------------------------------------------------------- */

function cleanText(html: string | undefined, strip: boolean): string {
  if (!html) return '';
  let s = html;
  if (strip) s = s.replace(/<[^>]*>/g, '');
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseColor(style: string): string | undefined {
  const bg = /background-color\s*:\s*([^;]+)/i.exec(style) || /background\s*:\s*([^;]+)/i.exec(style);
  if (bg) return bg[1].trim();
  const fg = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
  return fg ? fg[1].trim() : undefined;
}
