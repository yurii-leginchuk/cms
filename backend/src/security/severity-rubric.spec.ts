import { scoreFindings, maxSeverity } from './severity-rubric';
import { DetectorSignal } from './security.types';

const sig = (over: Partial<DetectorSignal>): DetectorSignal => ({
  detector: 'content_diff',
  code: 'x',
  malicious: false,
  weight: 5,
  message: '',
  evidence: {},
  ...over,
});

describe('scoreFindings', () => {
  it('returns info for an empty signal set', () => {
    expect(scoreFindings([]).severity).toBe('info');
  });

  it('benign-only signals stay info/low (never escalate)', () => {
    expect(scoreFindings([sig({ weight: 5 })]).severity).toBe('info');
    expect(scoreFindings([sig({ weight: 10 })]).severity).toBe('low');
  });

  it('a single malicious signal is medium', () => {
    const r = scoreFindings([sig({ malicious: true, code: 'spam', weight: 30 })]);
    expect(r.severity).toBe('medium');
    expect(r.score).toBe(30);
  });

  it('two independent malicious signals below threshold escalate to high', () => {
    const r = scoreFindings([
      sig({ malicious: true, code: 'spam', weight: 20 }),
      sig({ malicious: true, code: 'redirect', weight: 30 }),
    ]);
    expect(r.score).toBe(50);
    expect(r.severity).toBe('high');
  });

  it('cloaked redirect + cloaked script crosses critical threshold', () => {
    const r = scoreFindings([
      sig({ malicious: true, code: 'bot_only_external_redirect', weight: 40 }),
      sig({ malicious: true, code: 'cloaked_script', weight: 40 }),
    ]);
    expect(r.score).toBe(80);
    expect(r.severity).toBe('critical');
  });

  it('duplicate malicious codes count as one (independence)', () => {
    const r = scoreFindings([
      sig({ malicious: true, code: 'spam', weight: 10 }),
      sig({ malicious: true, code: 'spam', weight: 10 }),
    ]);
    expect(r.maliciousCodes).toEqual(['spam']);
    expect(r.severity).toBe('medium');
  });
});

describe('maxSeverity', () => {
  it('picks the worse of two', () => {
    expect(maxSeverity('low', 'critical')).toBe('critical');
    expect(maxSeverity('medium', 'info')).toBe('medium');
  });
});
