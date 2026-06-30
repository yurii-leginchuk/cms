import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MetaHistory } from '../pages/meta-history.entity';
import { Page } from '../pages/page.entity';
import { SchemaHistory } from '../schema/schema-history.entity';
import { OptimizationEffect } from '../optimization-effects/optimization-effect.entity';
import { ChangeEvent } from './change-event';
import { toGscDay, diffDays } from './gsc-date';
import { CONFOUND_WINDOW_DAYS } from './impact.constants';

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

@Injectable()
export class ChangeEventsService {
  constructor(
    @InjectRepository(MetaHistory) private readonly metaRepo: Repository<MetaHistory>,
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(SchemaHistory) private readonly schemaRepo: Repository<SchemaHistory>,
    @InjectRepository(OptimizationEffect) private readonly effectRepo: Repository<OptimizationEffect>,
  ) {}

  /**
   * Assemble the unified change-event feed for a site (optionally one page).
   * The frontend never merges sources itself — it receives one typed stream.
   */
  async listEvents(siteId: string, pageId?: string): Promise<ChangeEvent[]> {
    const pages = await this.pageRepo.find({
      where: pageId ? { id: pageId, siteId } : { siteId },
      select: ['id', 'url'],
    });
    const urlById = new Map(pages.map((p) => [p.id, p.url]));
    const pageIds = pages.map((p) => p.id);
    if (pageIds.length === 0 && !pageId) return [];

    const [metaRows, schemaRows, effects] = await Promise.all([
      pageIds.length
        ? this.metaRepo.find({ where: { pageId: In(pageIds) }, order: { createdAt: 'DESC' }, take: 1000 })
        : Promise.resolve([]),
      this.schemaRepo.find({
        where: pageId ? { siteId, pageId } : { siteId },
        order: { createdAt: 'DESC' },
        take: 500,
      }),
      this.effectRepo.find({ where: pageId ? { siteId, pageId } : { siteId }, take: 1000 }),
    ]);

    const events: ChangeEvent[] = [];
    const matchedEffectIds = new Set<string>();

    // ── Meta + technical (from meta_history) ──────────────────────────────────
    const metaGroups = new Map<string, MetaHistory[]>();
    for (const row of metaRows) {
      if (row.field === 'title' || row.field === 'description') {
        const key = metaGroupKey(row.pageId, row.createdAt);
        (metaGroups.get(key) ?? metaGroups.set(key, []).get(key)!).push(row);
      } else {
        // canonical / noindex → standalone technical event
        const url = urlById.get(row.pageId) ?? '';
        events.push({
          id: `technical:${row.id}`,
          type: 'technical',
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
      const fields = rows.map((r) => r.field);
      const subtype = ['title', 'description'].filter((f) => fields.includes(f as any)).join(' + ');
      const titleRow = rows.find((r) => r.field === 'title');
      const descRow = rows.find((r) => r.field === 'description');
      const lead = titleRow ?? descRow!;
      const day = toGscDay(first.createdAt);
      // Link to the measured optimization_effect for this page applied near this day.
      const effect = effects.find(
        (e) => e.pageId === first.pageId && Math.abs(diffDays(toGscDay(e.appliedAt), day)) <= 2,
      );
      if (effect) matchedEffectIds.add(effect.id);
      events.push({
        id: `meta:${first.id}`,
        type: 'meta',
        subtype,
        pageId: first.pageId,
        pageUrl: url,
        ts: first.createdAt.toISOString(),
        day,
        precision: 'timestamp',
        summary: `Meta ${subtype} changed`,
        before: lead.oldValue,
        after: lead.newValue,
        measurable: true,
        effectStatus: effect ? effect.status : null,
        effectId: effect ? effect.id : null,
        confoundedWith: 0,
      });
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

    this.markConfounders(events);
    events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return events;
  }

  /**
   * Flag events that share a page with another change inside the measurement
   * window — their individual impact can't be isolated. O(n²) per page; n is tiny.
   */
  private markConfounders(events: ChangeEvent[]): void {
    const byPage = new Map<string, ChangeEvent[]>();
    for (const e of events) {
      if (!e.pageId) continue;
      (byPage.get(e.pageId) ?? byPage.set(e.pageId, []).get(e.pageId)!).push(e);
    }
    for (const group of byPage.values()) {
      for (const a of group) {
        a.confoundedWith = group.filter(
          (b) => b !== a && Math.abs(diffDays(a.day, b.day)) <= CONFOUND_WINDOW_DAYS,
        ).length;
      }
    }
  }
}
