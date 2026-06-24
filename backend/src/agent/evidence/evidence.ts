/**
 * Evidence envelope — the unified provenance surface for every data source the
 * assistant cites (crawl, GSC, PSI, SEMrush, Brand Card).
 *
 * The discipline mirrors the GSC `totals` pattern: the SERVER computes/holds the
 * authoritative value and the model QUOTES it verbatim — it never estimates a
 * measured number (keyword volume, KD, impressions, savings-ms) from memory.
 *
 * `EvidenceProvider` is intentionally light for now; it formalizes the contract
 * so new sources (a live SEMrush API) slot in without prompt sprawl.
 */
export type EvidenceSource = 'crawl' | 'gsc' | 'psi' | 'semrush' | 'brandCard' | 'internal_links';

export interface Evidence<T = unknown> {
  value: T;
  provenance: {
    source: EvidenceSource;
    metric: string; // human-readable, quotable, e.g. "111 impressions at pos 8.2"
    dateRange: string | null;
    verbatim: true; // signals: quote this value exactly, do not re-derive
  };
}

export function evidenceFor<T>(
  source: EvidenceSource,
  value: T,
  metric: string,
  dateRange: string | null = null,
): Evidence<T> {
  return { value, provenance: { source, metric, dateRange, verbatim: true } };
}

export interface EvidenceProvider {
  readonly source: EvidenceSource;
  describe(): string;
}
