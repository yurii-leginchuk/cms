import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { RedirectItem } from './redirect-item.entity';
import { normalizeRedirectUrl } from './redirect-normalize';
import {
  GraphRedirect,
  Chain,
  detectCycles,
  edgeClosesCycle,
  findChains,
  findConflicts,
  findDuplicates,
} from './redirect-graph';
import { RedirectResolveService, ResolveResult } from './redirect-resolve.service';

/** The intended final state of a redirect being created/edited. */
export interface IntendedRedirect {
  source: string;
  target?: string | null;
  actionType?: string | null;
  actionCode?: number | null;
  matchType?: string | null;
  regex?: boolean;
}

export interface ValidationIssue {
  code: 'duplicate' | 'conflict' | 'cycle';
  severity: 'error' | 'warning';
  message: string;
  path?: string[];
}

export interface ValidationResult {
  blocked: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export type FlattenVerdict = 'ready' | 'needs_review' | 'blocked';

export interface FlattenPreview {
  redirectId: string;
  verdict: FlattenVerdict;
  reason: string | null;
  before: { source: string; target: string | null; actionCode: number | null };
  after: { source: string; target: string; actionCode: number } | null;
  trail: ResolveResult['trail'];
  finalStatus: number | null;
  finalExternal: boolean;
}

const PERMANENT = new Set([301, 308]);
const TEMPORARY = new Set([302, 307]);

@Injectable()
export class RedirectValidateService {
  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(RedirectItem) private readonly itemRepo: Repository<RedirectItem>,
    private readonly resolve: RedirectResolveService,
  ) {}

  /**
   * Validate a prospective create/edit BEFORE it's staged. A redirect that closes
   * an EXACT cycle is blocked (`blocked:true`); duplicates, conflicts and only-
   * possible (regex/external) cycles are non-blocking warnings the user can override.
   */
  async validateNew(
    siteId: string,
    intended: IntendedRedirect,
    excludeId?: string,
  ): Promise<ValidationResult> {
    const siteHost = await this.siteHost(siteId);
    const existing = await this.loadGraph(siteId, excludeId);

    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const srcN = normalizeRedirectUrl(intended.source);
    const tgtN = intended.target ? normalizeRedirectUrl(intended.target) : null;
    const matchType = intended.matchType ?? 'url';
    const regex = intended.regex ?? false;
    const actionType = intended.actionType ?? (intended.target ? 'url' : 'error');
    const actionCode = intended.actionCode ?? 301;

    // Duplicate: same identity triple already exists.
    if (existing.some((e) => e.sourceNormalized === srcN && (e.matchType ?? 'url') === matchType && e.regex === regex)) {
      warnings.push({
        code: 'duplicate',
        severity: 'warning',
        message: `Another redirect already matches "${intended.source}" (same match type). This would be a duplicate.`,
      });
    }

    // Conflict: same source already sends somewhere different.
    const sameSource = existing.filter((e) => e.sourceNormalized === srcN && (e.matchType ?? 'url') === matchType);
    if (sameSource.some((e) => (e.targetNormalized ?? '') !== (tgtN ?? '') || e.actionCode !== actionCode)) {
      warnings.push({
        code: 'conflict',
        severity: 'warning',
        message: `"${intended.source}" already redirects elsewhere — this creates a conflicting rule for the same source.`,
      });
    }

    // Cycle: does the new edge close a loop?
    const check = edgeClosesCycle(
      existing,
      { sourceNormalized: srcN, targetNormalized: tgtN, regex, actionType, actionCode },
      siteHost,
    );
    if (check.closesCycle) {
      if (check.certainty === 'exact') {
        errors.push({
          code: 'cycle',
          severity: 'error',
          message: `This redirect would create a loop: ${(check.path ?? []).join(' → ')}. Save is blocked.`,
          path: check.path,
        });
      } else {
        warnings.push({
          code: 'cycle',
          severity: 'warning',
          message: `This redirect MIGHT create a loop through a regex/external hop (${(check.path ?? []).join(' → ')}). Unverifiable — review before saving.`,
          path: check.path,
        });
      }
    }

    return { blocked: errors.length > 0, errors, warnings };
  }

  /**
   * Static issue survey for the whole site (for the "Chain issues" surface):
   * duplicates, conflicts, cycles, and flattenable chain candidates.
   */
  async getIssues(siteId: string) {
    const siteHost = await this.siteHost(siteId);
    const redirects = await this.loadGraph(siteId);
    const chains = findChains(redirects, siteHost);
    const sourceById = new Map(redirects.map((r) => [r.id, r]));

    return {
      duplicates: findDuplicates(redirects),
      conflicts: findConflicts(redirects),
      cycles: detectCycles(redirects, siteHost),
      chains: chains.map((c) => ({
        ...c,
        headSource: sourceById.get(c.headId)?.source ?? c.hops[0] ?? null,
      })),
      counts: {
        duplicates: findDuplicates(redirects).length,
        conflicts: findConflicts(redirects).length,
        cycles: detectCycles(redirects, siteHost).length,
        chains: chains.length,
      },
    };
  }

