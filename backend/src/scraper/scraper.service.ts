import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { Site, SiteStatus } from '../sites/site.entity';
import { Page } from '../pages/page.entity';
import { ContentStructure, deriveCleanContent } from '../pages/content-structure';
import { parseStructure, singleProseStructure } from './structure-parser';
import { EmbeddingService } from '../embedding/embedding.service';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../token-usage/token-usage.service';

@Injectable()
export class ScraperService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScraperService.name);
  private readonly parser = new XMLParser({ ignoreAttributes: false });

  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    private readonly embeddingService: EmbeddingService,
    private readonly settingsService: SettingsService,
    private readonly tokenUsageService: TokenUsageService,
  ) {}

  /**
   * `parseSite` runs in-process (fire-and-forget). A process restart abandons
   * the loop but leaves the site stuck at PARSING forever (zombie progress bar).
   * On boot, reset any such sites to ERROR so the UI unfreezes and the user can
   * re-parse.
   */
  async onApplicationBootstrap(): Promise<void> {
    const res = await this.siteRepo.update(
      { status: SiteStatus.PARSING },
      { status: SiteStatus.ERROR },
    );
    if (res.affected) {
      this.logger.warn(
        `Reset ${res.affected} site(s) stuck in PARSING after restart`,
      );
    }
  }

  async parseSite(siteId: string): Promise<void> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) return;

    await this.siteRepo.update(siteId, {
      status: SiteStatus.PARSING,
      pagesTotal: 0,
      pagesProcessed: 0,
    });

    try {
      // Resolve favicon from homepage
      const favicon = await this.parseFavicon(site.url);
      if (favicon) {
        await this.siteRepo.update(siteId, { favicon });
      }

      const urls = await this.fetchSitemapUrls(site.sitemapUrl);
      this.logger.log(`Found ${urls.length} URLs for site ${site.name}`);

      await this.siteRepo.update(siteId, { pagesTotal: urls.length });

      for (let i = 0; i < urls.length; i++) {
        await this.scrapePage(site, urls[i]);
        await this.siteRepo.update(siteId, { pagesProcessed: i + 1 });
      }

      await this.siteRepo.update(siteId, {
        status: SiteStatus.DONE,
        lastParsedAt: new Date(),
        pagesProcessed: urls.length,
      });

      // Auto-trigger embedding after parse
      this.embeddingService.generateForSite(siteId).catch((err) => {
        this.logger.error(`Auto-embedding failed for site ${siteId}: ${(err as Error).message}`);
      });
    } catch (err) {
      this.logger.error(`Failed to parse site ${site.name}: ${err.message}`);
      await this.siteRepo.update(siteId, { status: SiteStatus.ERROR });
    }
  }

  async parseAllSites(): Promise<void> {
    const sites = await this.siteRepo.find({
      where: { status: SiteStatus.IDLE },
    });
    this.logger.log(`Scheduled parse: processing ${sites.length} sites`);
    for (const site of sites) {
      await this.parseSite(site.id);
    }
  }

  private async fetchSitemapUrls(sitemapUrl: string): Promise<string[]> {
    const response = await axios.get(sitemapUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'CMS-Bot/1.0' },
    });
    const xml = response.data as string;
    const parsed = this.parser.parse(xml);

    if (parsed.sitemapindex) {
      const sitemaps = this.toArray(parsed.sitemapindex.sitemap);
      const nested = await Promise.all(
        sitemaps.map((s: any) => this.fetchSitemapUrls(s.loc).catch(() => [])),
      );
      return nested.flat();
    }

    if (parsed.urlset) {
      const urls = this.toArray(parsed.urlset.url);
      return urls.map((u: any) => u.loc).filter(Boolean);
    }

    return [];
  }

  private async scrapePage(site: Site, url: string): Promise<void> {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'CMS-Bot/1.0' },
        maxContentLength: 50 * 1024 * 1024,
      });

      const html = response.data as string;
      const $ = cheerio.load(html);

      const metaTitle = $('title').first().text().trim() || null;
      const metaDescription =
        $('meta[name="description"]').attr('content')?.trim() ||
        $('meta[property="og:description"]').attr('content')?.trim() ||
        null;
      const h1Text = $('h1').first().text().trim() || null;

      const existing = await this.pageRepo.findOne({
        where: { siteId: site.id, url },
      });

      // contentStructure is the canonical source; cleanContent is derived from it
      // so every existing reader (embeddings, agent, meta gen, faithfulness) keeps working.
      const contentStructure =
        (await this.extractWithJina(url, site.id, site.url)) ??
        this.extractCleanContent(html, url);
      const cleanContent = deriveCleanContent(contentStructure);

      if (existing) {
        await this.pageRepo.update(existing.id, {
          rawHtml: html,
          metaTitle,
          metaDescription,
          h1Text,
          cleanContent,
          contentStructure,
          lastScrapedAt: new Date(),
        });
      } else {
        await this.pageRepo.save(
          this.pageRepo.create({
            siteId: site.id,
            url,
            rawHtml: html,
            metaTitle,
            metaDescription,
            h1Text,
            cleanContent,
            contentStructure,
            lastScrapedAt: new Date(),
          }),
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to scrape ${url}: ${err.message}`);
    }
  }

  private async extractWithJina(
    url: string,
    siteId: string,
    siteUrl: string,
  ): Promise<ContentStructure | null> {
    const apiKey = await this.settingsService.getRaw('jina_api_key');
    if (!apiKey) return null;

    // Try the targeted call first (clean main content). Some templates
    // (author/archive/custom Elementor with data-elementor-type=single-post /
    // loop-item) match none of the target selectors → Jina 422 "No content".
    // Fall back to a full-page call (chrome still stripped by X-Remove-Selector)
    // so those pages aren't left empty.
    const res =
      (await this.fetchJina(url, apiKey, siteId, true)) ??
      (await this.fetchJina(url, apiKey, siteId, false));
    if (!res) return null;

    return parseStructure({
      markdown: res.content,
      source: 'jina-json',
      siteUrl,
      links: res.links,
      images: res.images,
    });
  }

  /**
   * One Jina Reader call (deterministic DOM→markdown, JSON mode). Returns null
   * on failure/empty so the caller can retry without the target selector.
   * NOT the readerlm-v2 LLM (it silently drops FAQ accordions + truncates).
   */
  private async fetchJina(
    url: string,
    apiKey: string,
    siteId: string,
    useTargetSelector: boolean,
  ): Promise<{
    content: string;
    links: Record<string, string> | undefined;
    images: Record<string, string> | undefined;
  } | null> {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'X-Respond-With': 'markdown',
        'X-Remove-Selector':
          'header, footer, nav, aside, .related, .share, [class*="cookie"]',
        'X-Retain-Images': 'alt',
        'X-With-Links-Summary': 'true',
        'X-With-Images-Summary': 'true',
      };
      if (useTargetSelector) {
        headers['X-Target-Selector'] =
          'article, main, .entry-content, .elementor-section';
      }

      const response = await axios.get(`https://r.jina.ai/${url}`, {
        timeout: 45000,
        headers,
        responseType: 'json',
      });

      const data = response.data?.data ?? {};
      const content = typeof data.content === 'string' ? data.content.trim() : '';
      if (!content || content.length < 50) return null;

      // Token usage: prefer the structured usage field, fall back to the header.
      const usedThisCall =
        Number(data.usage?.tokens) ||
        parseInt(String(response.headers['x-usage-tokens'] ?? '0'), 10) ||
        0;
      if (usedThisCall > 0) {
        const currentRaw = await this.settingsService.getRaw('jina_tokens_used');
        const currentUsed = currentRaw ? parseInt(currentRaw, 10) : 0;
        await this.settingsService.upsert(
          'jina_tokens_used',
          String(currentUsed + usedThisCall),
          false,
        );
      }

      await this.tokenUsageService.record({
        siteId,
        feature: 'jina_scraping',
        model: 'jina-reader',
        inputTokens: 0,
        outputTokens: usedThisCall || content.length,
      });

      return { content, links: data.links, images: data.images };
    } catch (err) {
      this.logger.warn(
        `Jina (${useTargetSelector ? 'targeted' : 'full'}) failed for ${url}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Fallback when Jina is unavailable. Builds heading-aware markdown from the
   * DOM and parses it into the same ContentStructure shape, so downstream code
   * never branches on "structured vs not". Last resort: a single prose section.
   */
  private extractCleanContent(html: string, url: string): ContentStructure {
    try {
      const markdown = this.htmlToMarkdown(html);
      if (markdown && markdown.trim().length > 50) {
        return parseStructure({
          markdown,
          source: 'readability-fallback',
          siteUrl: url,
        });
      }
    } catch {
      // fall through
    }
    return singleProseStructure(this.extractWithCheerio(html), 'readability-fallback');
  }

  /** Reconstruct heading-aware markdown from raw HTML (cheerio, deterministic). */
  private htmlToMarkdown(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, noscript, iframe, svg, head').remove();
    $('nav, footer, header, aside').remove();
    $('#wpadminbar, .site-header, .site-footer, .main-navigation').remove();
    $('form, .breadcrumb, .wp-pagenavi, .navigation, .post-navigation').remove();
    $('[class*="cookie"], [class*="popup"], [class*="modal"], [class*="banner"]').remove();
    $('[class*="sidebar"], [class*="widget"], [class*="share"], [class*="social"]').remove();

    const SELECTORS = [
      'main article', 'article',
      '.entry-content', '.post-content', '.page-content', '.site-content',
      '.wp-block-post-content',
      '[class*="elementor-section"]',
      'main', '#content', '#main', '.content', '#primary',
    ];
    let $root: ReturnType<typeof $> | null = null;
    for (const sel of SELECTORS) {
      const found = $(sel).first();
      if (found.length > 0) { $root = found; break; }
    }
    const root = $root ?? $('body');

    const out: string[] = [];
    root.find('h1, h2, h3, h4, h5, h6, p, li, blockquote').each((_i, el) => {
      const tag = (el as any).tagName?.toLowerCase?.() ?? (el as any).name;
      const $el = $(el);
      // Skip list items that wrap block children — their inner p/li are emitted.
      if (tag === 'li' && $el.children('p, ul, ol, div').length > 0) return;
      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2) return;
      if (/^h[1-6]$/.test(tag)) {
        out.push(`\n${'#'.repeat(Number(tag[1]))} ${text}`);
      } else if (tag === 'li') {
        out.push(`- ${text}`);
      } else {
        out.push(text);
      }
    });
    return out.join('\n');
  }

  private cleanText(raw: string): string {
    const lines = raw
      .split(/\n/)
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(l => l.length >= 4);

    // Deduplicate all lines (case-insensitive) — repeated headings and nav items are noise
    const seen = new Set<string>();
    const result: string[] = [];
    for (const line of lines) {
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(line);
    }
    return result.join('\n');
  }

  private extractWithCheerio(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, noscript, iframe, svg, head').remove();
    $('nav, footer, header, aside').remove();
    $('#wpadminbar, .site-header, .site-footer, .main-navigation').remove();
    $('form, .breadcrumb, .wp-pagenavi, .navigation, .post-navigation').remove();
    $('[class*="cookie"], [class*="popup"], [class*="modal"], [class*="banner"]').remove();
    $('[class*="sidebar"], [class*="widget"], [class*="share"], [class*="social"]').remove();

    const SELECTORS = [
      'main article', 'article',
      '.entry-content', '.post-content', '.page-content', '.site-content',
      '.wp-block-post-content',
      '[class*="elementor-widget-text-editor"]',
      '[class*="elementor-section"]',
      'main', '#content', '#main', '.content', '#primary',
    ];

    let $content: ReturnType<typeof $> | null = null;
    for (const sel of SELECTORS) {
      const found = $(sel);
      if (found.length > 0) { $content = found; break; }
    }

    const raw = ($content ?? $('body')).text();
    return this.cleanText(raw);
  }

  private async parseFavicon(siteUrl: string): Promise<string | null> {
    try {
      const base = new URL(siteUrl);
      const response = await axios.get(siteUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'CMS-Bot/1.0' },
        maxContentLength: 50 * 1024 * 1024,
      });
      const $ = cheerio.load(response.data as string);

      // Priority: apple-touch-icon → icon → shortcut icon
      const selectors = [
        'link[rel="apple-touch-icon"]',
        'link[rel="icon"]',
        'link[rel="shortcut icon"]',
      ];

      for (const sel of selectors) {
        const href = $(sel).attr('href');
        if (href) {
          return new URL(href, base.origin).toString();
        }
      }

      // Fallback to standard /favicon.ico
      return `${base.origin}/favicon.ico`;
    } catch {
      return null;
    }
  }

  private toArray<T>(val: T | T[]): T[] {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  }
}
