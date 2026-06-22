import {
  DecimalYear,
  Era,
  PlayOptions,
  Theme,
  TimelineEvent,
  TimelineEventName,
  TimelineGroup,
  TimelineListener,
  TimelineOptions,
  ViewRange,
} from './types';
import { formatPlainYear, formatYear, formatYearRange, numericYear } from './time';
import { DEFAULT_ERAS } from './eras';
import { CSS, STYLE_ELEMENT_ID } from './styles';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Maps a Theme key to its CSS custom property on the root. */
const THEME_VARS: Record<keyof Theme, string> = {
  groundDeep: '--timelin-ground-deep',
  ground: '--timelin-ground',
  groundRaised: '--timelin-ground-raised',
  hairline: '--timelin-hairline',
  hairlineBright: '--timelin-hairline-bright',
  inkSoft: '--timelin-ink-soft',
  ink: '--timelin-ink',
  inkBright: '--timelin-ink-bright',
  brass: '--timelin-brass',
  brassSoft: '--timelin-brass-soft',
  fontDisplay: '--timelin-font-display',
  fontBody: '--timelin-font-body',
};

/* Vertical metrics (px). */
const LANE_AREA_TOP = 44; // where swimlanes / the flat band begin
const SUBLANE_PITCH = 17;
const EVENT_H = 12;
const ROW_PAD_V = 6;
const BOTTOM_PAD = 18;
const MIN_W = 6; // minimum pixel width of a point/short event
const LABEL_Y = 36;

interface Tick {
  year: number;
  x: number;
  major: boolean;
  label?: string;
}

/** A resolved swimlane row. `group` is null for the implicit ungrouped lane. */
interface LaneRow {
  group: TimelineGroup | null;
  top: number;
  height: number;
  subLanes: number;
  events: TimelineEvent[];
  assign: Map<string, number>;
  color?: string;
  label: string;
}

interface Layout {
  mode: 'flat' | 'swimlane';
  gutter: number;
  plotLeft: number;
  plotWidth: number;
  /** Full height of all lanes. */
  contentHeight: number;
  /** Rendered/viewport height (≤ contentHeight when scrolling). */
  effectiveHeight: number;
  /** How far the lanes can scroll vertically (contentHeight − effectiveHeight). */
  maxScrollY: number;
  laneAreaTop: number;
  rows: LaneRow[];
  /* flat-band metrics */
  flatTop: number;
  flatBottom: number;
  flatMaxLanes: number;
}

let CLIP_SEQ = 0;

/**
 * A framework-agnostic, deep-time interactive timeline.
 *
 * Renders an SVG ruler whose axis is a continuous decimal-year scale
 * (BCE → CE on one line), an event band, curated era markers, and a weighted
 * "now" cursor with playback. Tag events with a `group` and they organise into
 * styled horizontal **swimlanes**. Pan by dragging, zoom with the wheel, seek by
 * clicking. Everything is observable via {@link on}.
 *
 * ```ts
 * const tl = new Timeline(document.getElementById('tl')!, {
 *   year: 1492,
 *   events: [{ id: 'a', year: 1492, title: 'Columbus reaches the Americas' }],
 * });
 * tl.on('yearChange', (y) => console.log('now at', y));
 * ```
 */
export class Timeline {
  private root: HTMLElement;
  private wrap!: HTMLDivElement;
  private svg!: SVGSVGElement;
  private gLanes!: SVGGElement;
  private gTicks!: SVGGElement;
  private gLabels!: SVGGElement;
  private gEras!: SVGGElement;
  private gEvents!: SVGGElement;
  private gGutter!: SVGGElement;
  private gGutterBg!: SVGGElement;
  private gCursor!: SVGGElement;
  private gScrollbar!: SVGGElement;
  private gScrollClip!: SVGGElement;
  private gScrollInner!: SVGGElement;
  private clipRect!: SVGRectElement;
  private readout!: HTMLDivElement;
  private readoutPlain!: HTMLSpanElement;
  private tooltip!: HTMLDivElement;

  private opts: Required<Omit<TimelineOptions, 'theme' | 'view' | 'maxHeight'>> & {
    theme?: Partial<Theme>;
    maxHeight?: number;
  };

  private scrollY = 0;
  private clipId = `timelin-clip-${++CLIP_SEQ}`;

  private width = 1000;
  private height = 120;
  private hostHeight = 120;
  private appliedHeight: number | null = null;

  private viewStart = 766;
  private viewEnd = 966;

  private cursorYear = 866;
  private cursorX = 0;

  private eras: Era[];
  private events: TimelineEvent[];
  private groups: TimelineGroup[];

  private layout: Layout = {
    mode: 'flat',
    gutter: 0,
    plotLeft: 0,
    plotWidth: 1000,
    contentHeight: 120,
    effectiveHeight: 120,
    maxScrollY: 0,
    laneAreaTop: LANE_AREA_TOP,
    rows: [],
    flatTop: 46,
    flatBottom: 98,
    flatMaxLanes: 3,
  };

  private hoveredEra: number | null = null;
  private hoveredEvent: string | null = null;

  /* interaction state */
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartScrollY = 0;
  private dragStartView: [number, number] = [0, 0];
  private dragMoved = false;
  private gutterDown = false;
  private gutterDownY = 0;
  private scrollbarDrag = false;
  private scrollStartPointer = 0;
  private scrollStartY = 0;

  private resizeObs?: ResizeObserver;
  private cursorRaf?: number;
  private playRaf?: number;
  private playLast = 0;
  private playOpts: Required<PlayOptions> | null = null;

