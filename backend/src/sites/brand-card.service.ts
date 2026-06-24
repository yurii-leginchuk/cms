import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from './site.entity';
import { Page } from '../pages/page.entity';
import { BrandCard, ServiceEntry, PersonEntry } from './brand-card.entity';

const SERVICE_URL_HINTS = ['/service', '/services/', '/what-we-do', '/solutions'];
const TEAM_URL_HINTS = ['/team/', '/author/', '/our-team', '/people/', '/staff/'];

/**
 * Heuristic extraction of short, title-like lines from plain cleanContent (the
 * scraper strips HTML, so there are no heading tags). These become candidate
 * sub-services / list items a human then confirms. Best-effort by design — the
 * Brand Card is a draft until `reviewed`.
 */
function extractListLikeLines(content: string | null, max = 12): string[] {
  if (!content) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of content.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const words = line.split(/\s+/);
    // Short, headline-ish, not a full sentence (no trailing period, ≤6 words).
    if (words.length === 0 || words.length > 6) continue;
    if (/[.!?:]$/.test(line)) continue;
    if (line.length < 3 || line.length > 60) continue;
    // Mostly capitalized words (looks like a label, not prose).
    const capWords = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
    if (capWords / words.length < 0.6) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

function slugToTitle(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    return last
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  } catch {
    return '';
  }
}

@Injectable()
export class BrandCardService {
  constructor(
    @InjectRepository(BrandCard)
    private readonly cardRepo: Repository<BrandCard>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
  ) {}

  async get(siteId: string): Promise<BrandCard | null> {
    return this.cardRepo.findOne({ where: { siteId } });
  }

  async upsert(siteId: string, patch: Partial<BrandCard>): Promise<BrandCard> {
    const existing = await this.cardRepo.findOne({ where: { siteId } });
    const merged = this.cardRepo.create({
      ...(existing ?? { siteId }),
      ...patch,
      siteId,
    });
    return this.cardRepo.save(merged);
  }

  /**
   * Build a DRAFT Brand Card from already-crawled pages. Never overwrites a
   * human-reviewed card unless `force` is set; returns the saved draft.
   */
  async deriveDraft(siteId: string, force = false): Promise<BrandCard> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');

    const existing = await this.cardRepo.findOne({ where: { siteId } });
    if (existing?.reviewed && !force) return existing;

    const pages = await this.pageRepo.find({ where: { siteId } });

    // Brand name / spelling from the homepage (shortest path).
    const homepage = pages
      .slice()
      .sort((a, b) => pathDepth(a.url) - pathDepth(b.url))[0];
    const brandName =
      site.name ||
      homepage?.h1Text ||
      (homepage?.metaTitle ? homepage.metaTitle.split(/[|\-–—]/)[0].trim() : null) ||
      null;

    // Service catalog — pages whose URL looks like a service/offering page.
    const services: ServiceEntry[] = [];
    for (const p of pages) {
      const path = safePath(p.url).toLowerCase();
      if (!SERVICE_URL_HINTS.some((h) => path.includes(h))) continue;
      // Skip the index page itself (e.g. exactly "/services/").
      if (/\/services?\/?$/.test(path)) continue;
      const name = (p.h1Text || slugToTitle(p.url) || '').trim();
      if (!name) continue;
      services.push({
        name,
        slug: safePath(p.url),
        sourceUrl: p.url,
        subServices: extractListLikeLines(p.cleanContent),
      });
    }

    // People from team/author pages.
    const people: PersonEntry[] = [];
    for (const p of pages) {
      const path = safePath(p.url).toLowerCase();
      if (!TEAM_URL_HINTS.some((h) => path.includes(h))) continue;
      const name = (p.h1Text || slugToTitle(p.url) || '').trim();
      if (!name) continue;
      people.push({ name, role: null, sourceUrl: p.url });
    }

    const draft = this.cardRepo.create({
      ...(existing ?? {}),
      siteId,
      brandName,
      spelling: existing?.spelling ?? brandName,
      services,
      people,
      // Preserve any human-entered fields if a (non-reviewed) draft already existed.
      locations: existing?.locations ?? [],
      certifications: existing?.certifications ?? [],
      approvedClaims: existing?.approvedClaims ?? [],
      neverSay: existing?.neverSay ?? [],
      ctas: existing?.ctas ?? [],
      reviewed: false,
    });
    return this.cardRepo.save(draft);
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function pathDepth(url: string): number {
  return safePath(url).split('/').filter(Boolean).length;
}
