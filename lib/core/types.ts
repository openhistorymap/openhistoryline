/**
 * Public types for the framework-agnostic timeline core.
 *
 * The whole library is parameterised by a single **float year** ("decimal
 * year"), matching the OpenHistoryMap convention used across the tileserver
 * and the map viewer. A year is a plain `number`: `1492`, `-753` (754 BCE),
 * `866.5` (mid-866 CE). This is what lets a single axis address deep history
 * — antiquity, BCE, and the modern era — without ever touching the awkward
 * edges of the JS `Date` range.
 */

/** A point in time on the OHM scale: a (possibly fractional, possibly negative) year. */
export type DecimalYear = number;

/** A curated "pivot point" — the dashed era markers along the ruler. */
export interface Era {
  /** Decimal year of the marker. */
  year: DecimalYear;
  /** Short caption shown in the era tooltip. */
  label: string;
  /** Optional geographic focus — emitted on selection so a host map can fly there. */
  lng?: number;
  lat?: number;
  zoom?: number;
}

/**
 * An event drawn in the timeline's event band. Events with an `endYear` render
 * as spans (bars); events without render as point markers. This is the shape a
 * Wikidata / OHM-events feed is mapped into.
 */
export interface TimelineEvent {
  /** Stable identifier (used for hit-testing and de-duplication). */
  id: string;
  /** Start of the event (decimal year). */
  year: DecimalYear;
  /** Optional end of the event; when present and `> year`, the event is a span. */
  endYear?: DecimalYear;
  /** Display title. */
  title: string;
  /** Optional longer description for the tooltip. */
  description?: string;
  /** Optional accent colour (CSS colour string) overriding the group/default brass. */
  color?: string;
  /**
   * Optional group tag. Events sharing a `group` are drawn together in one
   * horizontal swimlane (see {@link TimelineGroup}). Matches vis-timeline's
   * `group` field. When any event carries a group, the timeline switches to
   * swimlane layout (unless `groupMode` says otherwise).
   */
  group?: string;
  /** Optional link followed when the event is activated. */
  url?: string;
  /** Arbitrary passenger data echoed back in `eventSelect`. */
  data?: unknown;
}

/**
 * A swimlane definition. Groups give events a tagged horizontal lane with its
 * own label and accent colour. You can pass groups explicitly (to control
 * order, labels, and styling) or let the timeline derive them from the distinct
 * `event.group` tags. Mirrors vis-timeline's group data format.
 */
export interface TimelineGroup {
  /** Group id — matched against `TimelineEvent.group`. */
  id: string;
  /** Gutter label. Defaults to `id`. */
  label?: string;
  /** Accent colour (CSS colour). Tints the lane and is the default colour for its events. */
  color?: string;
  /** Sort order (ascending). Defaults to definition / first-seen order. */
  order?: number;
  /** Hide the lane when false. Default true. */
  visible?: boolean;
  /**
   * Fixed number of stacked sub-lanes for overlapping events. By default it is
   * computed from how many of the group's events overlap in time (stable across
   * zoom), capped by `maxSubLanes`.
   */
  lanes?: number;
  /** Extra CSS class applied to the lane's elements. */
  className?: string;
  /** Arbitrary passenger data echoed back in `groupSelect`. */
  data?: unknown;
}

/** Design tokens. Any subset overrides the built-in "library at night" palette. */
export interface Theme {
  groundDeep: string;
  ground: string;
  groundRaised: string;
  hairline: string;
  hairlineBright: string;
  inkSoft: string;
  ink: string;
  inkBright: string;
  brass: string;
  brassSoft: string;
  fontDisplay: string;
  fontBody: string;
}

/** A visible year range. */
export interface ViewRange {
  start: DecimalYear;
  end: DecimalYear;
}

/** Options accepted by playback. */
export interface PlayOptions {
  /** How many years advance per real second. Default 5. */
  yearsPerSecond?: number;
  /** Stop when the cursor reaches this year (otherwise runs until paused). */
  to?: DecimalYear;
  /** Loop back to the start year when `to` is reached. Default false. */
  loop?: boolean;
}

/** Constructor options for {@link Timeline}. */
export interface TimelineOptions {
  /** Initial cursor year. Default 866 (a nod to the OHM map's default). */
  year?: DecimalYear;
  /** Initial visible span, in years, centred on `year`. Default 240. */
  viewSpan?: number;
  /** Explicit initial view range (overrides `viewSpan` if given). */
  view?: ViewRange;
  /** Curated era markers. Defaults to the bundled OHM set; pass `[]` to disable. */
  eras?: Era[];
  /** Events to render in the event band. */
  events?: TimelineEvent[];
  /**
   * Swimlane definitions. Optional even when using groups — undefined groups are
   * derived from the distinct `event.group` tags. Use this to set order, labels,
   * colours, or visibility.
   */
  groups?: TimelineGroup[];
  /**
   * Layout mode:
   * - `'auto'` (default) — swimlanes when groups exist (passed or tagged), else a flat band.
   * - `'swimlane'` — always swimlanes.
   * - `'flat'` — never swimlanes; ignore group tags and lane-pack everything together.
   */
  groupMode?: 'auto' | 'swimlane' | 'flat';
  /** In swimlane mode, grow the host's height to fit all lanes. Default true. */
  autoHeight?: boolean;
  /**
   * Cap the rendered height in px (with `autoHeight`). When the lanes are taller,
   * the component stays at this height and scrolls them vertically — the time
   * axis, cursor and gutter stay pinned. Drag vertically, shift-wheel, or use the
   * scrollbar. Unset = grow to fit.
   */
  maxHeight?: number;
  /** Width (px) of the left label gutter in swimlane mode. Default 132; set 0 to hide it. */
  groupGutter?: number;
  /** Gutter label for the implicit lane holding untagged events. Default `''`. */
  ungroupedLabel?: string;
  /** Hard cap on auto-computed sub-lanes per group (overlap depth). Default 6. */
  maxSubLanes?: number;
  /** Minimum zoom-in span in years. Default 20. */
  minSpan?: number;
  /** Maximum zoom-out span in years. Default 20000. */
  maxSpan?: number;
  /** Inject the bundled stylesheet once into the document head. Default true. */
  injectStyles?: boolean;
  /** Token overrides applied to the component root as CSS custom properties. */
  theme?: Partial<Theme>;
  /** Animate the cursor when `setYear` is called. Default true. */
  animate?: boolean;
  /** When an event is clicked, also move the cursor to its year. Default true. */
  seekOnEventClick?: boolean;
}

/** Event payloads emitted by the timeline. */
export interface TimelineEventMap {
  /** Fired whenever the cursor year changes (click, drag-seek, playback, setYear). */
  yearChange: DecimalYear;
  /** Fired when the visible range pans or zooms. */
  rangeChange: ViewRange;
  /** Fired when a curated era marker is activated. */
  eraSelect: Era;
  /** Fired when an event marker/span is activated. */
  eventSelect: TimelineEvent;
  /** Fired when a group's gutter label is activated. */
  groupSelect: TimelineGroup;
  /** Fired when playback starts. */
  play: void;
  /** Fired when playback stops (pause or reaching `to`). */
  pause: void;
}

export type TimelineEventName = keyof TimelineEventMap;
export type TimelineListener<K extends TimelineEventName> = (
  payload: TimelineEventMap[K],
) => void;
