/**
 * Cloaked-redirect detector — the highest-signal, lowest-false-positive check.
 * If the Googlebot axis is redirected to an EXTERNAL host while the visitor axis
 * is not, that is near-certain cloaking (or a hacked redirect).
 *
 * Pure function over the two axes' redirect chains. No DB / network.
 */

import { DetectorSignal } from '../security.types';
import { registrableDomain } from '../normalize';

export interface RedirectAxis {
  /** Originally requested URL. */
  requestedUrl: string;
  /** Final URL after following redirects (null if the request failed). */
  finalUrl: string | null;
  redirectChain: { url: string; status: number }[];
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function externalRedirectTarget(axis: RedirectAxis): string | null {
  if (axis.redirectChain.length === 0) return null;
  const origin = registrableDomain(hostOf(axis.requestedUrl) ?? '');
  const finalDomain = registrableDomain(hostOf(axis.finalUrl) ?? '');
  if (!finalDomain || finalDomain === origin) return null;
  return finalDomain;
}

export function detectRedirectCloak(bot: RedirectAxis, user: RedirectAxis): DetectorSignal[] {
  const botTarget = externalRedirectTarget(bot);
  const userTarget = externalRedirectTarget(user);

  // External redirect for the bot that the visitor does NOT get.
  if (botTarget && botTarget !== userTarget) {
    return [
      {
        detector: 'redirect_cloak',
        code: 'bot_only_external_redirect',
        malicious: true,
        weight: 40,
        message: `Googlebot is redirected to external domain "${botTarget}" but visitors are not`,
        evidence: {
          target: botTarget,
          botChain: bot.redirectChain,
          userChain: user.redirectChain,
        },
      },
    ];
  }

  return [];
}
