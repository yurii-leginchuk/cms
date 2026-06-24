import { ChangeEventsService } from './change-events.service';

/** Minimal repo stub whose find() ignores args and returns the fixture array. */
function repo(rows: any[]) {
  return { find: jest.fn().mockResolvedValue(rows) } as any;
}

describe('ChangeEventsService', () => {
  const at = new Date('2026-05-10T18:00:00Z'); // LA: 2026-05-10

  function build() {
    const pages = repo([
      { id: 'p1', url: 'https://x.com/a' },
      { id: 'p2', url: 'https://x.com/b' },
    ]);
    const meta = repo([
      { id: 'm1', pageId: 'p1', field: 'title', oldValue: 'Old T', newValue: 'New T', createdAt: at },
      { id: 'm2', pageId: 'p1', field: 'description', oldValue: 'Old D', newValue: 'New D', createdAt: at },
      { id: 'm3', pageId: 'p1', field: 'canonical', oldValue: null, newValue: '/a', createdAt: at },
    ]);
    const schema = repo([
      { id: 's1', pageId: 'p2', count: 2, snapshot: [{ type: 'FAQPage' }, { type: 'Article' }], createdAt: at },
    ]);
    const briefs = repo([
      { id: 'b1', pageId: 'p1', pageUrl: 'https://x.com/a', name: 'Rewrite A', status: 'applied', appliedAt: '2026-05-12', proposedMetaTitle: 'Brief T', createdAt: at },
    ]);
    const effects = repo([
      { id: 'e1', pageId: 'p1', appliedAt: at, status: 'measured' },
    ]);
    return new ChangeEventsService(meta, pages, schema, briefs, effects);
  }

  it('merges four sources into a typed feed', async () => {
    const events = await build().listEvents('site1');
    const types = events.map((e) => e.type).sort();
    expect(types).toEqual(['brief', 'meta', 'schema', 'technical']);
  });

  it('collapses a title+description edit into one meta event and links its measured effect', async () => {
    const events = await build().listEvents('site1');
    const meta = events.find((e) => e.type === 'meta')!;
    expect(meta.subtype).toBe('title + description');
    expect(meta.before).toBe('Old T');
    expect(meta.after).toBe('New T');
    expect(meta.effectStatus).toBe('measured');
    expect(meta.effectId).toBe('e1');
  });

  it('emits canonical/noindex as a standalone technical event', async () => {
    const events = await build().listEvents('site1');
    const tech = events.find((e) => e.type === 'technical')!;
    expect(tech.subtype).toBe('canonical');
  });

  it('flags schema pushes as not directly measurable', async () => {
    const events = await build().listEvents('site1');
    const schema = events.find((e) => e.type === 'schema')!;
    expect(schema.measurable).toBe(false);
    expect(schema.summary).toContain('FAQPage');
  });

  it('treats applied briefs as day-precision events', async () => {
    const events = await build().listEvents('site1');
    const brief = events.find((e) => e.type === 'brief')!;
    expect(brief.precision).toBe('day');
    expect(brief.day).toBe('2026-05-12');
  });

  it('surfaces a meta marker from an optimization_effect that has no meta_history row', async () => {
    const pages = repo([{ id: 'p9', url: 'https://x.com/lonely' }])
    const svc = new ChangeEventsService(
      repo([]), pages, repo([]), repo([]),
      repo([{ id: 'e9', pageId: 'p9', pageUrl: 'https://x.com/lonely', changeSummary: 'title', appliedAt: at, status: 'measured' }]),
    )
    const events = await svc.listEvents('site1')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('meta')
    expect(events[0].id).toBe('meta-effect:e9')
    expect(events[0].effectStatus).toBe('measured')
  })

  it('does not double-emit when meta_history and the effect match', async () => {
    const events = await build().listEvents('site1')
    expect(events.filter((e) => e.type === 'meta')).toHaveLength(1)
  })

  it('marks events on the same page within the window as confounded', async () => {
    const events = await build().listEvents('site1');
    // p1 has meta + technical + brief all within ~2 days → each sees 2 others.
    const meta = events.find((e) => e.type === 'meta')!;
    expect(meta.confoundedWith).toBe(2);
    // p2's lone schema event has no confounders.
    const schema = events.find((e) => e.type === 'schema')!;
    expect(schema.confoundedWith).toBe(0);
  });
});
