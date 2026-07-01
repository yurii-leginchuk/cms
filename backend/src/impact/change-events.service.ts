import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MetaHistory } from '../pages/meta-history.entity';
import { Page } from '../pages/page.entity';
import { SchemaHistory } from '../schema/schema-history.entity';
import { OptimizationEffect } from '../optimization-effects/optimization-effect.entity';
import { AltPublishEvent } from './alt-publish-event.entity';
import { ImpactAnnotation } from './impact-annotation.entity';
import { ChangeEvent, ChangeEventCategory } from './change-event';
import { toGscDay, diffDays } from './gsc-date';
import { CONFOUND_WINDOW_DAYS, GROUP_WINDOW_DAYS } from './impact.constants';
import { assignClusters, compareEventsAsc } from './change-cluster';

/** Group key for collapsing a title+description edit applied in the same save. */
function metaGroupKey(pageId: string, createdAt: Date): string {
  return `${pageId}@${createdAt.toISOString().slice(0, 19)}`;
}

/** Human labels for standalone technical meta_history fields. */
const TECHNICAL_FIELD_LABELS: Record<string, string> = {
  noindex: 'Robots index',
  nofollow: 'Robots nofollow',
  canonical: 'Canonical',
  ogTitle: 'OG title',
  ogDescription: 'OG description',
  ogImage: 'OG image',
};

/** Category for a measured effect that has no per-field meta_history to split. */
function metaEffectCategory(summary: string | null | undefined): ChangeEventCategory {
  const s = (summary ?? '').toLowerCase();
  if (s.includes('description') && !s.includes('title')) return 'meta-description';
  return 'meta-title';
}

@Injectable()
export class ChangeEventsService {
  constructor(
    @InjectRepository(MetaHistory) private readonly metaRepo: Repository<MetaHistory>,
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(SchemaHistory) private readonly schemaRepo: Repository<SchemaHistory>,
    @InjectRepository(OptimizationEffect) private readonly effectRepo: Repository<OptimizationEffect>,
    @InjectRepository(AltPublishEvent) private readonly altRepo: Repository<AltPublishEvent>,
    @InjectRepository(ImpactAnnotation) private readonly annotationRepo: Repository<ImpactAnnotation>,
  ) {}

