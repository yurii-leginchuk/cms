import { detectInjectedScripts } from './injected-scripts';

describe('detectInjectedScripts', () => {
  it('flags an external script served only to the bot as malicious', () => {
    const signals = detectInjectedScripts({
      botScriptOrigins: ['cdn.example.com', 'evil.net'],
      userScriptOrigins: ['cdn.example.com'],
      baselineScriptOrigins: ['cdn.example.com'],
    });
    const cloaked = signals.find((s) => s.code === 'cloaked_script');
    expect(cloaked).toBeDefined();
    expect(cloaked!.malicious).toBe(true);
    expect(cloaked!.evidence.origins).toEqual(['evil.net']);
  });

  it('reports a new external origin vs baseline as benign drift', () => {
    const signals = detectInjectedScripts({
      botScriptOrigins: ['cdn.example.com', 'newtag.io'],
      userScriptOrigins: ['cdn.example.com', 'newtag.io'],
      baselineScriptOrigins: ['cdn.example.com'],
    });
    const drift = signals.find((s) => s.code === 'new_external_script');
    expect(drift).toBeDefined();
    expect(drift!.malicious).toBe(false);
    expect(drift!.evidence.origins).toEqual(['newtag.io']);
  });

  it('is silent when nothing changed and no baseline drift', () => {
    const signals = detectInjectedScripts({
      botScriptOrigins: ['cdn.example.com'],
      userScriptOrigins: ['cdn.example.com'],
      baselineScriptOrigins: ['cdn.example.com'],
    });
    expect(signals).toHaveLength(0);
  });

  it('skips drift detection with no baseline', () => {
    const signals = detectInjectedScripts({
      botScriptOrigins: ['a.com'],
      userScriptOrigins: ['a.com'],
      baselineScriptOrigins: null,
    });
    expect(signals).toHaveLength(0);
  });
});
