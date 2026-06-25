/**
 * Injected-script detector. Two signals:
 *  - cloaked_script: an external <script src> origin shown to Googlebot but NOT
 *    to the visitor → malicious (script served only to the crawler).
 *  - new_external_script: an external script origin not present in the
 *    last-known-good baseline → drift / early warning (non-malicious on its own,
 *    so it never escalates severity alone — anti false-positive).
 *
 * Pure function. No DB / network.
 */

import { DetectorSignal } from '../security.types';

export interface InjectedScriptInputs {
  botScriptOrigins: string[];
  userScriptOrigins: string[];
  /** External script origins from the last-known-good snapshot, or null if none. */
  baselineScriptOrigins: string[] | null;
}

export function detectInjectedScripts(input: InjectedScriptInputs): DetectorSignal[] {
  const signals: DetectorSignal[] = [];
  const userSet = new Set(input.userScriptOrigins);

  const cloaked = input.botScriptOrigins.filter((o) => !userSet.has(o));
  if (cloaked.length > 0) {
    signals.push({
      detector: 'injected_scripts',
      code: 'cloaked_script',
      malicious: true,
      weight: 40,
      message: `External script(s) served only to Googlebot: ${cloaked.join(', ')}`,
      evidence: { origins: cloaked },
    });
  }

  if (input.baselineScriptOrigins) {
    const baseSet = new Set(input.baselineScriptOrigins);
    const seen = new Set([...input.botScriptOrigins, ...input.userScriptOrigins]);
    const novel = [...seen].filter((o) => !baseSet.has(o) && !cloaked.includes(o));
    if (novel.length > 0) {
      signals.push({
        detector: 'injected_scripts',
        code: 'new_external_script',
        malicious: false,
        weight: 10,
        message: `New external script origin(s) since last scan: ${novel.join(', ')}`,
        evidence: { origins: novel },
      });
    }
  }

  return signals;
}