  /**
   * Assemble the unified change-event feed for a site (optionally one page).
   * The frontend never merges sources itself — it receives one typed stream, with
   * a `category` (for the per-category toggles) and a time-based `clusterId`.
   *
   * The request scope sets the cluster PARTITION: called site-wide (no pageId) the
   * feed clusters across all pages+categories (global markers); called for one page
   * it clusters within that page (per-page markers).
   */
  async listEvents(siteId: string, pageId?: string): Promise<ChangeEvent[]> {
    const pages = await this.pageRepo.find({
      where: pageId ? { id: pageId, siteId } : { siteId },
      select: ['id', 'url'],
    });
    const urlById = new Map(pages.map((p) => [p.id, p.url]));
    const pageIds = pages.map((p) => p.id);
    if (pageIds.length === 0 && !pageId) return [];

    const [metaRows, schemaRows, effects, altRows, annotationRows] = await Promise.all([
      pageIds.length
        ? this.metaRepo.find({ where: { pageId: In(pageIds) }, order: { createdAt: 'DESC' }, take: 1000 })
        : Promise.resolve([]),
      this.schemaRepo.find({
        where: pageId ? { siteId, pageId } : { siteId },
        order: { createdAt: 'DESC' },
        take: 500,
      }),
      this.effectRepo.find({ where: pageId ? { siteId, pageId } : { siteId }, take: 1000 }),
      this.altRepo.find({ where: { siteId }, order: { publishedAt: 'DESC' }, take: 500 }),
      this.annotationRepo.find({ where: { siteId }, order: { date: 'DESC' }, take: 500 }),
    ]);

    const events: ChangeEvent[] = [];
    const matchedEffectIds = new Set<string>();

    // ── Meta (title/description) + technical (from meta_history) ───────────────
    // Title/description edits saved together collapse per save, then split into a
    // per-field category event each (meta-title / meta-description) so each toggles
    // independently; same-day clustering re-unifies them into one marker.
    const metaGroups = new Map<string, MetaHistory[]>();
    for (const row of metaRows) {
      if (row.field === 'title' || row.field === 'description') {
        const key = metaGroupKey(row.pageId, row.createdAt);
        (metaGroups.get(key) ?? metaGroups.set(key, []).get(key)!).push(row);
      } else {
        // canonical / noindex / og* → standalone technical event
        const url = urlById.get(row.pageId) ?? '';
        events.push({
          id: `technical:${row.id}`,
          type: 'technical',
          category: 'technical',
          clusterId: '',
          subtype: row.field,
          pageId: row.pageId,
          pageUrl: url,
          ts: row.createdAt.toISOString(),
          day: toGscDay(row.createdAt),
          precision: 'timestamp',
          summary: `${TECHNICAL_FIELD_LABELS[row.field] ?? 'Meta'} changed`,
          before: row.oldValue,
          after: row.newValue,
          measurable: true,
          effectStatus: null,
          effectId: null,
          confoundedWith: 0,
        });
      }
    }

    for (const [, rows] of metaGroups) {
      const first = rows[0];
      const url = urlById.get(first.pageId) ?? '';
      const day = toGscDay(first.createdAt);
      const ts = first.createdAt.toISOString();
      // Link to the measured optimization_effect for this page applied near this day.
      const effect = effects.find(
        (e) => e.pageId === first.pageId && Math.abs(diffDays(toGscDay(e.appliedAt), day)) <= 2,
      );
      if (effect) matchedEffectIds.add(effect.id);

      for (const field of ['title', 'description'] as const) {
        const fieldRow = rows.find((r) => r.field === field);
        if (!fieldRow) continue;
        events.push({
          id: `meta-${field}:${fieldRow.id}`,
          type: 'meta',
          category: field === 'title' ? 'meta-title' : 'meta-description',
          clusterId: '',
          subtype: field,
          pageId: first.pageId,
          pageUrl: url,
          ts,
          day,
          precision: 'timestamp',
          summary: `Meta ${field} changed`,
          before: fieldRow.oldValue,
          after: fieldRow.newValue,
          measurable: true,
          effectStatus: effect ? effect.status : null,
          effectId: effect ? effect.id : null,
          confoundedWith: 0,
        });
      }
    }

    // ── Measured meta effects with no meta_history row ────────────────────────
    // optimization_effects is the source of truth for the measured cards. When a
    // change predates meta_history (or was applied via a path that didn't log it)
    // we still surface a marker so the timeline and the card list never disagree.
    for (const effect of effects) {
      if (matchedEffectIds.has(effect.id)) continue;
      events.push({
        id: `meta-effect:${effect.id}`,
        type: 'meta',
        category: metaEffectCategory(effect.changeSummary),
        clusterId: '',
        subtype: effect.changeSummary ?? 'meta',
        pageId: effect.pageId,
        pageUrl: effect.pageUrl,
        ts: new Date(effect.appliedAt).toISOString(),
        day: toGscDay(effect.appliedAt),
        precision: 'timestamp',
        summary: `Meta ${effect.changeSummary ?? 'change'}`,
        before: null,
        after: null,
        measurable: true,
        effectStatus: effect.status,
        effectId: effect.id,
        confoundedWith: 0,
      });
    }

    // ── Schema pushes ─────────────────────────────────────────────────────────
    for (const row of schemaRows) {
      const url = urlById.get(row.pageId) ?? '';
      const types = (row.snapshot ?? []).map((s) => s.type).filter(Boolean);
      events.push({
        id: `schema:${row.id}`,
        type: 'schema',
        category: 'schema',
        clusterId: '',
        subtype: 'schema',
        pageId: row.pageId,
        pageUrl: url,
        ts: row.createdAt.toISOString(),
        day: toGscDay(row.createdAt),
        precision: 'timestamp',
        summary: `Schema pushed (${row.count}${types.length ? `: ${types.join(', ')}` : ''})`,
        before: null,
        after: types.join(', ') || null,
        // Schema effects surface as rich-result eligibility (searchAppearance),
        // which the clicks/impressions series can't isolate.
        measurable: false,
        effectStatus: null,
        effectId: null,
        confoundedWith: 0,
      });
    }

    // ── ALT publishes ─────────────────────────────────────────────────────────
    // One image republish that touched N pages = ONE global event (page-count) +
    // a per-page marker on each page (in that page's scope). The page-set is read
    // from the FROZEN event row, never live placements. measurable:false — alt
    // impact shows in image search, not the clicks/impressions curve.
    for (const a of altRows) {
      const memberPages = a.pageIds ?? [];
      if (pageId) {
        if (!memberPages.includes(pageId)) continue;
        events.push({
          id: `alt:${a.id}`,
          type: 'alt',
          category: 'alt',
          clusterId: '',
          subtype: 'alt',
          pageId,
          pageUrl: urlById.get(pageId) ?? a.canonicalUrl,
          ts: a.publishedAt.toISOString(),
          day: toGscDay(a.publishedAt),
          precision: 'timestamp',
          summary: 'ALT text published on this page',
          before: null,
          after: a.altAfter || null,
          measurable: false,
          effectStatus: null,
          effectId: null,
          confoundedWith: 0,
        });
      } else {
        const n = memberPages.length;
        events.push({
          id: `alt:${a.id}`,
          type: 'alt',
          category: 'alt',
          clusterId: '',
          subtype: 'alt',
          pageId: null,
          pageUrl: '',
          ts: a.publishedAt.toISOString(),
          day: toGscDay(a.publishedAt),
          precision: 'timestamp',
          summary: `ALT text published${n ? ` (${n} page${n === 1 ? '' : 's'})` : ''}`,
          before: null,
          after: a.altAfter || null,
          measurable: false,
          effectStatus: null,
          effectId: null,
          confoundedWith: 0,
        });
      }
    }

    // ── Manual annotations (external events) folded into the same feed ────────
    // Sitewide pins (pageId null) show everywhere; page pins only on their page —
    // so they toggle, cluster and open in the dialog uniformly with real changes.
    for (const a of annotationRows) {
      if (pageId ? a.pageId !== null && a.pageId !== pageId : a.pageId !== null) continue;
      events.push({
        id: `manual:${a.id}`,
        type: 'manual',
        category: 'manual',
        clusterId: '',
        subtype: a.type ?? 'event',
        pageId: a.pageId,
        pageUrl: a.pageId ? (urlById.get(a.pageId) ?? '') : '',
        ts: `${a.date}T12:00:00.000Z`,
        day: a.date,
        precision: 'day',
        summary: a.label,
        before: null,
        after: null,
        measurable: false,
        effectStatus: null,
        effectId: null,
        confoundedWith: 0,
        taskUrl: a.link ?? null,
      });
    }

    this.markConfounders(events);

    // Cluster within the request's partition (global site-wide, or one page).
    assignClusters(
      events,
      GROUP_WINDOW_DAYS,
      pageId ? 'page' : 'global',
      pageId ?? siteId,
    );

    // Deterministic output order: newest first, total-order tiebroken by (day, ts, id).
    events.sort((a, b) => -compareEventsAsc(a, b));
    return events;
  }

  /**
   * Flag events that share a page with another change inside the measurement
   * window — their individual impact can't be isolated. A `scope:'sitewide'` event
   * (Phase 2 tasks) confounds EVERY page's window. O(n²) per page; n is tiny.
   */
  private markConfounders(events: ChangeEvent[]): void {
    const byPage = new Map<string, ChangeEvent[]>();
    const sitewide: ChangeEvent[] = [];
    for (const e of events) {
      if (e.scope === 'sitewide') {
        sitewide.push(e);
        continue;
      }
      if (!e.pageId) continue;
      (byPage.get(e.pageId) ?? byPage.set(e.pageId, []).get(e.pageId)!).push(e);
    }
    for (const group of byPage.values()) {
      for (const a of group) {
        const samePage = group.filter(
          (b) => b !== a && Math.abs(diffDays(a.day, b.day)) <= CONFOUND_WINDOW_DAYS,
        ).length;
        const siteWideNear = sitewide.filter(
          (s) => Math.abs(diffDays(a.day, s.day)) <= CONFOUND_WINDOW_DAYS,
        ).length;
        a.confoundedWith = samePage + siteWideNear;
      }
    }
  }
}
