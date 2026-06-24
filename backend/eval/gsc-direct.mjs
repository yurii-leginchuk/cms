#!/usr/bin/env node
/**
 * Independent Google Search Console reader for the SEO QA evaluator.
 *
 * Authenticates the service account directly (same JWT->token flow the CMS uses,
 * but with ZERO dependencies — Node built-ins only) and queries GSC, BYPASSING the
 * CMS API. Used as ground truth to verify the assistant reads/interprets GSC
 * correctly (date math, filters, aggregation, caching, rounding).
 *
 * SECURITY: never prints the private key. Do not paste credentials into reports.
 *
 * Usage:
 *   node gsc-direct.mjs list-sites
 *   node gsc-direct.mjs query '{"siteUrl":"https://poirier.agency/","startDate":"2026-03-13","endDate":"2026-06-10","dimensions":["query"],"rowLimit":10}'
 *
 * Credentials resolved from: $GSC_CREDENTIALS_PATH, ./gsc-credentials.json,
 * /app/gsc-credentials.json, ../gsc-credentials.json (first that exists).
 */
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

function resolveCredsPath() {
  const candidates = [
    process.env.GSC_CREDENTIALS_PATH,
    './gsc-credentials.json',
    '/app/gsc-credentials.json',
    '../gsc-credentials.json',
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(`No gsc-credentials.json found. Tried: ${candidates.join(', ')}`);
}

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: creds.token_uri ?? 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(creds.private_key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch(creds.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

async function listSites(token) {
  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`list sites failed: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.siteEntry ?? []).map((s) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel }));
}

async function query(token, params) {
  const { siteUrl, startDate, endDate, dimensions, rowLimit = 25, filters, searchType = 'web' } = params;
  if (!siteUrl || !startDate || !endDate) {
    throw new Error('query requires siteUrl, startDate, endDate');
  }
  const body = {
    startDate,
    endDate,
    type: searchType,
    rowLimit,
    ...(dimensions ? { dimensions } : {}),
    ...(filters && filters.length ? { dimensionFilterGroups: [{ filters }] } : {}),
  };
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`query failed: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  const rows = (json.rows ?? []).map((r) => ({
    keys: r.keys,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: +(r.ctr * 100).toFixed(2),
    position: +r.position.toFixed(1),
  }));
  return {
    query: { siteUrl, startDate, endDate, dimensions: dimensions ?? null, rowLimit, filters: filters ?? null },
    rowCount: rows.length,
    totals: {
      clicks: rows.reduce((s, r) => s + r.clicks, 0),
      impressions: rows.reduce((s, r) => s + r.impressions, 0),
    },
    rows,
  };
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const creds = JSON.parse(readFileSync(resolveCredsPath(), 'utf8'));
  const token = await getAccessToken(creds);

  if (cmd === 'list-sites') {
    console.log(JSON.stringify(await listSites(token), null, 2));
  } else if (cmd === 'query') {
    if (!arg) throw new Error('query needs a JSON params argument');
    console.log(JSON.stringify(await query(token, JSON.parse(arg)), null, 2));
  } else {
    console.error('Usage: gsc-direct.mjs list-sites | query \'<json params>\'');
    process.exit(2);
  }
}

main().catch((err) => { console.error('ERROR:', err.message); process.exit(1); });
