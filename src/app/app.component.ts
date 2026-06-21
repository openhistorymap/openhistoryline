import { AfterViewInit, Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TimelinTimelineComponent } from '@openhistorymap/timeline-angular';
import { formatYearRange, type TimelineEvent, type TimelineGroup } from '@openhistorymap/timeline-core';
import {
  COLLECTIONS,
  eventsForEntity,
  searchEntities,
  type Collection,
  type EntityHit,
  type LoadResult,
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

  readonly collections = COLLECTIONS;
  readonly sources: Array<'Wikidata' | 'PeriodO'> = ['Wikidata', 'PeriodO'];

  activeId: string | null = null;
  loading = false;
  status = 'Pick a collection, or search Wikidata for a place, person, or empire.';
  year = 1000;
  selected: TimelineEvent | null = null;

  searchTerm = '';
  searchResults: EntityHit[] = [];
  searchOpen = false;
  searching = false;
  private searchTimer?: ReturnType<typeof setTimeout>;

  ngAfterViewInit(): void {
    // Lead with the headline swimlane collection.
    const first = this.collections.find((c) => c.id === 'conflicts') ?? this.collections[0];
    void this.selectCollection(first);
  }

  collectionsBySource(source: 'Wikidata' | 'PeriodO'): Collection[] {
    return this.collections.filter((c) => c.source === source);
  }

  async selectCollection(c: Collection): Promise<void> {
    this.activeId = c.id;
    this.searchOpen = false;
    this.loading = true;
    this.selected = null;
    this.status = `Loading “${c.label}”…`;
    try {
      this.apply(await c.load());
      this.status = `${c.label} — ${this.lastCount} events${this.lastLanes ? ` across ${this.lastLanes} lanes` : ''}.`;
    } catch (err) {
      this.status = `Couldn’t load “${c.label}”: ${(err as Error).message}`;
    } finally {
      this.loading = false;
    }
  }

  private lastCount = 0;
  private lastLanes = 0;

  private apply(r: LoadResult): void {
    const tl = this.tl?.instance;
    if (!tl) return;
    tl.setGroups(r.groups as TimelineGroup[]);
    tl.setEvents(r.events);
    if (r.view) {
      tl.setView(r.view[0], r.view[1]);
      this.year = (r.view[0] + r.view[1]) / 2;
      tl.setYear(this.year, { animate: false, silent: true });
    }
    this.lastCount = r.events.length;
    this.lastLanes = r.groups.length;
  }

  /* timeline outputs */
  onEvent(e: TimelineEvent): void {
    this.selected = e;
  }
  onGroup(g: TimelineGroup): void {
    this.status = `Lane: ${g.label ?? g.id}`;
  }
  yearRange(e: TimelineEvent): string {
    return formatYearRange(e.year, e.endYear);
  }

  /* search */
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
    this.searchTerm = hit.label;
    this.searchOpen = false;
    this.activeId = null;
    this.loading = true;
    this.selected = null;
    this.status = `Loading events for “${hit.label}”…`;
    try {
      const r = await eventsForEntity(hit.id);
      this.apply(r);
      this.status = r.events.length
        ? `${r.events.length} events for “${hit.label}”${this.lastLanes ? ` across ${this.lastLanes} lanes` : ''}.`
        : `No dated events found for “${hit.label}”.`;
    } catch (err) {
      this.status = `Search failed: ${(err as Error).message}`;
    } finally {
      this.loading = false;
    }
  }

  closeSearch(): void {
    // Let a click on a result register before closing.
    setTimeout(() => (this.searchOpen = false), 150);
  }
}
