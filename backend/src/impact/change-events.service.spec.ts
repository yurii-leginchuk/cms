import { ChangeEventsService } from './change-events.service';

/** Minimal repo stub whose find() ignores args and returns the fixture array. */
function repo(rows: any[]) {
  return { find: jest.fn().mockResolvedValue(rows) } as any;
}

describe('ChangeEventsService', () => {
  const at = new Date('2026-05-10T18:00:00Z'); // LA: 2026-05-10

  function build(overrides: {
    pages?: any[]; meta?: any[]; schema?: any[]; effects?: any[]; alt?: any[]; annotations?: any[];
  } = {}) {
    const pages = repo(overrides.pages ?? [
      { id: 'p1', url: 'https://x.com/a' },
      { id: 'p2', url: 'https://x.com/b' },
    ]);
    const meta = repo(overrides.meta ?? [
      { id: 'm1', pageId: 'p1', field: 'title', oldValue: 'Old T', newValue: 'New T', createdAt: at },
      { id: 'm2', pageId: 'p1', field: 'description', oldValue: 'Old D', newValue: 'New D', createdAt: at },
      { id: 'm3', pageId: 'p1', field: 'canonical', oldValue: null, newValue: '/a', createdAt: at },
    ]);
    const schema = repo(overrides.schema ?? [
      { id: 's1', pageId: 'p2', count: 2, snapshot: [{ type: 'FAQPage' }, { type: 'Article' }], createdAt: at },
    ]);
    const effects = repo(overrides.effects ?? [
      { id: 'e1', pageId: 'p1', appliedAt: at, status: 'measured' },
    ]);
    const alt = repo(overrides.alt ?? []);
    const annotations = repo(overrides.annotations ?? []);
    return new ChangeEventsService(meta, pages, schema, effects, alt, annotations);
  }

  it('merges meta, technical and schema sources into a typed feed', async () => {
    const events = await build().listEvents('site1');
    // meta splits into title + description → two 'meta' events.
    expect(events.map((e) => e.type).sort()).toEqual(['meta', 'meta', 'schema', 'technical']);
  });

  it('splits a title+description edit into per-category events, both linking the effect', async () => {
    const events = await build().listEvents('site1');
    const title = events.find((e) => e.category === 'meta-title')!;
    const desc = events.find((e) => e.category === 'meta-description')!;
    expect(title.before).toBe('Old T');
    expect(title.after).toBe('New T');
    expect(desc.before).toBe('Old D');
    expect(desc.after).toBe('New D');
    expect(title.effectId).toBe('e1');
    expect(desc.effectId).toBe('e1');
    expect(title.effectStatus).toBe('measured');
  });

  it('emits canonical/noindex as a standalone technical event', async () => {
    const events = await build().listEvents('site1');
    const tech = events.find((e) => e.type === 'technical')!;
    expect(tech.category).toBe('technical');
    expect(tech.subtype).toBe('canonical');
  });

  it('flags schema pushes as not directly measurable', async () => {
    const events = await build().listEvents('site1');
    const schema = events.find((e) => e.type === 'schema')!;
    expect(schema.category).toBe('schema');
    expect(schema.measurable).toBe(false);
    expect(schema.summary).toContain('FAQPage');
  });

  it('surfaces a meta marker from an optimization_effect that has no meta_history row', async () => {
    const svc = build({
      pages: [{ id: 'p9', url: 'https://x.com/lonely' }],
      meta: [], schema: [], alt: [],
      effects: [{ id: 'e9', pageId: 'p9', pageUrl: 'https://x.com/lonely', changeSummary: 'title', appliedAt: at, status: 'measured' }],
    });
    const events = await svc.listEvents('site1');
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('meta-effect:e9');
    expect(events[0].category).toBe('meta-title');
    expect(events[0].effectStatus).toBe('measured');
  });

  it('does not double-emit an effect that already matched a meta_history save', async () => {
    // matched effect → no separate meta-effect event; only the split title+desc pair.
    const events = await build().listEvents('site1');
    expect(events.filter((e) => e.id.startsWith('meta-effect:'))).toHaveLength(0);
    expect(events.filter((e) => e.type === 'meta')).toHaveLength(2);
  });

  it('marks same-page changes within the window as confounded (incl. the split pair)', async () => {
    const events = await build().listEvents('site1');
    // p1 has meta-title + meta-description + technical → each sees 2 others.
    const title = events.find((e) => e.category === 'meta-title')!;
    expect(title.confoundedWith).toBe(2);
    // p2's lone schema event has no confounders.
    const schema = events.find((e) => e.type === 'schema')!;
    expect(schema.confoundedWith).toBe(0);
  });

  it('assigns a shared clusterId to same-window events (global partition)', async () => {
    const events = await build().listEvents('site1');
    // all fixtures land on 2026-05-10 → one global cluster.
    const ids = new Set(events.map((e) => e.clusterId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ALT global view: one aggregate marker with the page count, not measurable', async () => {
    const svc = build({
      pages: [{ id: 'p1', url: 'https://x.com/a' }, { id: 'p2', url: 'https://x.com/b' }],
      meta: [], schema: [], effects: [],
      alt: [{ id: 'a1', siteId: 'site1', imageId: 'img1', canonicalUrl: 'https://x.com/i.jpg', publishedAt: at, altAfter: 'A cat', pageIds: ['p1', 'p2'] }],
    });
    const events = await svc.listEvents('site1');
    expect(events).toHaveLength(1);
    expect(events[0].category).toBe('alt');
    expect(events[0].pageId).toBeNull();
    expect(events[0].measurable).toBe(false);
    expect(events[0].summary).toContain('2 pages');
  });

  it('folds manual annotations into the feed as category:manual (sitewide + page scoping)', async () => {
    const svc = build({
      pages: [{ id: 'p1', url: 'https://x.com/a' }, { id: 'p2', url: 'https://x.com/b' }],
      meta: [], schema: [], effects: [], alt: [],
      annotations: [
        { id: 'an1', pageId: null, date: '2026-05-10', label: 'March core update', type: 'core-update', link: 'https://g.co/x' },
        { id: 'an2', pageId: 'p2', date: '2026-05-11', label: 'Rewrote intro', type: null, link: null },
      ],
    });
    // Global view: sitewide only.
    const global = await svc.listEvents('site1');
    const gm = global.filter((e) => e.category === 'manual');
    expect(gm).toHaveLength(1);
    expect(gm[0].id).toBe('manual:an1');
    expect(gm[0].subtype).toBe('core-update');
    expect(gm[0].taskUrl).toBe('https://g.co/x');
    expect(gm[0].measurable).toBe(false);
    // Page p2 view: sitewide + this page's pin.
    const page = await svc.listEvents('site1', 'p2');
    const pm = page.filter((e) => e.category === 'manual').map((e) => e.id).sort();
    expect(pm).toEqual(['manual:an1', 'manual:an2']);
  });

  it('ALT page view: a per-page marker only when the page is in the frozen page-set', async () => {
    const overrides = {
      pages: [{ id: 'p1', url: 'https://x.com/a' }],
      meta: [], schema: [], effects: [],
      alt: [
        { id: 'a1', siteId: 'site1', imageId: 'img1', canonicalUrl: 'https://x.com/i.jpg', publishedAt: at, altAfter: 'A cat', pageIds: ['p1'] },
        { id: 'a2', siteId: 'site1', imageId: 'img2', canonicalUrl: 'https://x.com/j.jpg', publishedAt: at, altAfter: 'A dog', pageIds: ['p2'] },
      ],
    };
    const events = await build(overrides).listEvents('site1', 'p1');
    const alt = events.filter((e) => e.category === 'alt');
    expect(alt).toHaveLength(1); // only a1 (p1); a2 (p2) excluded
    expect(alt[0].pageId).toBe('p1');
    expect(alt[0].summary).toBe('ALT text published on this page');
  });
});
