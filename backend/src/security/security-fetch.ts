/**
 * Multi-axis raw fetch (Phase 1 — no headless). Each axis fetches the page with
 * distinct request headers and manually follows redirects so the full chain is
 * recorded. Spoofing the crawler is purely a header concern; analytics
 * suppression (Phase 2, headless) is a separate network-interception layer.
 */

import axios from 'axios';
import { AxisFetchStatus, SecurityAxis } from './security.types';

const MAX_HOPS = 10;
const TIMEOUT_MS = 15_000;
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

// Concrete Chrome build — Googlebot's UA carries a real Chrome version token.
const CHROME_VERSION = '120.0.6099.224';

const AXIS_HEADERS: Record<SecurityAxis, Record<string, string>> = {
  googlebot: {
    'User-Agent':
      `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 ` +
      `(KHTML, like Gecko) Chrome/${CHROME_VERSION} Mobile Safari/537.36 ` +
      `(compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
    Referer: 'https://www.google.com/',
    'Accept-Language': ACCEPT_LANGUAGE,
  },
  chrome: {
    'User-Agent':
      `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ` +
      `(KHTML, like Gecko) Chrome/${CHROME_VERSION} Mobile Safari/537.36`,
    'Accept-Language': ACCEPT_LANGUAGE,
  },
};

export interface AxisFetchResult {
  axis: SecurityAxis;
  status: AxisFetchStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChain: { url: string; status: number }[];
  html: string | null;
  error?: string;
}

export async function fetchAxis(url: string, axis: SecurityAxis): Promise<AxisFetchResult> {
  const redirectChain: { url: string; status: number }[] = [];
  let current = url;

  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const res = await axios.get(current, {
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_CONTENT_BYTES,
        responseType: 'text',
        transformResponse: (d) => d, // keep raw string
        validateStatus: () => true,
        headers: AXIS_HEADERS[axis],
      });

      const httpStatus = res.status;
      if (httpStatus >= 300 && httpStatus < 400) {
        const location = res.headers['location'];
        if (!location) {
          return { axis, status: 'reachable', httpStatus, finalUrl: current, redirectChain, html: null };
        }
        redirectChain.push({ url: current, status: httpStatus });
        current = new URL(location, current).toString();
        continue;
      }

      // Terminal response.
      const ok = httpStatus >= 200 && httpStatus < 300;
      return {
        axis,
        status: ok ? 'reachable' : 'error',
        httpStatus,
        finalUrl: current,
        redirectChain,
        html: ok ? (res.data as string) : null,
      };
    }

    // Too many hops.
    return {
      axis,
      status: 'error',
      httpStatus: null,
      finalUrl: current,
      redirectChain,
      html: null,
      error: 'too_many_redirects',
    };
  } catch (err) {
    return {
      axis,
      status: 'unreachable',
      httpStatus: null,
      finalUrl: null,
      redirectChain,
      html: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
