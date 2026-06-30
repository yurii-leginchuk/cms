import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { SyncJob } from './sync-job.entity';
import { Page, PageSyncStatus, IndexDirective } from '../pages/page.entity';
import { Site } from '../sites/site.entity';

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'p1',
    siteId: 's1',
    url: 'https://example.com/about/',
    metaTitle: 'Scraped Title',
    metaDescription: 'Scraped description',
    customMetaTitle: null,
    customMetaDescription: null,
    indexDirective: IndexDirective.DEFAULT,
    noindex: false,
    nofollow: false,
    canonical: null,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    ogImageId: null,
    syncStatus: PageSyncStatus.IDLE,
    ...overrides,
  } as Page;
}

describe('SyncService.buildMetaPayload', () => {
  let service: SyncService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: getRepositoryToken(SyncJob), useValue: {} },
        { provide: getRepositoryToken(Page), useValue: {} },
        { provide: getRepositoryToken(Site), useValue: {} },
      ],
    }).compile();
    service = module.get(SyncService);
  });

  it('always sends title/description (custom overrides scrape)', () => {
    const p = service.buildMetaPayload(
      makePage({ customMetaTitle: 'Custom', customMetaDescription: 'Custom desc' }),
    );
    expect(p.metaTitle).toBe('Custom');
    expect(p.metaDescription).toBe('Custom desc');
  });

  it('OMITS robots/canonical/OG keys when there is no override (anti-clobber)', () => {
    const p = service.buildMetaPayload(makePage());
    expect(p).not.toHaveProperty('metaRobotsNoindex');
    expect(p).not.toHaveProperty('metaRobotsNofollow');
    expect(p).not.toHaveProperty('canonical');
    expect(p).not.toHaveProperty('ogTitle');
    expect(p).not.toHaveProperty('ogImage');
  });

  it('encodes noindex as "1" and index as "2"', () => {
    expect(service.buildMetaPayload(makePage({ indexDirective: IndexDirective.NOINDEX })).metaRobotsNoindex).toBe('1');
    expect(service.buildMetaPayload(makePage({ indexDirective: IndexDirective.INDEX })).metaRobotsNoindex).toBe('2');
  });

  it('sends nofollow only when true', () => {
    expect(service.buildMetaPayload(makePage({ nofollow: true })).metaRobotsNofollow).toBe('1');
    expect(service.buildMetaPayload(makePage({ nofollow: false }))).not.toHaveProperty('metaRobotsNofollow');
  });

  it('sends ogImageId alongside ogImage only when present', () => {
    const withId = service.buildMetaPayload(
      makePage({ ogImage: 'https://cdn/og.png', ogImageId: 42 }),
    );
    expect(withId.ogImage).toBe('https://cdn/og.png');
    expect(withId.ogImageId).toBe(42);

    const noId = service.buildMetaPayload(makePage({ ogImage: 'https://cdn/og.png' }));
    expect(noId.ogImage).toBe('https://cdn/og.png');
    expect(noId).not.toHaveProperty('ogImageId');
  });

  describe('clear-on-WP (lastSyncedMeta snapshot)', () => {
    it('sends an explicit empty for a field the CMS PREVIOUSLY synced but now cleared', () => {
      const p = service.buildMetaPayload(
        makePage({
          canonical: null,
          lastSyncedMeta: { canonical: 'https://example.com/about/' },
        }),
      );
      // Present-but-empty → the plugin deletes the post-meta on WP.
      expect(p).toHaveProperty('canonical');
      expect(p.canonical).toBe('');
    });

    it('still OMITS a field the CMS never managed, even when others were synced', () => {
      const p = service.buildMetaPayload(
        makePage({
          canonical: null,
          ogTitle: null,
          lastSyncedMeta: { canonical: 'https://example.com/about/' },
        }),
      );
      // canonical was managed → explicit clear; ogTitle never was → untouched.
      expect(p.canonical).toBe('');
      expect(p).not.toHaveProperty('ogTitle');
    });

    it('clears a previously-synced robots/nofollow override back to the Yoast default', () => {
      const p = service.buildMetaPayload(
        makePage({
          indexDirective: IndexDirective.DEFAULT,
          nofollow: false,
          lastSyncedMeta: { metaRobotsNoindex: '1', metaRobotsNofollow: '1' },
        }),
      );
      expect(p.metaRobotsNoindex).toBe('');
      expect(p.metaRobotsNofollow).toBe('');
    });

    it('sends the value (not empty) when the field is still set', () => {
      const p = service.buildMetaPayload(
        makePage({
          canonical: 'https://example.com/new/',
          lastSyncedMeta: { canonical: 'https://example.com/about/' },
        }),
      );
      expect(p.canonical).toBe('https://example.com/new/');
    });

    it('clears a previously-synced ogImage (id rides along via the plugin)', () => {
      const p = service.buildMetaPayload(
        makePage({
          ogImage: null,
          ogImageId: null,
          lastSyncedMeta: { ogImage: 'https://cdn/old.png', ogImageId: 7 },
        }),
      );
      expect(p.ogImage).toBe('');
    });
  });

  describe('buildManagedMeta (lastSyncedMeta snapshot source)', () => {
    it('captures only the override fields currently set', () => {
      const snap = service.buildManagedMeta(
        makePage({
          indexDirective: IndexDirective.NOINDEX,
          nofollow: true,
          canonical: 'https://example.com/c/',
          ogImage: 'https://cdn/og.png',
          ogImageId: 42,
        }),
      );
      expect(snap).toEqual({
        metaRobotsNoindex: '1',
        metaRobotsNofollow: '1',
        canonical: 'https://example.com/c/',
        ogImage: 'https://cdn/og.png',
        ogImageId: 42,
      });
    });

    it('is empty when no overrides are set', () => {
      expect(service.buildManagedMeta(makePage())).toEqual({});
    });
  });
});
