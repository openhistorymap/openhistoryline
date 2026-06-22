import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TimelinTimelineComponent } from '@openhistorymap/timeline-angular';
import { formatYearRange, type TimelineEvent, type TimelineGroup } from '@openhistorymap/timeline-core';
import {
  CATEGORIES,
  LAYERS,
  entityLayer,
  searchEntities,
  type EntityHit,
  type Layer,
} from './data';

@Component({
  selector: 'ohl-root',
  standalone: true,
  imports: [CommonModule, FormsModule, TimelinTimelineComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements AfterViewInit {
  @ViewChild(TimelinTimelineComponent) private tl?: TimelinTimelineComponent;

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
  selected: TimelineEvent | null = null;
  status = 'Switch on layers to compose a timeline.';

  searchTerm = '';
  searchResults: EntityHit[] = [];
  searchOpen = false;
  searching = false;
  private searchTimer?: ReturnType<typeof setTimeout>;

  ngAfterViewInit(): void {
    // Open on the headline composition: famines & droughts beside wars.
    const defaults = ['famine', 'wars'];
    defaults.forEach((id) => this.active.add(id));
    Promise.all(defaults.map((id) => this.ensureLoaded(this.byId(id)))).then(() => this.recompose(true));
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

  private recompose(fit: boolean): void {
    const tl = this.tl?.instance;
    if (!tl) return;
    const layers = this.activeLayers();
    const events: TimelineEvent[] = [];
    for (const l of layers) for (const e of this.cache.get(l.id) ?? []) events.push({ ...e, group: l.id });
    const groups: TimelineGroup[] = layers.map((l, i) => ({ id: l.id, label: l.label, color: l.color, order: i }));
    tl.setGroups(groups);
    tl.setEvents(events);
    this.totalEvents = events.length;
    if (fit) this.fitToActive();
    this.status = layers.length
      ? `${layers.length} layer${layers.length > 1 ? 's' : ''} · ${events.length} events`
      : 'No layers active — switch some on to compose a timeline.';
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
