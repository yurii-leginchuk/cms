/**
 * Content-diff detector. When the normalized main-content hash differs between
 * the Googlebot view and the visitor view, emit a single informational signal
 * plus a bounded excerpt. Non-malicious on its own (legitimate personalization
 * / A-B tests differ too) — it only escalates severity in combination with a
 * malicious signal. Pure function.
 */

import { DetectorSignal } from '../security.types';

export const MAX_EXCERPT_BYTES = 8 * 1024;

export interface ContentDiffInputs {
  botHash: string;
  userHash: string;
  botText: string;
  userText: string;
}

/** First lines present in bot text but not in visitor text, capped at MAX_EXCERPT_BYTES. */
export function buildExcerpt(botText: string, userText: string): string {
  const userLines = new Set(userText.split('\n'));
  const onlyBot = botText.split('\n').filter((l) => l.trim() && !userLines.has(l));
  let out = '';
  for (const line of onlyBot) {
    if (Buffer.byteLength(out + line + '\n') > MAX_EXCERPT_BYTES) break;
    out += line + '\n';
  }
  return out.trimEnd();
}

export function detectContentDiff(input: ContentDiffInputs): DetectorSignal[] {
  if (input.botHash === input.userHash) return [];
  return [
    {
      detector: 'content_diff',
      code: 'content_mismatch',
      malicious: false,
      weight: 5,
      message: 'Main content differs between the Googlebot view and the visitor view',
      evidence: { botHash: input.botHash, userHash: input.userHash },
    },
  ];
}
