import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { GscDaily } from '../impact/gsc-daily.entity';
import { RedirectItem } from './redirect-item.entity';
import { RedirectIssue } from './redirect-issue.entity';
import { ExportRedirect, RedirectFormat, serialize } from './redirect-io';

export interface ExportResult {
  filename: string;
  mime: string;
  content: string;
}

const WINDOW_DAYS = 28;
const AUDIT_HEADER = [
  'source', 'target', 'code', 'match_type', 'regex', 'enabled',
  'hits', 'last_access', 'live_final_status', 'live_hops',
  'source_clicks_28d', 'source_impressions_28d', 'severity', 'issue_types', 'chain_length',
];

/**
 * Redirect export — two modes:
 *  (a) LOSSLESS round-trip: native Redirection JSON (preferred) or CSV/apache/nginx,
 *      carrying every editable field so a re-import is faithful.
 *  (b) AUDITOR CSV: a superset report enriched with Phase-4 evidence (hits/last-
 *      access, live target status, source GSC clicks/impressions, open-issue
 *      severity + chain length) — a client report, NOT a re-import file.
 */
@Injectable()
export class RedirectExportService {
  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(RedirectItem) private readonly itemRepo: Repository<RedirectItem>,
    @InjectRepository(RedirectIssue) private readonly issueRepo: Repository<RedirectIssue>,
    @InjectRepository(GscDaily) private readonly gscRepo: Repository<GscDaily>,
  ) {}

  /** (a) Lossless export in the requested format. */
  async lossless(siteId: string, format: RedirectFormat): Promise<ExportResult> {
    const items = await this.liveItems(siteId);
    const content = serialize(items.map(toExport), format);
    const ext = format === 'json' ? 'json' : format === 'csv' ? 'csv' : format === 'apache' ? 'conf' : 'conf';
    const mime = format === 'json' ? 'application/json' : 'text/plain';
    return { filename: `redirects-${this.stamp()}.${ext}`, mime, content };
  }

  /** (b) Auditor CSV — enriched superset for client reports. */
  async auditCsv(siteId: string): Promise<ExportResult> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    const items = await this.itemRepo.find({ where: { siteId }, order: { position: 'ASC' } });
    const gsc = await this.loadGsc(siteId);
    const issuesByItem = await this.loadIssues(siteId);

    const lines = [AUDIT_HEADER.join(',')];
    for (const i of items) {
      const srcKey = this.urlKey(this.absolute(site.url, i.source));
      const g = gsc.get(srcKey);
      const issue = i.id ? issuesByItem.get(i.id) : undefined;
      lines.push([
        cell(i.source), cell(i.target), cell(i.actionCode), cell(i.matchType), cell(i.regex ? 1 : 0),
        cell(i.enabled ? 1 : 0), cell(i.wpLastCount), cell(i.wpLastAccess ? i.wpLastAccess.toISOString() : ''),
        cell(i.liveFinalStatus), cell(i.liveHops),
        cell(g?.clicks ?? ''), cell(g?.impressions ?? ''),
        cell(issue?.severity ?? ''), cell(issue ? [...issue.types].join('|') : ''), cell(issue?.chainLength ?? ''),
      ].join(','));
    }
    return { filename: `redirects-audit-${this.stamp()}.csv`, mime: 'text/csv', content: lines.join('\n') };
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async liveItems(siteId: string): Promise<RedirectItem[]> {
    const items = await this.itemRepo.find({ where: { siteId }, order: { position: 'ASC' } });
    return items.filter((i) => i.deletedInWpAt == null);
  }

  private async loadGsc(siteId: string): Promise<Map<string, { clicks: number; impressions: number }>> {
    const since = this.daysAgo(WINDOW_DAYS);
    const rows = await this.gscRepo
      .createQueryBuilder('g')
      .select('g."pageUrl"', 'url')
      .addSelect('SUM(g.clicks)', 'clicks')
      .addSelect('SUM(g.impressions)', 'impressions')
      .where('g."siteId" = :siteId AND g.scope = :scope AND g.date >= :since', { siteId, scope: 'page', since })
      .groupBy('g."pageUrl"')
      .getRawMany<{ url: string; clicks: string; impressions: string }>();
    const map = new Map<string, { clicks: number; impressions: number }>();
    for (const r of rows) if (r.url) map.set(this.urlKey(r.url), { clicks: Number(r.clicks), impressions: Number(r.impressions) });
    return map;
  }

  /** Highest open-issue severity + types + chain length per redirect item. */
  private async loadIssues(siteId: string): Promise<Map<string, { severity: string; types: Set<string>; chainLength: number | null }>> {
    const issues = await this.issueRepo.find({ where: { siteId, status: 'open' } });
    const order = { critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>;
    const map = new Map<string, { severity: string; types: Set<string>; chainLength: number | null }>();
    for (const iss of issues) {
      const ids = new Set<string>([...(iss.redirectIds ?? []), ...(iss.primaryRedirectId ? [iss.primaryRedirectId] : [])]);
      for (const id of ids) {
        const cur = map.get(id) ?? { severity: 'low', types: new Set<string>(), chainLength: null };
        if ((order[iss.severity] ?? 0) > (order[cur.severity] ?? 0)) cur.severity = iss.severity;
        cur.types.add(iss.issueType);
        const cl = iss.evidence?.chainLength ?? null;
        if (cl != null && (cur.chainLength == null || cl > cur.chainLength)) cur.chainLength = cl;
        map.set(id, cur);
      }
    }
    return map;
  }

  private absolute(siteBase: string, path: string): string {
    const s = (path ?? '').trim();
    if (/^https?:\/\//i.test(s)) return s;
    return `${siteBase.replace(/\/+$/, '')}${s.startsWith('/') ? '' : '/'}${s}`;
  }

  private urlKey(u: string): string {
    return u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
  }

  private daysAgo(n: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  private stamp(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

function toExport(i: RedirectItem): ExportRedirect {
  return {
    source: i.source, target: i.target, actionCode: i.actionCode, actionType: i.actionType,
    matchType: i.matchType, regex: i.regex, groupId: i.groupId, position: i.position,
    enabled: i.enabled, title: i.title,
  };
}

function cell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
