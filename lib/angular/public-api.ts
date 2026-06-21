export { TimelinTimelineComponent } from './timeline.component';

// Re-export core types so Angular consumers only need this package + core.
export type {
  DecimalYear,
  Era,
  TimelineEvent,
  TimelineGroup,
  Theme,
  ViewRange,
  PlayOptions,
} from '@openhistorymap/timeline-core';
export { DEFAULT_ERAS } from '@openhistorymap/timeline-core';
