/**
 * A curated list of common browser languages, name and ISO 639-1 code, for the
 * editor's audience picker. EDITOR-ONLY data, like countries.ts: the render needs
 * codes only and never imports this, so the names stay out of the site bundle.
 *
 * Curated rather than exhaustive because the language facet matches the visitor's
 * PRIMARY subtag (en, not en-GB), and a shortlist of the languages these travel
 * markets actually browse in is a control someone uses. The rule still accepts
 * any valid two or three letter code by shape (lib/content/audience), so a
 * language outside this list is a later enhancement, not a wrong answer.
 */
export const COMMON_LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'el', name: 'Greek' },
  { code: 'cs', name: 'Czech' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' },
  { code: 'th', name: 'Thai' },
];
