import { AfterViewInit, Component, ElementRef, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TimelinTimelineComponent } from '@openhistorymap/timeline-angular';
import { formatYearRange, type TimelineEvent, type TimelineGroup } from '@openhistorymap/timeline-core';
import {
  CATEGORIES,
  LAYERS,
  entityLayer,
  eventCountry,
  fetchWikidataInfo,
  placesFromData,
  qidFromUrl,
  searchEntities,
  type EntityHit,
  type Layer,
  type PlaceRef,
  type WikidataInfo,
} from './data';

export type GroupMode = 'layer' | 'country' | 'layer-country';

@Component({
  selector: 'ohl-root',
  standalone: true,
  imports: [CommonModule, FormsModule, TimelinTimelineComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements AfterViewInit {
  @ViewChild(TimelinTimelineComponent) private tl?: TimelinTimelineComponent;
  @ViewChild('stage', { static: true }) private stageRef!: ElementRef<HTMLElement>;

  /** Cap the timeline at the stage height; taller lane stacks scroll internally. */
  stageHeight = 420;
  private stageObs?: ResizeObserver;

  readonly categories = CATEGORIES;
  dynamicLayers: Layer[] = [];

  /** Active layer ids (composable — any number on at once). */
  active = new Set<string>();
  /** Fetched events per layer (so toggling is instant after first load). */
  private cache = new Map<string, TimelineEvent[]>();
  counts = new Map<string, number>();
  loadingIds = new Set<string>();

  totalEvents = 0;
  year = 1000;
  status = 'Switch on layers to compose a timeline.';

  /** Which facet defines the swimlanes. */
  groupMode: GroupMode = 'layer';
  private static readonly COUNTRY_CAP = 16;
  private static readonly PER_LAYER_CAP = 6;

  /* detail panel */
  selected: TimelineEvent | null = null;
  panelOpen = false;
  info: WikidataInfo | null = null;
  infoLoading = false;
  places: PlaceRef[] = [];
  periodoUrl: string | null = null;
  private infoToken = 0;

  searchTerm = '';
  searchResults: EntityHit[] = [];
  searchOpen = false;
  searching = false;
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.measureStage();
    if (typeof ResizeObserver !== 'undefined') {
      this.stageObs = new ResizeObserver(() => this.zone.run(() => this.measureStage()));
      this.stageObs.observe(this.stageRef.nativeElement);
    }
    // Open on the headline composition: famines & droughts beside wars.
    const defaults = ['famine', 'wars'];
    defaults.forEach((id) => this.active.add(id));
    Promise.all(defaults.map((id) => this.ensureLoaded(this.byId(id)))).then(() => this.recompose(true));
  }

  private measureStage(): void {
    const h = this.stageRef?.nativeElement.clientHeight;
    if (h && Math.abs(h - this.stageHeight) > 1) this.stageHeight = h;
  }

  layersIn(category: string): Layer[] {
    return LAYERS.filter((l) => l.category === category);
  }

  private allLayers(): Layer[] {
    return [...LAYERS, ...this.dynamicLayers];
  }
  private byId(id: string): Layer | undefined {
    return this.allLayers().find((l) => l.id === id);
  }
  private activeLayers(): Layer[] {
    return this.allLayers().filter((l) => this.active.has(l.id));
  }

  async toggle(l: Layer): Promise<void> {
    if (this.active.has(l.id)) {
      this.active.delete(l.id);
      this.recompose(false);
      return;
    }
    this.active.add(l.id);
    await this.ensureLoaded(l);
    this.recompose(true);
  }

  clearAll(): void {
    this.active.clear();
    this.selected = null;
    this.recompose(false);
  }

  private async ensureLoaded(l?: Layer): Promise<void> {
    if (!l || this.cache.has(l.id)) return;
    this.loadingIds.add(l.id);
    try {
      const evs = await l.load();
      const seen = new Set<string>();
      const deduped = evs.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
      this.cache.set(l.id, deduped);
      this.counts.set(l.id, deduped.length);
    } catch (err) {
      this.active.delete(l.id);
      this.status = `Couldn’t load “${l.label}”: ${(err as Error).message}`;
    } finally {
      this.loadingIds.delete(l.id);
    }
  }

  setGroupMode(m: GroupMode): void {
    if (this.groupMode === m) return;
    this.groupMode = m;
    this.recompose(false);
  }

  private recompose(fit: boolean): void {
    const tl = this.tl?.instance;
    if (!tl) return;
    const layers = this.activeLayers();

    // Events are always coloured by their layer (type), so when grouping by
    // country you still read wars vs droughts by colour within a country lane.
    const events: TimelineEvent[] = [];
    for (const l of layers) {
      for (const raw of this.cache.get(l.id) ?? []) {
        const e: TimelineEvent = { ...raw, color: l.color };
        if (this.groupMode === 'layer') {
          e.group = l.id;
        } else {
          const country = eventCountry(raw) ?? 'Other';
          e.group = this.groupMode === 'country' ? `c:${country}` : `${l.id}::${country}`;
        }
        events.push(e);
      }
    }

    const groups = this.buildGroups(events, layers);
    tl.setGroups(groups);
    tl.setEvents(events);
    this.totalEvents = events.length;
    if (fit) this.fitToActive();
    this.status = layers.length
      ? `${layers.length} layer${layers.length > 1 ? 's' : ''} · ${events.length} events · ${groups.length} lanes`
      : 'No layers active — switch some on to compose a timeline.';
  }

  /** Build the swimlane definitions for the current grouping mode, capping lane count. */
  private buildGroups(events: TimelineEvent[], layers: Layer[]): TimelineGroup[] {
    if (this.groupMode === 'layer') {
      return layers
        .filter((l) => events.some((e) => e.group === l.id))
        .map((l, i) => ({ id: l.id, label: l.label, color: l.color, order: i }));
    }

    if (this.groupMode === 'country') {
      const counts = new Map<string, number>();
      for (const e of events) counts.set(e.group!, (counts.get(e.group!) ?? 0) + 1);
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const keep = new Set(
        ranked
          .map(([id]) => id)
          .filter((id) => id !== 'c:Other')
          .slice(0, AppComponent.COUNTRY_CAP),
      );
      let hasOther = false;
      for (const e of events)
        if (!keep.has(e.group!)) {
          e.group = 'c:Other';
          hasOther = true;
        }
      const ordered = ranked.filter(([id]) => keep.has(id)).map(([id]) => id);
      if (hasOther) ordered.push('c:Other');
      return ordered.map((id, i) => ({ id, label: id.slice(2), color: undefined, order: i }));
    }

    // layer-country composite: `${layerId}::${country}` — blocks of country lanes per layer.
    const split = (id: string): [string, string] => {
      const i = id.indexOf('::');
      return [id.slice(0, i), id.slice(i + 2)];
    };
    const perLayer = new Map<string, Map<string, number>>();
    for (const e of events) {
      const [lid, country] = split(e.group!);
      const m = perLayer.get(lid) ?? new Map<string, number>();
      m.set(country, (m.get(country) ?? 0) + 1);
      perLayer.set(lid, m);
    }
    const keep = new Set<string>();
    for (const l of layers) {
      const m = perLayer.get(l.id);
      if (!m) continue;
      [...m.entries()]
        .filter(([c]) => c !== 'Other')
        .sort((a, b) => b[1] - a[1])
        .slice(0, AppComponent.PER_LAYER_CAP)
        .forEach(([c]) => keep.add(`${l.id}::${c}`));
    }
    for (const e of events) {
      if (!keep.has(e.group!)) {
        const [lid] = split(e.group!);
        e.group = `${lid}::Other`;
      }
    }
    const groups: TimelineGroup[] = [];
    let order = 0;
    for (const l of layers) {
      const m = new Map<string, number>();
      for (const e of events) {
        const [lid, c] = split(e.group!);
        if (lid === l.id) m.set(c, (m.get(c) ?? 0) + 1);
      }
      [...m.entries()]
        .sort((a, b) => (a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : b[1] - a[1]))
        .forEach(([c]) => groups.push({ id: `${l.id}::${c}`, label: c, color: l.color, order: order++ }));
    }
    return groups;
  }

  private fitToActive(): void {
    const tl = this.tl?.instance;
    if (!tl) return;
    const vals: number[] = [];
    for (const l of this.activeLayers())
      for (const e of this.cache.get(l.id) ?? []) {
        vals.push(e.year);
        if (e.endYear != null) vals.push(e.endYear);
      }
    if (vals.length < 2) return;
    vals.sort((a, b) => a - b);
    const pct = (p: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * (vals.length - 1))))];
    let lo = pct(0.02);
    let hi = pct(0.98);
    if (hi - lo < 10) {
      lo -= 10;
      hi += 10;
    }
    const pad = (hi - lo) * 0.06;
    tl.setView(lo - pad, hi + pad);
    this.year = (lo + hi) / 2;
    tl.setYear(this.year, { animate: false, silent: true });
  }

  /* timeline outputs */
  onEvent(e: TimelineEvent): void {
    this.selected = e;
    this.panelOpen = true;
    void this.loadInfo(e);
  }

  private async loadInfo(e: TimelineEvent): Promise<void> {
    const token = ++this.infoToken;
    this.info = null;
    this.places = placesFromData(e.data);
    this.periodoUrl = e.url && /ark:|n2t\.net|perio\.do/.test(e.url) ? e.url : null;
    const qid = e.url && /wikidata\.org/.test(e.url) ? qidFromUrl(e.url) : undefined;
    if (!qid) {
      this.infoLoading = false;
      return;
    }
    this.infoLoading = true;
    try {
      const info = await fetchWikidataInfo(qid);
      if (token === this.infoToken) this.info = info;
    } catch {
      /* fall back to the basic event fields */
    } finally {
      if (token === this.infoToken) this.infoLoading = false;
    }
  }

  closePanel(): void {
    this.panelOpen = false;
    this.selected = null;
    this.info = null;
    this.places = [];
    this.periodoUrl = null;
  }

  wikipediaUrl(qid: string): string {
    return `https://www.wikidata.org/wiki/${qid}`;
  }

  onGroup(g: TimelineGroup): void {
    this.status = `Layer: ${g.label ?? g.id}`;
  }
  yearRange(e: TimelineEvent): string {
    return formatYearRange(e.year, e.endYear);
  }
  layerLabel(id: string | undefined): string {
    return id ? (this.byId(id)?.label ?? id) : '';
  }

  /* search → adds a removable layer */
  onSearchInput(): void {
    clearTimeout(this.searchTimer);
    const q = this.searchTerm;
    if (!q.trim()) {
      this.searchResults = [];
      this.searchOpen = false;
      return;
    }
    this.searchTimer = setTimeout(() => void this.runSearch(q), 250);
  }

  private async runSearch(q: string): Promise<void> {
    this.searching = true;
    try {
      this.searchResults = await searchEntities(q);
      this.searchOpen = this.searchResults.length > 0;
    } catch {
      this.searchResults = [];
    } finally {
      this.searching = false;
    }
  }

  async pickEntity(hit: EntityHit): Promise<void> {
    this.searchOpen = false;
    this.searchTerm = '';
    const id = `entity:${hit.id}`;
    let layer = this.dynamicLayers.find((d) => d.id === id);
    if (!layer) {
      layer = entityLayer(hit, this.dynamicLayers.length);
      this.dynamicLayers.push(layer);
    }
    this.active.add(id);
    await this.ensureLoaded(layer);
    this.recompose(true);
    if (!this.counts.get(id)) this.status = `No dated events found for “${hit.label}”.`;
  }

  removeDynamic(l: Layer): void {
    this.active.delete(l.id);
    this.cache.delete(l.id);
    this.counts.delete(l.id);
    this.dynamicLayers = this.dynamicLayers.filter((d) => d.id !== l.id);
    this.recompose(false);
  }

  closeSearch(): void {
    setTimeout(() => (this.searchOpen = false), 150);
  }
}
