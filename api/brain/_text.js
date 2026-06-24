/**
 * Shared text-similarity helpers for duplicate detection across the brain
 * (ingest and source crawl). One tested copy so dedupe behaves the same
 * everywhere.
 */

/** Lowercased word set, punctuation stripped, short words dropped. */
export function tokens(s) {
  return new Set(
    String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
  );
}

/** Jaccard similarity (0..1) between two strings' token sets. */
export function similarity(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}