  /**
   * Live flatten preview for a chain head (A→B→C ⇒ A→final). Resolves the REAL
   * chain over HTTP, then applies the safety rules:
   *  - live loop → BLOCKED;
   *  - couldn't resolve / final not 200 → NEEDS REVIEW (never flatten onto a 404);
   *  - mixed permanent+temporary codes → NEEDS REVIEW (never auto-promote 302→301);
   *  - otherwise READY, preserving the FIRST hop's status code.
   * Regex sources are excluded upstream (no chain). Applying = a `redirect.update`
   * through the existing gate.
   */
  async flattenPreview(siteId: string, redirectId: string): Promise<FlattenPreview> {
    const siteHost = await this.siteHost(siteId);
    const item = await this.itemRepo.findOne({ where: { id: redirectId, siteId } });
    if (!item) throw new NotFoundException('Redirect not found');

    const before = { source: item.source, target: item.target, actionCode: item.actionCode };

    if (item.regex) {
      return this.flattenResult(redirectId, 'blocked', 'Regex redirects cannot be safely flattened.', before, null, [], null, false);
    }

    // Confirm it's actually a chain head worth flattening (static ≥2 edges).
    const redirects = await this.loadGraph(siteId);
    const chains = findChains(redirects, siteHost);
    const chain: Chain | undefined = chains.find((c) => c.redirectIds[0] === redirectId);
    if (!chain) {
      return this.flattenResult(redirectId, 'needs_review', 'Not a redirect chain (nothing to shorten).', before, null, [], null, false);
    }

    // Resolve the REAL trail.
    const res = await this.resolve.resolveRedirect(siteId, redirectId);
    const finalExternal = /^https?:\/\//i.test(res.finalUrl) && this.hostOf(res.finalUrl) !== siteHost;

    if (res.loop) {
      return this.flattenResult(redirectId, 'blocked', 'The live chain loops — cannot flatten.', before, null, res.trail, res.finalStatus, finalExternal);
    }
    if (res.error || res.finalStatus == null) {
      return this.flattenResult(redirectId, 'needs_review', `Couldn't resolve the chain live${res.error ? ` (${res.error})` : ''}.`, before, null, res.trail, res.finalStatus, finalExternal);
    }
    if (res.finalStatus !== 200) {
      return this.flattenResult(redirectId, 'needs_review', `The chain ends at HTTP ${res.finalStatus}, not 200 — fix the target before flattening.`, before, null, res.trail, res.finalStatus, finalExternal);
    }

    // Status-code preservation from the REAL 3xx hops.
    const codes = res.trail.filter((h) => h.status >= 300 && h.status < 400).map((h) => h.status);
    if (codes.length < 2) {
      return this.flattenResult(redirectId, 'needs_review', 'The live chain is a single hop — nothing to flatten.', before, null, res.trail, res.finalStatus, finalExternal);
    }
    const hasPermanent = codes.some((c) => PERMANENT.has(c));
    const hasTemporary = codes.some((c) => TEMPORARY.has(c));
    if (hasPermanent && hasTemporary) {
      return this.flattenResult(redirectId, 'needs_review', 'The chain mixes permanent (301/308) and temporary (302/307) redirects — pick the intended code manually.', before, null, res.trail, res.finalStatus, finalExternal);
    }
    const preservedCode = codes[0]; // never auto-promote — keep the first hop's code

    const after = { source: item.source, target: res.finalUrl, actionCode: preservedCode };
    const reason = finalExternal ? 'Final target is on an external host — flattening still points straight at it.' : null;
    return this.flattenResult(redirectId, 'ready', reason, before, after, res.trail, res.finalStatus, finalExternal);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private flattenResult(
    redirectId: string,
    verdict: FlattenVerdict,
    reason: string | null,
    before: FlattenPreview['before'],
    after: FlattenPreview['after'],
    trail: ResolveResult['trail'],
    finalStatus: number | null,
    finalExternal: boolean,
  ): FlattenPreview {
    return { redirectId, verdict, reason, before, after, trail, finalStatus, finalExternal };
  }

  /** Live, enabled, non-tombstoned redirects as graph nodes (optionally minus one). */
  private async loadGraph(siteId: string, excludeId?: string): Promise<GraphRedirect[]> {
    const rows = await this.itemRepo.find({
      where: { siteId, ...(excludeId ? { id: Not(excludeId) } : {}) },
    });
    return rows
      .filter((r) => r.deletedInWpAt == null)
      .map((r) => ({
        id: r.id,
        pluginId: r.pluginId,
        source: r.source,
        sourceNormalized: r.sourceNormalized,
        target: r.target,
        targetNormalized: r.targetNormalized,
        matchType: r.matchType,
        regex: r.regex,
        actionType: r.actionType,
        actionCode: r.actionCode,
        enabled: r.enabled,
      }));
  }

  private async siteHost(siteId: string): Promise<string | null> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    return site ? this.hostOf(site.url) : null;
  }

  private hostOf(url: string): string | null {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return null;
    }
  }
}
