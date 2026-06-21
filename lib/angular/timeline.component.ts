import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import {
  Timeline as CoreTimeline,
  type Era,
  type PlayOptions,
  type Theme,
  type TimelineEvent,
  type TimelineGroup,
  type ViewRange,
} from '@openhistorymap/timeline-core';

/**
 * Angular binding for the OpenHistoryMap deep-time timeline.
 *
 * ```html
 * <timelin-timeline
 *   [(year)]="year"
 *   [events]="events"
 *   (eventSelect)="open($event)">
 * </timelin-timeline>
 * ```
 *
 * The `[(year)]` two-way binding pairs the `year` input with the `yearChange`
 * output. The component runs the core outside Angular's zone (it does its own
 * rendering) and only re-enters the zone to emit outputs.
 */
@Component({
  selector: 'timelin-timeline',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  template: `<div #host class="timelin-host"></div>`,
  styles: [
    `:host { display: block; width: 100%; height: var(--timelin-height, 120px); }
     .timelin-host { width: 100%; height: 100%; }`,
  ],
})
export class TimelinTimelineComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() year = 866;
  @Input() events: TimelineEvent[] = [];
  @Input() groups?: TimelineGroup[];
  @Input() groupMode?: 'auto' | 'swimlane' | 'flat';
  @Input() autoHeight = true;
  @Input() groupGutter?: number;
  @Input() eras?: Era[];
  @Input() viewSpan?: number;
  @Input() theme?: Partial<Theme>;
  @Input() minSpan?: number;
  @Input() maxSpan?: number;
  @Input() animate = true;
  @Input() seekOnEventClick = true;

  @Output() yearChange = new EventEmitter<number>();
  @Output() rangeChange = new EventEmitter<ViewRange>();
  @Output() eraSelect = new EventEmitter<Era>();
  @Output() eventSelect = new EventEmitter<TimelineEvent>();
  @Output() groupSelect = new EventEmitter<TimelineGroup>();
  @Output() playing = new EventEmitter<boolean>();

  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;

  private tl?: CoreTimeline;
  private lastEmittedYear = NaN;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.tl = new CoreTimeline(this.hostRef.nativeElement, {
        year: this.year,
        events: this.events,
        groups: this.groups,
        groupMode: this.groupMode,
        autoHeight: this.autoHeight,
        groupGutter: this.groupGutter,
        eras: this.eras,
        viewSpan: this.viewSpan,
        theme: this.theme,
        minSpan: this.minSpan,
        maxSpan: this.maxSpan,
        animate: this.animate,
        seekOnEventClick: this.seekOnEventClick,
      });

      this.tl.on('yearChange', (y) =>
        this.zone.run(() => {
          this.lastEmittedYear = y;
          this.yearChange.emit(y);
        }),
      );
      this.tl.on('rangeChange', (r) => this.zone.run(() => this.rangeChange.emit(r)));
      this.tl.on('eraSelect', (e) => this.zone.run(() => this.eraSelect.emit(e)));
      this.tl.on('eventSelect', (e) => this.zone.run(() => this.eventSelect.emit(e)));
      this.tl.on('groupSelect', (g) => this.zone.run(() => this.groupSelect.emit(g)));
      this.tl.on('play', () => this.zone.run(() => this.playing.emit(true)));
      this.tl.on('pause', () => this.zone.run(() => this.playing.emit(false)));
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.tl) return;
    if (changes['year'] && Math.abs(this.year - this.lastEmittedYear) > 0.0001) {
      this.tl.setYear(this.year, { silent: true });
    }
    if (changes['events'] && this.events) this.tl.setEvents(this.events);
    if (changes['groups'] && this.groups) this.tl.setGroups(this.groups);
    if (changes['eras'] && this.eras) this.tl.setEras(this.eras);
    if (changes['theme'] && this.theme) this.tl.setTheme(this.theme);
  }

  ngOnDestroy(): void {
    this.tl?.destroy();
  }

  /** Start playback. */
  play(opts?: PlayOptions): void {
    this.tl?.play(opts);
  }

  /** Stop playback. */
  pause(): void {
    this.tl?.pause();
  }

  /** Underlying core instance (escape hatch). */
  get instance(): CoreTimeline | undefined {
    return this.tl;
  }
}
