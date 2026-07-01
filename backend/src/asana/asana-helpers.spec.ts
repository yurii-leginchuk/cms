import {
  shouldRetry,
  nextBackoffMs,
  mapAsanaError,
  collectPaginated,
  deriveSection,
  mapTaskToMirror,
  type AsanaPage,
  type AsanaTaskRaw,
} from './asana-helpers';

describe('shouldRetry', () => {
  it('retries 429 and 5xx while under the cap', () => {
    expect(shouldRetry(429, 0, 4)).toBe(true);
    expect(shouldRetry(500, 1, 4)).toBe(true);
    expect(shouldRetry(503, 3, 4)).toBe(true);
  });
  it('does NOT retry 4xx (other than 429)', () => {
    expect(shouldRetry(400, 0, 4)).toBe(false);
    expect(shouldRetry(401, 0, 4)).toBe(false);
    expect(shouldRetry(404, 0, 4)).toBe(false);
  });
  it('stops once attempts reach the cap', () => {
    expect(shouldRetry(429, 4, 4)).toBe(false);
    expect(shouldRetry(500, 5, 4)).toBe(false);
  });
});

describe('nextBackoffMs', () => {
  it('honors Retry-After seconds (string or number)', () => {
    expect(nextBackoffMs(0, '2')).toBe(2000);
    expect(nextBackoffMs(3, 5)).toBe(5000);
  });
  it('caps Retry-After at 60s', () => {
    expect(nextBackoffMs(0, '9999')).toBe(60_000);
  });
  it('falls back to exponential when no Retry-After', () => {
    expect(nextBackoffMs(0)).toBe(500);
    expect(nextBackoffMs(1)).toBe(1000);
    expect(nextBackoffMs(2)).toBe(2000);
  });
  it('caps the exponential at 30s', () => {
    expect(nextBackoffMs(20)).toBe(30_000);
  });
});

describe('mapAsanaError (secret-free reasons)', () => {
  it('maps 401 to an invalid/revoked-token hint', () => {
    expect(mapAsanaError(401)).toMatch(/invalid or was revoked/i);
  });
  it('maps 403/404/429', () => {
    expect(mapAsanaError(403)).toMatch(/denied access/i);
    expect(mapAsanaError(404)).toMatch(/not found/i);
    expect(mapAsanaError(429)).toMatch(/rate limit/i);
  });
  it('truncates a 400 detail and never echoes a huge body', () => {
    const msg = mapAsanaError(400, 'x'.repeat(500));
    expect(msg).toMatch(/rejected the request/i);
    expect(msg.length).toBeLessThan(160);
  });
  it('has a safe generic fallback for network errors', () => {
    expect(mapAsanaError(undefined)).toMatch(/could not reach asana/i);
  });
});

describe('collectPaginated', () => {
  it('concatenates data across offset pages until next_page is null', async () => {
    const pages: Record<string, AsanaPage<number>> = {
      __start: { data: [1, 2], next_page: { offset: 'a' } },
      a: { data: [3, 4], next_page: { offset: 'b' } },
      b: { data: [5], next_page: null },
    };
    const seen: string[] = [];
    const all = await collectPaginated<number>(async (offset) => {
      seen.push(offset ?? '__start');
      return pages[offset ?? '__start'];
    });
    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual(['__start', 'a', 'b']);
  });

  it('respects the maxPages safety cap', async () => {
    let calls = 0;
    const all = await collectPaginated<number>(async () => {
      calls++;
      return { data: [calls], next_page: { offset: 'forever' } };
    }, 3);
    expect(calls).toBe(3);
    expect(all).toEqual([1, 2, 3]);
  });
});

describe('deriveSection', () => {
  it('picks the section from the membership matching our project', () => {
    const memberships = [
      { project: { gid: 'other' }, section: { gid: 's9', name: 'Wrong' } },
      { project: { gid: 'p1' }, section: { gid: 's1', name: 'In Progress' } },
    ];
    expect(deriveSection(memberships, 'p1')).toEqual({ gid: 's1', name: 'In Progress' });
  });
  it('falls back to any section when our project has none', () => {
    const memberships = [{ project: { gid: 'other' }, section: { gid: 's9', name: 'Fallback' } }];
    expect(deriveSection(memberships, 'p1')).toEqual({ gid: 's9', name: 'Fallback' });
  });
  it('returns null when there are no sections', () => {
    expect(deriveSection([], 'p1')).toBeNull();
    expect(deriveSection(undefined, 'p1')).toBeNull();
  });
});

describe('mapTaskToMirror', () => {
  const raw: AsanaTaskRaw = {
    gid: 't1',
    name: '  Fix /pricing meta  ',
    notes: 'desc',
    completed: false,
    due_on: '2026-07-10',
    permalink_url: 'https://app.asana.com/0/1/2',
    num_subtasks: 2,
    modified_at: '2026-07-01T12:00:00.000Z',
    assignee: { gid: 'u1', name: 'Alice' },
    parent: null,
    memberships: [{ project: { gid: 'p1' }, section: { gid: 's1', name: 'To Do' } }],
  };

  it('maps the full payload including the derived section', () => {
    const m = mapTaskToMirror(raw, 'site-1', 'p1');
    expect(m).toMatchObject({
      siteId: 'site-1',
      projectGid: 'p1',
      taskGid: 't1',
      name: 'Fix /pricing meta',
      assigneeGid: 'u1',
      assigneeName: 'Alice',
      sectionGid: 's1',
      sectionName: 'To Do',
      completed: false,
      dueOn: '2026-07-10',
      numSubtasks: 2,
      parentTaskGid: null,
    });
    expect(m.asanaModifiedAt).toEqual(new Date('2026-07-01T12:00:00.000Z'));
  });

  it('supplies safe defaults for a sparse payload', () => {
    const m = mapTaskToMirror({ gid: 't2' }, 'site-1', 'p1');
    expect(m.name).toBe('(untitled task)');
    expect(m.completed).toBe(false);
    expect(m.assigneeGid).toBeNull();
    expect(m.sectionGid).toBeNull();
    expect(m.numSubtasks).toBe(0);
    expect(m.asanaModifiedAt).toBeNull();
  });

  it('records a subtask parent gid', () => {
    const m = mapTaskToMirror({ gid: 't3', parent: { gid: 'p-parent' } }, 'site-1', 'p1');
    expect(m.parentTaskGid).toBe('p-parent');
  });
});
