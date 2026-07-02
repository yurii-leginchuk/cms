import { DetectorPass, DiffCurrentFinding, DiffPrevFinding, diffFindings } from './audit-diff';

const prev = (fp: string, checkType = 'noindex_regression', subjectKey = `https://example.com/${fp}`, status: DiffPrevFinding['status'] = 'open'): DiffPrevFinding =>
  ({ fingerprint: fp, checkType, subjectKey, status });

const curr = (fp: string, checkType = 'noindex_regression', subjectKey = `https://example.com/${fp}`): DiffCurrentFinding =>
  ({ fingerprint: fp, checkType, subjectKey });

const completePass = (subjects: string[]): DetectorPass =>
  ({ scopeComplete: true, evaluatedSubjects: new Set(subjects) });

describe('diffFindings (pure, deterministic)', () => {
  it('buckets new vs persisting', () => {
    const d = diffFindings(
      [prev('a')],
      [curr('a'), curr('b')],
      { noindex_regression: completePass(['https://example.com/a', 'https://example.com/b']) },
    );
    expect(d.new).toEqual(['b']);
    expect(d.persisting).toEqual(['a']);
    expect(d.resolved).toEqual([]);
    expect(d.unconfirmed).toEqual([]);
  });

  it('resolves ONLY when scopeComplete AND the subject was re-evaluated', () => {
    const d = diffFindings(
      [prev('gone')],
      [],
      { noindex_regression: completePass(['https://example.com/gone']) },
    );
    expect(d.resolved).toEqual(['gone']);
    expect(d.unconfirmed).toEqual([]);
  });

  it('scope-incomplete pass ⇒ unconfirmed, never resolved (THE anti-flap rule)', () => {
    const d = diffFindings(
      [prev('gone')],
      [],
      {
        noindex_regression: {
          scopeComplete: false,
          evaluatedSubjects: new Set(['https://example.com/gone']), // even evaluated!
        },
      },
    );
    expect(d.resolved).toEqual([]);
    expect(d.unconfirmed).toEqual(['gone']);
  });

  it('subject not re-evaluated (budget cut) ⇒ unconfirmed even when scopeComplete', () => {
    const d = diffFindings(
      [prev('gone', 'money_page_regression')],
      [],
      { money_page_regression: completePass(['https://example.com/other']) },
    );
    expect(d.resolved).toEqual([]);
    expect(d.unconfirmed).toEqual(['gone']);
  });

  it('a detector that did not run at all ⇒ unconfirmed', () => {
    const d = diffFindings([prev('gone', 'sitemap_broken', 'site')], [], {});
    expect(d.resolved).toEqual([]);
    expect(d.unconfirmed).toEqual(['gone']);
  });

  it('muted/accepted previous findings still resolve when verified absent', () => {
    const d = diffFindings(
      [prev('m', 'noindex_regression', 'https://example.com/m', 'muted')],
      [],
      { noindex_regression: completePass(['https://example.com/m']) },
    );
    expect(d.resolved).toEqual(['m']);
  });

  it('dedupes duplicate current fingerprints', () => {
    const d = diffFindings(
      [],
      [curr('x'), curr('x')],
      { noindex_regression: completePass(['https://example.com/x']) },
    );
    expect(d.new).toEqual(['x']);
  });

  it('is stable-sorted — same inputs, byte-identical output', () => {
    const previous = [prev('b'), prev('a')];
    const current = [curr('d'), curr('c')];
    const passes = { noindex_regression: completePass(['https://example.com/a', 'https://example.com/b']) };
    const d1 = diffFindings(previous, current, passes);
    const d2 = diffFindings([...previous].reverse(), [...current].reverse(), passes);
    expect(d1).toEqual(d2);
    expect(d1.new).toEqual(['c', 'd']);
    expect(d1.resolved).toEqual(['a', 'b']);
  });
});