  private listeners: { [K in TimelineEventName]?: Set<TimelineListener<K>> } = {};
  private destroyed = false;

  constructor(host: HTMLElement, options: TimelineOptions = {}) {
    this.root = host;
    this.opts = {
      year: options.year ?? 866,
      viewSpan: options.viewSpan ?? 240,
      eras: options.eras ?? DEFAULT_ERAS,
      events: options.events ?? [],
      groups: options.groups ?? [],
      groupMode: options.groupMode ?? 'auto',
      autoHeight: options.autoHeight ?? true,
      groupGutter: options.groupGutter ?? 132,
      ungroupedLabel: options.ungroupedLabel ?? '',
      maxSubLanes: options.maxSubLanes ?? 6,
      minSpan: options.minSpan ?? 20,
      maxSpan: options.maxSpan ?? 20000,
      injectStyles: options.injectStyles ?? true,
      animate: options.animate ?? true,
      seekOnEventClick: options.seekOnEventClick ?? true,
      maxHeight: options.maxHeight,
      theme: options.theme,
    };

    this.eras = this.opts.eras.slice();
    this.events = this.opts.events.slice();
    this.groups = this.opts.groups.slice();
    this.cursorYear = numericYear(this.opts.year);

    if (this.opts.injectStyles) injectStyles();
    this.buildDom();
    if (this.opts.theme) this.setTheme(this.opts.theme);

    this.measure();
    if (options.view) {
      this.viewStart = options.view.start;
      this.viewEnd = options.view.end;
    } else {
      this.viewStart = this.cursorYear - this.opts.viewSpan / 2;
      this.viewEnd = this.cursorYear + this.opts.viewSpan / 2;
    }
    this.recompute();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(this.root);
    }
  }

  /* ===================================================================== */
  /* DOM construction                                                       */
  /* ===================================================================== */

  private buildDom() {
    this.root.classList.add('timelin-root');
    this.root.innerHTML = '';

    this.wrap = document.createElement('div');
    this.wrap.className = 'timelin-wrap';

    this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    this.svg.setAttribute('class', 'timelin-ruler');
    this.svg.setAttribute('preserveAspectRatio', 'none');

    this.gLanes = svgGroup('timelin-lanes');
    this.gTicks = svgGroup('timelin-ticks');
    this.gLabels = svgGroup('timelin-labels');
    this.gEras = svgGroup('timelin-eras');
    this.gEvents = svgGroup('timelin-events');
    this.gGutter = svgGroup('timelin-gutter-g');
    this.gGutterBg = svgGroup('timelin-gutter-bg-g');
    this.gCursor = svgGroup('timelin-cursor');
    this.gScrollbar = svgGroup('timelin-scrollbar-g');

    // The lane content (lanes, eras, events, gutter labels) lives inside a
    // clipped, vertically-translatable group, so the axis/cursor/gutter stay
    // pinned while the lanes scroll. Fixed elements are siblings outside it.
    const defs = document.createElementNS(SVG_NS, 'defs');
    const clip = document.createElementNS(SVG_NS, 'clipPath');
    clip.setAttribute('id', this.clipId);
    this.clipRect = svgEl('rect', { x: 0, y: 0, width: 1, height: 1 }) as SVGRectElement;
    clip.append(this.clipRect);
    defs.append(clip);

    this.gScrollClip = svgGroup('timelin-scrollclip');
    this.gScrollClip.setAttribute('clip-path', `url(#${this.clipId})`);
    this.gScrollInner = svgGroup('timelin-scrollinner');
    this.gScrollInner.append(this.gLanes, this.gEras, this.gEvents, this.gGutter);
    this.gScrollClip.append(this.gScrollInner);

    this.svg.append(
      defs,
      this.gGutterBg,
      this.gScrollClip,
      this.gTicks,
      this.gLabels,
      this.gCursor,
      this.gScrollbar,
    );

    this.readout = document.createElement('div');
    this.readout.className = 'timelin-readout';
    const anno = document.createElement('span');
    anno.className = 'anno';
    anno.textContent = 'anno';
    this.readoutPlain = document.createElement('span');
    this.readoutPlain.className = 'plain';
    this.readout.append(anno, this.readoutPlain);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'timelin-tooltip';
    this.tooltip.style.display = 'none';

    this.wrap.append(this.svg, this.readout);
    this.root.append(this.wrap, this.tooltip);

    this.svg.addEventListener('pointerdown', this.onPointerDown);
    this.svg.addEventListener('pointermove', this.onPointerMove);
    this.svg.addEventListener('pointerup', this.onPointerUp);
    this.svg.addEventListener('pointercancel', this.onPointerUp);
    this.svg.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /* ===================================================================== */
  /* Geometry                                                               */
  /* ===================================================================== */

  private measure() {
    this.width = this.root.clientWidth || 1000;
    this.hostHeight = Math.max(96, this.root.clientHeight || 120);
  }

  private applySvgSize() {
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute('width', String(this.width));
    this.svg.setAttribute('height', String(this.height));
  }

  private applyHostHeight(h: number | null) {
    if (h === null) {
      if (this.appliedHeight !== null) {
        this.root.style.height = '';
        this.appliedHeight = null;
      }
      return;
    }
    if (this.appliedHeight !== h) {
      this.root.style.height = `${h}px`;
      this.appliedHeight = h;
    }
  }

  private xFor(year: number): number {
    const span = this.viewEnd - this.viewStart;
    return this.layout.plotLeft + ((year - this.viewStart) / span) * this.layout.plotWidth;
  }

  private yearAt(px: number): number {
    const span = this.viewEnd - this.viewStart;
    return this.viewStart + ((px - this.layout.plotLeft) / this.layout.plotWidth) * span;
  }

  /* ===================================================================== */
  /* Layout                                                                 */
  /* ===================================================================== */

  private resolveMode(): 'flat' | 'swimlane' {
    if (this.opts.groupMode === 'flat') return 'flat';
    if (this.opts.groupMode === 'swimlane') return 'swimlane';
    const hasGroups =
      this.groups.some((g) => g.visible !== false) || this.events.some((e) => e.group != null);
    return hasGroups ? 'swimlane' : 'flat';
  }

  /** Explicit groups merged with groups derived from event tags, ordered, visible only. */
  private resolveGroups(): TimelineGroup[] {
    const map = new Map<string, TimelineGroup>();
    this.groups.forEach((g, i) => map.set(g.id, { order: i, ...g }));
    let order = this.groups.length;
    for (const e of this.events) {
      if (e.group != null && !map.has(e.group)) map.set(e.group, { id: e.group, order: order++ });
    }
    return [...map.values()]
      .filter((g) => g.visible !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  private computeLayout(): Layout {
    const mode = this.resolveMode();

    if (mode === 'flat') {
      const top = 46;
      const h = Math.max(96, this.hostHeight);
      const bottom = h - 22;
      const maxLanes = Math.max(1, Math.floor((bottom - top) / SUBLANE_PITCH));
      return {
        mode,
        gutter: 0,
        plotLeft: 0,
        plotWidth: this.width,
        contentHeight: h,
        effectiveHeight: h,
        maxScrollY: 0,
        laneAreaTop: top,
        rows: [],
        flatTop: top,
        flatBottom: bottom,
        flatMaxLanes: maxLanes,
      };
    }

    const gutter = this.opts.groupGutter;
    const groups = this.resolveGroups();
    const visibleIds = new Set(groups.map((g) => g.id));

    const byGroup = new Map<string, TimelineEvent[]>();
    const ungrouped: TimelineEvent[] = [];
    for (const e of this.events) {
      if (e.group != null) {
        if (!visibleIds.has(e.group)) continue; // hidden group
        const list = byGroup.get(e.group);
        if (list) list.push(e);
        else byGroup.set(e.group, [e]);
      } else {
        ungrouped.push(e);
      }
    }

    const rows: LaneRow[] = [];
    let y = LANE_AREA_TOP;
    const addRow = (group: TimelineGroup | null, evs: TimelineEvent[], label: string) => {
      const { assign, lanes } = packYearSpace(evs, this.opts.maxSubLanes, group?.lanes);
      const height = ROW_PAD_V * 2 + lanes * SUBLANE_PITCH;
      rows.push({ group, top: y, height, subLanes: lanes, events: evs, assign, color: group?.color, label });
      y += height;
    };

    for (const g of groups) addRow(g, byGroup.get(g.id) ?? [], g.label ?? g.id);
    if (ungrouped.length) addRow(null, ungrouped, this.opts.ungroupedLabel);

    const contentHeight = Math.max(96, y + BOTTOM_PAD);
    // Cap the rendered height (autoHeight grows to content, bounded by maxHeight;
    // otherwise the host's height), and scroll the lanes when content overflows.
    const cap = this.opts.maxHeight;
    const effectiveHeight = this.opts.autoHeight
      ? cap != null
        ? Math.max(96, Math.min(contentHeight, cap))
        : contentHeight
      : Math.max(96, this.hostHeight);
    const maxScrollY = Math.max(0, contentHeight - effectiveHeight);
    return {
      mode,
      gutter,
      plotLeft: gutter,
      plotWidth: Math.max(1, this.width - gutter),
      contentHeight,
      effectiveHeight,
      maxScrollY,
      laneAreaTop: LANE_AREA_TOP,
      rows,
      flatTop: 0,
      flatBottom: 0,
      flatMaxLanes: 1,
    };
  }

  /* ===================================================================== */
  /* Recompute + render                                                     */
  /* ===================================================================== */

  private recompute() {
    if (this.destroyed) return;
    this.layout = this.computeLayout();

    const useAuto = this.layout.mode === 'swimlane' && this.opts.autoHeight;
    this.height = this.layout.effectiveHeight;
    this.applyHostHeight(useAuto ? this.height : null);
    this.applySvgSize();

    this.scrollY = Math.max(0, Math.min(this.scrollY, this.layout.maxScrollY));
    this.updateScrollTransform();

    this.renderLanes();
    this.renderTicks();
    this.renderEras();
    this.renderEvents();
    this.renderGutter();
    this.renderCursor();
    this.renderScrollbar();
    this.emit('rangeChange', { start: this.viewStart, end: this.viewEnd });
  }

  /** Position the lane-clip viewport and the scroll translation. */
  private updateScrollTransform() {
    const top = this.layout.laneAreaTop;
    this.clipRect.setAttribute('x', '0');
    this.clipRect.setAttribute('y', String(top));
    this.clipRect.setAttribute('width', String(this.width));
    this.clipRect.setAttribute('height', String(Math.max(0, this.height - top)));
    this.gScrollInner.setAttribute('transform', `translate(0, ${-this.scrollY})`);
  }

  private renderScrollbar() {
    clear(this.gScrollbar);
    if (this.layout.maxScrollY <= 0) return;
    const top = this.layout.laneAreaTop;
    const viewH = this.height - top;
    const contentH = this.layout.contentHeight - top;
    const x = this.width - 5;
    this.gScrollbar.append(
      svgEl('rect', { x, y: top, width: 3, height: viewH, rx: 1.5, class: 'timelin-scrolltrack' }),
    );
    const thumbH = Math.max(24, (viewH * viewH) / contentH);
    const thumbY = top + (this.scrollY / this.layout.maxScrollY) * (viewH - thumbH);
    this.gScrollbar.append(
      svgEl('rect', { x: x - 1, y: thumbY, width: 5, height: thumbH, rx: 2.5, class: 'timelin-scrollthumb' }),
    );
  }

  private setScroll(y: number) {
    const clamped = Math.max(0, Math.min(y, this.layout.maxScrollY));
    if (clamped === this.scrollY) return;
    this.scrollY = clamped;
    this.recompute();
  }

  private renderLanes() {
    clear(this.gLanes);
    if (this.layout.mode !== 'swimlane') return;
    const { plotLeft, plotWidth, rows } = this.layout;
    // Top separator of the lane area.
    this.gLanes.append(
      svgEl('line', {
        x1: 0,
        x2: this.width,
        y1: this.layout.laneAreaTop,
        y2: this.layout.laneAreaTop,
        class: 'timelin-lane-sep',
      }),
    );
    for (const row of rows) {
      if (row.color) {
        const bg = svgEl('rect', {
          x: plotLeft,
          y: row.top,
          width: plotWidth,
          height: row.height,
          class: 'timelin-lane-bg',
        });
        bg.style.fill = row.color;
        bg.style.fillOpacity = '0.06';
        this.gLanes.append(bg);
      }
      this.gLanes.append(
        svgEl('line', {
          x1: 0,
          x2: this.width,
          y1: row.top + row.height,
          y2: row.top + row.height,
          class: 'timelin-lane-sep',
        }),
      );
    }
  }

  private renderTicks() {
    const span = this.viewEnd - this.viewStart;
    const pxPerYear = this.layout.plotWidth / span;

    let minor: number;
    let major: number;
    if (pxPerYear >= 12) {
      minor = 1;
      major = 10;
    } else if (pxPerYear >= 1.2) {
      minor = 10;
      major = 100;
    } else if (pxPerYear >= 0.12) {
      minor = 100;
      major = 1000;
    } else {
      minor = 1000;
      major = 5000;
    }

    const ticks: Tick[] = [];
    const startTick = Math.ceil(this.viewStart / minor) * minor;
    for (let yv = startTick; yv <= this.viewEnd; yv += minor) {
      const yr = Math.round(yv);
      ticks.push({
        year: yr,
        x: this.xFor(yr),
        major: yr % major === 0,
        label: yr % major === 0 ? formatYear(yr) : undefined,
      });
    }

    clear(this.gTicks);
    clear(this.gLabels);
    for (const t of ticks) {
      if (t.x < this.layout.plotLeft - 0.5) continue;
      this.gTicks.append(
        svgEl('line', {
          x1: t.x,
          x2: t.x,
          y1: t.major ? 0 : 6,
          y2: t.major ? 22 : 14,
          class: t.major ? 'timelin-tick major' : 'timelin-tick minor',
          'shape-rendering': 'crispEdges',
        }),
      );
      // Skip the leftmost label so it doesn't bleed across the gutter divider.
      if (t.label !== undefined && t.x >= this.layout.plotLeft + 14) {
        this.gLabels.append(
          svgEl(
            'text',
            {
              x: t.x,
              y: LABEL_Y,
              class: 'timelin-year-label' + (t.year === 0 ? ' epoch' : ''),
              'text-anchor': 'middle',
            },
            t.label,
          ),
        );
      }
    }
  }

  private renderEras() {
    clear(this.gEras);
    const top = this.layout.laneAreaTop;
    // Eras live in the scrolled group: span the full content so the line keeps
    // filling the viewport at any scroll offset.
    const lineBottom = this.layout.contentHeight - 6;

    this.eras.forEach((e, i) => {
      if (e.year < this.viewStart || e.year > this.viewEnd) return;
      const x = this.xFor(e.year);
      if (x < this.layout.plotLeft - 0.5) return;
      const hovered = this.hoveredEra === i;
      this.gEras.append(
        svgEl('line', {
          x1: x,
          x2: x,
          y1: top,
          y2: lineBottom,
          class: 'timelin-era-line' + (hovered ? ' is-hovered' : ''),
        }),
        svgEl('circle', {
          cx: x,
          cy: top,
          r: 2,
          class: 'timelin-era-dot' + (hovered ? ' is-hovered' : ''),
        }),
      );
      const hit = svgEl('rect', {
        x: x - 9,
        y: top - 6,
        width: 18,
        height: lineBottom - top + 6,
        class: 'timelin-era-hit',
      });
      hit.addEventListener('mouseenter', () => this.showEraTooltip(i, x));
      hit.addEventListener('mouseleave', () => this.hideTooltip());
      hit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.activateEra(i);
      });
      this.gEras.append(hit);
    });
  }

  private renderEvents() {
    clear(this.gEvents);
    if (!this.events.length) return;
    if (this.layout.mode === 'swimlane') this.renderSwimEvents();
    else this.renderFlatEvents();
  }

  private renderFlatEvents() {
    const { flatTop, flatBottom, flatMaxLanes } = this.layout;
    const lanePitch = SUBLANE_PITCH;

    const visible = this.events
      .filter((e) => {
        const end = e.endYear !== undefined ? Math.max(e.endYear, e.year) : e.year;
        return end >= this.viewStart && e.year <= this.viewEnd;
      })
      .sort((a, b) => a.year - b.year);

    const laneLastX: number[] = [];
    for (const ev of visible) {
      const isSpan = ev.endYear !== undefined && ev.endYear > ev.year;
      const x0 = this.xFor(ev.year);
      let x1 = isSpan ? this.xFor(ev.endYear as number) : x0 + MIN_W;
      if (x1 - x0 < MIN_W) x1 = x0 + MIN_W;
      let lane = laneLastX.findIndex((last) => x0 - last > 2);
      if (lane === -1) lane = laneLastX.length < flatMaxLanes ? laneLastX.length : flatMaxLanes - 1;
      laneLastX[lane] = x1;
      const y = Math.min(flatBottom - EVENT_H, flatTop + lane * lanePitch);
      this.placeEvent(ev, y, ev.color, flatTop);
    }
  }

  private renderSwimEvents() {
    for (const row of this.layout.rows) {
      for (const ev of row.events) {
        const end = ev.endYear !== undefined ? Math.max(ev.endYear, ev.year) : ev.year;
        if (end < this.viewStart || ev.year > this.viewEnd) continue;
        const sub = row.assign.get(ev.id) ?? 0;
        const y = row.top + ROW_PAD_V + sub * SUBLANE_PITCH;
        this.placeEvent(ev, y, ev.color ?? row.color, row.top);
      }
    }
  }

  /** Draw a single event marker (span or dot) plus its hit target at vertical `yTop`. */
  private placeEvent(ev: TimelineEvent, yTop: number, color: string | undefined, anchorY: number) {
    const isSpan = ev.endYear !== undefined && ev.endYear > ev.year;
    const x0 = this.xFor(ev.year);
    let x1 = isSpan ? this.xFor(ev.endYear as number) : x0 + MIN_W;
    if (x1 - x0 < MIN_W) x1 = x0 + MIN_W;
    const hovered = this.hoveredEvent === ev.id;
    const plotLeft = this.layout.plotLeft;

    if (isSpan) {
      const xC = Math.max(plotLeft, x0);
      const w = Math.min(this.width, x1) - xC;
      const rect = svgEl('rect', {
        x: xC,
        y: yTop,
        width: Math.max(1, w),
        height: EVENT_H,
        rx: 2,
        class: 'timelin-event-span' + (hovered ? ' is-hovered' : ''),
      });
      if (color) {
        rect.style.fill = color;
        rect.style.fillOpacity = hovered ? '0.6' : '0.34';
        rect.style.stroke = color;
      }
      this.gEvents.append(rect);
    } else {
      const cx = Math.max(plotLeft, Math.min(this.width, x0));
      const dot = svgEl('circle', {
        cx,
        cy: yTop + EVENT_H / 2,
        r: hovered ? 4 : 3,
        class: 'timelin-event-dot' + (hovered ? ' is-hovered' : ''),
      });
      if (color) dot.style.fill = color;
      this.gEvents.append(dot);
    }

    const hitX = Math.max(plotLeft, x0 - 4);
    const hitW = Math.max(MIN_W + 8, Math.min(this.width, x1) - hitX + 4);
    const hit = svgEl('rect', {
      x: hitX,
      y: yTop - 2,
      width: hitW,
      height: EVENT_H + 4,
      class: 'timelin-event-hit',
    });
    const cx = (Math.max(plotLeft, x0) + Math.min(this.width, x1)) / 2;
    hit.addEventListener('mouseenter', () => this.showEventTooltip(ev, cx, anchorY));
    hit.addEventListener('mouseleave', () => this.hideTooltip());
    hit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.activateEvent(ev);
    });
    this.gEvents.append(hit);
  }

  private renderGutter() {
    clear(this.gGutter);
    clear(this.gGutterBg);
    if (this.layout.mode !== 'swimlane' || this.layout.gutter <= 0) return;
    const gutter = this.layout.gutter;

    // Opaque gutter background + divider are fixed (don't scroll).
    this.gGutterBg.append(
      svgEl('rect', { x: 0, y: 0, width: gutter, height: this.height, class: 'timelin-gutter-bg' }),
      svgEl('line', { x1: gutter, x2: gutter, y1: 0, y2: this.height, class: 'timelin-gutter-divider' }),
    );

    // Per-lane accents, labels and hit areas scroll with the lanes (content coords).
    const maxChars = Math.max(3, Math.floor((gutter - 22) / 6.2));
    for (const row of this.layout.rows) {
      const cy = row.top + row.height / 2;
      if (row.color) {
        const accent = svgEl('rect', { x: 0, y: row.top, width: 3, height: row.height, class: 'timelin-lane-accent' });
        accent.style.fill = row.color;
        this.gGutter.append(accent);
      }
      if (row.label) {
        const label = svgEl(
          'text',
          {
            x: 12,
            y: cy,
            class: 'timelin-group-label' + (row.group ? ' clickable' : ''),
            'dominant-baseline': 'middle',
          },
          truncate(row.label, maxChars),
        );
        if (row.color) label.style.fill = row.color;
        this.gGutter.append(label);
      }
      if (row.group) {
        const hit = svgEl('rect', { x: 0, y: row.top, width: gutter, height: row.height, class: 'timelin-group-hit' });
        const g = row.group;
        hit.addEventListener('click', (e) => {
          e.stopPropagation();
          this.emit('groupSelect', g);
        });
        this.gGutter.append(hit);
      }
    }
  }

  private renderCursor() {
    clear(this.gCursor);
    this.cursorX = this.xFor(this.cursorYear);
    this.readoutPlain.textContent = formatPlainYear(this.cursorYear);

    const offLeft = this.cursorX < this.layout.plotLeft;
    const offRight = this.cursorX > this.width;

    if (!offLeft && !offRight) {
      const x = this.cursorX;
      this.gCursor.append(
        svgEl('line', {
          x1: x,
          x2: x,
          y1: 0,
          y2: this.height,
          class: 'timelin-cursor-line',
          'shape-rendering': 'crispEdges',
        }),
        svgEl('polygon', { class: 'timelin-cursor-cap', points: `${x - 4},0 ${x + 4},0 ${x},8` }),
        svgEl('polygon', {
          class: 'timelin-cursor-base',
          points: `${x - 4},${this.height} ${x + 4},${this.height} ${x},${this.height - 8}`,
        }),
      );
      this.readout.style.display = '';
      this.readout.style.transform = `translateX(${x}px)`;
    } else {
      this.readout.style.display = 'none';
      const edge = this.layout.plotLeft;
      if (offLeft) {
        this.gCursor.append(
          svgEl('polygon', {
            class: 'timelin-cursor-cap',
            points: `${edge + 2},28 ${edge + 12},22 ${edge + 12},34`,
          }),
        );
      } else {
        this.gCursor.append(
          svgEl('polygon', {
            class: 'timelin-cursor-cap',
            points: `${this.width - 2},28 ${this.width - 12},22 ${this.width - 12},34`,
          }),
        );
      }
    }
  }

  /* ===================================================================== */
  /* Tooltips                                                                */
  /* ===================================================================== */

  private showEraTooltip(i: number, x: number) {
    const e = this.eras[i];
    if (!e) return;
    this.hoveredEra = i;
    this.renderEras();
    this.fillTooltip(formatPlainYear(e.year), e.label, x, this.layout.laneAreaTop);
  }

  private showEventTooltip(ev: TimelineEvent, x: number, anchorY: number) {
    this.hoveredEvent = ev.id;
    this.renderEvents();
    // anchorY is a content coordinate; the lane content is scrolled by scrollY.
    const viewportY = Math.max(this.layout.laneAreaTop, anchorY - this.scrollY);
    this.fillTooltip(
      formatYearRange(ev.year, ev.endYear),
      ev.description ? `${ev.title} — ${ev.description}` : ev.title,
      x,
      viewportY,
    );
  }

  private fillTooltip(year: string, label: string, x: number, anchorY: number) {
    this.tooltip.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const yEl = document.createElement('span');
    yEl.className = 'year';
    yEl.textContent = year;
    const lEl = document.createElement('span');
    lEl.className = 'label';
    lEl.textContent = label;
    card.append(yEl, lEl);
    const tail = document.createElement('span');
    tail.className = 'tail';
    tail.setAttribute('aria-hidden', 'true');
    this.tooltip.append(card, tail);
    this.tooltip.classList.remove('down');
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${anchorY}px`;
    this.tooltip.style.display = '';
    // Open upward by default; flip downward when there isn't room above the top
    // edge (so the tooltip never spills past the timeline into the chrome above).
    const h = this.tooltip.offsetHeight;
    if (h > 0 && anchorY - h - 16 < 0) this.tooltip.classList.add('down');
  }

  private hideTooltip() {
    this.tooltip.style.display = 'none';
    if (this.hoveredEra !== null) {
      this.hoveredEra = null;
      this.renderEras();
    }
    if (this.hoveredEvent !== null) {
      this.hoveredEvent = null;
      this.renderEvents();
    }
  }

  /* ===================================================================== */
  /* Pointer interaction                                                    */
  /* ===================================================================== */

  private localX(ev: PointerEvent | WheelEvent): number {
    return ev.clientX - this.svg.getBoundingClientRect().left;
  }

  private onPointerDown = (ev: PointerEvent) => {
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
    const rect = this.svg.getBoundingClientRect();
    const lx = ev.clientX - rect.left;
    const ly = ev.clientY - rect.top;

    // Vertical scrollbar (right edge) takes priority when the lanes overflow.
    if (this.layout.maxScrollY > 0 && lx >= this.width - 12) {
      this.scrollbarDrag = true;
      this.scrollStartPointer = ev.clientY;
      this.scrollStartY = this.scrollY;
      return;
    }
    if (this.layout.mode === 'swimlane' && lx < this.layout.plotLeft) {
      this.gutterDown = true;
      this.gutterDownY = ly;
      return;
    }
    this.dragging = true;
    this.dragMoved = false;
    this.dragStartX = ev.clientX;
    this.dragStartY = ev.clientY;
    this.dragStartScrollY = this.scrollY;
    this.dragStartView = [this.viewStart, this.viewEnd];
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (this.scrollbarDrag) {
      const top = this.layout.laneAreaTop;
      const viewH = this.height - top;
      const contentH = this.layout.contentHeight - top;
      const thumbH = Math.max(24, (viewH * viewH) / contentH);
      const ratio = (ev.clientY - this.scrollStartPointer) / Math.max(1, viewH - thumbH);
      this.setScroll(this.scrollStartY + ratio * this.layout.maxScrollY);
      return;
    }
    if (!this.dragging) return;
    const dx = ev.clientX - this.dragStartX;
    const dyPx = ev.clientY - this.dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dyPx) > 3) this.dragMoved = true;

    // Horizontal drag pans time; vertical drag scrolls the lanes (2D pan).
    const span = this.dragStartView[1] - this.dragStartView[0];
    const shift = (-dx / this.layout.plotWidth) * span;
    this.viewStart = this.dragStartView[0] + shift;
    this.viewEnd = this.dragStartView[1] + shift;
    if (this.layout.maxScrollY > 0) {
      this.scrollY = Math.max(0, Math.min(this.dragStartScrollY - dyPx, this.layout.maxScrollY));
    }
    this.recompute();
  };

  private onPointerUp = (ev: PointerEvent) => {
    if (this.scrollbarDrag) {
      this.scrollbarDrag = false;
      return;
    }
    if (this.gutterDown) {
      this.gutterDown = false;
      // Click in the gutter: emit the group under the pointer (scroll-adjusted).
      const y = this.gutterDownY + this.scrollY;
      const row = this.layout.rows.find((r) => r.group && y >= r.top && y <= r.top + r.height);
      if (row?.group) this.emit('groupSelect', row.group);
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    if (!this.dragMoved) {
      const y = this.yearAt(this.localX(ev));
      this.cursorYear = y;
      this.renderCursor();
      this.emit('yearChange', y);
    }
  };

  private onWheel = (ev: WheelEvent) => {
    // Shift-wheel (or a horizontal wheel) scrolls the lanes when they overflow.
    if (this.layout.maxScrollY > 0 && (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY))) {
      ev.preventDefault();
      const d = Math.abs(ev.deltaY) > Math.abs(ev.deltaX) ? ev.deltaY : ev.deltaX;
      this.setScroll(this.scrollY + d);
      return;
    }
    // Otherwise zoom the time axis.
    ev.preventDefault();
    const cx = Math.max(this.layout.plotLeft, this.localX(ev));
    const span = this.viewEnd - this.viewStart;
    const yAtCursor = this.yearAt(cx);
    const factor = ev.deltaY > 0 ? 1.2 : 1 / 1.2;
    const newSpan = Math.max(this.opts.minSpan, Math.min(this.opts.maxSpan, span * factor));
    const ratio = (yAtCursor - this.viewStart) / span;
    this.viewStart = yAtCursor - ratio * newSpan;
    this.viewEnd = this.viewStart + newSpan;
    this.recompute();
  };

  private activateEra(i: number) {
    const e = this.eras[i];
    if (!e) return;
    this.setYear(e.year, { animate: true });
    this.emit('eraSelect', e);
  }

  private activateEvent(ev: TimelineEvent) {
    if (this.opts.seekOnEventClick) this.setYear(ev.year, { animate: true });
    this.emit('eventSelect', ev);
  }

  /* ===================================================================== */
  /* Cursor animation                                                       */
  /* ===================================================================== */

  private animateCursorTo(target: number) {
    if (this.cursorRaf) cancelAnimationFrame(this.cursorRaf);
    const start = this.cursorYear;
    const dur = 320;
    const ease = (t: number) => 1 - Math.pow(1 - t, 4);
    let t0: number | null = null;

    const step = (now: number) => {
      if (t0 === null) t0 = now;
      const t = Math.min(1, (now - t0) / dur);
      this.cursorYear = start + (target - start) * ease(t);
      this.renderCursor();
      if (t < 1) this.cursorRaf = requestAnimationFrame(step);
      else this.cursorRaf = undefined;
    };
    this.cursorRaf = requestAnimationFrame(step);
  }

  /* ===================================================================== */
  /* Playback                                                               */
  /* ===================================================================== */

  play(opts: PlayOptions = {}) {
    if (this.playRaf) cancelAnimationFrame(this.playRaf);
    this.playOpts = {
      yearsPerSecond: opts.yearsPerSecond ?? 5,
      to: opts.to ?? Number.POSITIVE_INFINITY,
      loop: opts.loop ?? false,
    };
    const startYear = this.cursorYear;
    this.playLast = 0;
    this.emit('play', undefined);

    const step = (now: number) => {
      if (!this.playOpts) return;
      if (!this.playLast) this.playLast = now;
      const dt = (now - this.playLast) / 1000;
      this.playLast = now;

      let next = this.cursorYear + this.playOpts.yearsPerSecond * dt;
      if (next >= this.playOpts.to) {
        if (this.playOpts.loop) {
          next = startYear;
        } else {
          this.cursorYear = this.playOpts.to;
          this.renderCursor();
          this.emit('yearChange', this.cursorYear);
          this.pause();
          return;
        }
      }
      this.cursorYear = next;
      this.keepCursorInView();
      this.renderCursor();
      this.emit('yearChange', this.cursorYear);
      this.playRaf = requestAnimationFrame(step);
    };
    this.playRaf = requestAnimationFrame(step);
  }

  pause() {
    if (this.playRaf) cancelAnimationFrame(this.playRaf);
    this.playRaf = undefined;
    if (this.playOpts) {
      this.playOpts = null;
      this.emit('pause', undefined);
    }
  }

  get isPlaying(): boolean {
    return this.playRaf !== undefined;
  }

  private keepCursorInView() {
    const span = this.viewEnd - this.viewStart;
    const margin = span * 0.15;
    if (this.cursorYear > this.viewEnd - margin) {
      const shift = this.cursorYear - (this.viewEnd - margin);
      this.viewStart += shift;
      this.viewEnd += shift;
      this.recompute();
    } else if (this.cursorYear < this.viewStart + margin) {
      const shift = this.viewStart + margin - this.cursorYear;
      this.viewStart -= shift;
      this.viewEnd -= shift;
      this.recompute();
    }
  }

  /* ===================================================================== */
  /* Public API                                                             */
  /* ===================================================================== */

  setYear(year: DecimalYear | string, opts: { animate?: boolean; silent?: boolean } = {}) {
    const target = numericYear(year);
    const animate = opts.animate ?? this.opts.animate;
    if (animate && Math.abs(target - this.cursorYear) > 0.0001) {
      this.animateCursorTo(target);
    } else {
      this.cursorYear = target;
      this.renderCursor();
    }
    if (!opts.silent) this.emit('yearChange', target);
  }

  getYear(): DecimalYear {
    return this.cursorYear;
  }

  setView(start: DecimalYear, end: DecimalYear) {
    this.viewStart = start;
    this.viewEnd = end;
    this.recompute();
  }

  getView(): ViewRange {
    return { start: this.viewStart, end: this.viewEnd };
  }

  centerOn(year: DecimalYear, span = this.viewEnd - this.viewStart) {
    this.viewStart = year - span / 2;
    this.viewEnd = year + span / 2;
    this.recompute();
  }

  /** Replace the event set and re-render (re-derives swimlanes). */
  setEvents(events: TimelineEvent[]) {
    this.events = events.slice();
    this.recompute();
  }

  getEvents(): TimelineEvent[] {
    return this.events.slice();
  }

  /** Replace the era markers and re-render. */
  setEras(eras: Era[]) {
    this.eras = eras.slice();
    this.renderEras();
  }

  /** Replace the swimlane definitions and re-render. */
  setGroups(groups: TimelineGroup[]) {
    this.groups = groups.slice();
    this.recompute();
  }

  getGroups(): TimelineGroup[] {
    return this.groups.slice();
  }

  setTheme(theme: Partial<Theme>) {
    for (const key of Object.keys(theme) as (keyof Theme)[]) {
      const value = theme[key];
      if (value !== undefined) this.root.style.setProperty(THEME_VARS[key], value);
    }
  }

  /**
   * Cap the rendered height (with `autoHeight`); when the lanes are taller, they
   * scroll vertically with the time axis pinned. Pass `undefined` to remove the cap.
   */
  setMaxHeight(h: number | undefined) {
    this.opts.maxHeight = h;
    this.recompute();
  }

  /** Scroll the lanes to an absolute vertical offset (clamped). */
  scrollTo(y: number) {
    this.setScroll(y);
  }

  resize() {
    if (this.destroyed) return;
    this.measure();
    this.recompute();
  }

  on<K extends TimelineEventName>(name: K, listener: TimelineListener<K>): () => void {
    (this.listeners[name] ??= new Set() as never).add(listener as never);
    return () => this.off(name, listener);
  }

  off<K extends TimelineEventName>(name: K, listener: TimelineListener<K>) {
    this.listeners[name]?.delete(listener as never);
  }

  private emit<K extends TimelineEventName>(name: K, payload: Parameters<TimelineListener<K>>[0]) {
    this.listeners[name]?.forEach((l) => (l as TimelineListener<K>)(payload));
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    if (this.cursorRaf) cancelAnimationFrame(this.cursorRaf);
    this.resizeObs?.disconnect();
    this.svg.removeEventListener('pointerdown', this.onPointerDown);
    this.svg.removeEventListener('pointermove', this.onPointerMove);
    this.svg.removeEventListener('pointerup', this.onPointerUp);
    this.svg.removeEventListener('pointercancel', this.onPointerUp);
    this.svg.removeEventListener('wheel', this.onWheel);
    this.listeners = {};
    this.root.classList.remove('timelin-root');
    this.root.style.height = '';
    this.root.innerHTML = '';
  }
}

/* ===================================================================== */
/* Helpers                                                                */
/* ===================================================================== */

/**
 * Greedily pack events into sub-lanes in *year space* (view-independent, so a
 * group's height is stable across zoom). A lane is free for an event when the
 * event's start year is at or after that lane's last end year. Points (no end)
 * have zero width, so a run of points collapses to one lane.
 */
function packYearSpace(
  events: TimelineEvent[],
  maxSub: number,
  fixed?: number,
): { assign: Map<string, number>; lanes: number } {
  const cap = fixed ?? maxSub;
  const sorted = [...events].sort((a, b) => a.year - b.year);
  const laneEnd: number[] = [];
  const assign = new Map<string, number>();
  for (const e of sorted) {
    const start = e.year;
    const end = e.endYear !== undefined && e.endYear > e.year ? e.endYear : e.year;
    let lane = laneEnd.findIndex((le) => start >= le);
    if (lane === -1) lane = laneEnd.length < cap ? laneEnd.length : cap - 1;
    laneEnd[lane] = end;
    assign.set(e.id, lane);
  }
  const used = laneEnd.length === 0 ? 1 : laneEnd.length;
  const lanes = fixed ?? Math.min(used, maxSub);
  return { assign, lanes: Math.max(1, lanes) };
}

function truncate(s: string, maxChars: number): string {
  return s.length > maxChars ? s.slice(0, Math.max(1, maxChars - 1)) + '…' : s;
}

function svgGroup(cls: string): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  g.setAttribute('class', cls);
  return g;
}

function svgEl(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  if (text !== undefined) el.textContent = text;
  return el;
}

function clear(node: Element) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Inject the bundled stylesheet once. */
export function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
