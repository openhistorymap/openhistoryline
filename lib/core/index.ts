/**
 * @openhistorymap/timeline-core
 *
 * A framework-agnostic, deep-time interactive timeline. Zero runtime
 * dependencies; renders an SVG ruler whose axis is a continuous decimal-year
 * scale (BCE → CE on one line), with an event band, curated era markers, a
 * weighted brass cursor, and playback.
 */

export { Timeline, injectStyles } from './timeline';
export { DEFAULT_ERAS } from './eras';
export { CSS as TIMELINE_CSS, STYLE_ELEMENT_ID } from './styles';
export {
  numericYear,
  formatYear,
  formatPlainYear,
  formatYearRange,
  decimalToDate,
  dateToDecimal,
  niceDate,
  partsToDecimalYear,
  calendarDecimal,
  decimalToCalendarDate,
} from './time';

export type {
  DecimalYear,
  Era,
  TimelineEvent,
  TimelineGroup,
  Theme,
  ViewRange,
  PlayOptions,
  TimelineOptions,
  TimelineEventMap,
  TimelineEventName,
  TimelineListener,
} from './types';
