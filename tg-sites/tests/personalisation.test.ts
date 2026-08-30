/**
 * Server-side personalisation, the wiring: the returning-visitor cookie the
 * middleware sets, and the render boundary that filters a page's sections by the
 * request before it draws them.
 *
 * The decision itself is proved in audience.test.ts. These hold the two seams
 * that make it real on a published page: the cookie is set once, on the first
 * visit only, and the site route resolves the visitor and filters the tree it is
 * about to render (while leaving the shared, cached load result alone, so a
 * crawler's metadata pass still sees the whole page).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '../middleware';
import { RETURNING_VISITOR_COOKIE } from '../lib/content/audience';
import { ISO_COUNTRIES } from '../lib/content/countries';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

function siteRequest(headers: Record<string, string>) {
  // A client hostname (not localhost, not *.vercel.app, not a preview subdomain),
  // so middleware takes the rewrite branch where the cookie is set.
  return new NextRequest('https://acme.travel/', {
    headers: { host: 'acme.travel', ...headers },
  });
}

describe('the returning-visitor cookie', () => {
  it('is set on a first visit, marked functional and long-lived', () => {
    const res = middleware(siteRequest({}));
    const cookie = res.cookies.get(RETURNING_VISITOR_COOKIE);
    expect(cookie?.value).toBe('1');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect((cookie?.maxAge ?? 0)).toBeGreaterThan(60 * 60 * 24 * 300);
  });

  it('is not set again when the visitor already carries it', () => {
    const res = middleware(siteRequest({ cookie: `${RETURNING_VISITOR_COOKIE}=1` }));
    expect(res.cookies.get(RETURNING_VISITOR_COOKIE)).toBeUndefined();
  });
});

describe('the site route personalises what it renders', () => {
  const route = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');

  it('reads the visitor and filters both a page and a collection entry', () => {
    expect(route).toContain('readVisitorSignals(slug, utmCampaign)');
    expect(route).toContain('personaliseSections(rawFound.page.content.sections, signals)');
    expect(route).toContain('personaliseSections(rawFound.entry.item.sections, signals)');
    // The campaign facet comes off the URL, not a header.
    expect(route).toContain('query.utm_campaign');
  });

  it('the signal reader reads language from a header and campaign from the URL', () => {
    const reader = read('lib', 'site', 'visitor-signals.ts');
    expect(reader).toContain("classifyLanguage(h.get('accept-language'))");
    expect(reader).toContain('normaliseCampaign(campaignRaw)');
  });

  it('filters a copy, never the shared cached load result', () => {
    // The metadata pass shares load()'s object, so a crawler must still see the
    // whole page. The filter builds `found` from a spread of `rawFound`.
    expect(route).toContain('...rawFound');
    // And generateMetadata does not personalise: its body, between its own
    // declaration and the page component, never filters or reads the visitor.
    const metaStart = route.indexOf('export async function generateMetadata');
    const metaEnd = route.indexOf('export default async function SitePage');
    expect(metaStart).toBeGreaterThanOrEqual(0);
    const metaBody = route.slice(metaStart, metaEnd);
    expect(metaBody).not.toContain('personaliseSections');
    expect(metaBody).not.toContain('readVisitorSignals');
  });
});

describe('the editor exposes the audience rule per section', () => {
  const props = read('components', 'editor', 'Properties.tsx');

  it('renders the audience control in a section, keyed and committing the rule', () => {
    // Keyed on the section id so switching sections re-seeds the draft, and it
    // commits section.audience through the same updateSection path as every
    // other section field.
    expect(props).toContain('<AudienceField');
    expect(props).toContain('key={`aud-${section.id}`}');
    expect(props).toContain('set({ audience: next }');
  });

  it('offers every facet the rule and the render understand', () => {
    // The control is a shared component now (AudienceField.tsx), reused by the
    // section, block and Popup panels; the facets live there.
    const field = read('components', 'editor', 'AudienceField.tsx');
    expect(field).toContain('Show only to');
    expect(field).toContain('Hide from');
    // The country facet is a searchable picker over the full ISO list.
    expect(field).toContain('<CountryPicker');
    expect(field).toContain('ISO_COUNTRIES');
    expect(field).toContain('AUDIENCE_SOURCES.map');
    expect(field).toContain('Been before');
    // v2 facets: language chips and a utm_campaign box.
    expect(field).toContain('COMMON_LANGUAGES.map');
    expect(field).toContain('utm_campaign');
    // An empty rule is tidied to nothing, exactly a section with no rule.
    expect(field).toContain('tidyAudience');
  });

  it('also exposes the rule per block (v2), through the path-aware setter', () => {
    // The same AudienceField, named for a block, committing through
    // updateBlockAudienceAtPath so it works in a column and in a container alike.
    expect(props).toContain('noun="block"');
    expect(props).toContain('updateBlockAudienceAtPath(c, path, next)');
  });
});

describe('the full country list backs the picker', () => {
  it('is comprehensive and every code is a valid alpha-2 the rule accepts', () => {
    expect(ISO_COUNTRIES.length).toBeGreaterThan(200);
    const codes = new Set<string>();
    for (const country of ISO_COUNTRIES) {
      expect(country.code).toMatch(/^[A-Z]{2}$/);
      expect(country.name.length).toBeGreaterThan(0);
      expect(codes.has(country.code)).toBe(false);
      codes.add(country.code);
    }
    // A few anchors so a bad regeneration is caught.
    expect(codes.has('GB')).toBe(true);
    expect(codes.has('US')).toBe(true);
    expect(codes.has('JP')).toBe(true);
  });
});

describe('Preview as lets a client check an audience in the editor', () => {
  const shell = read('components', 'editor', 'EditorShell.tsx');
  const canvas = read('components', 'editor', 'Canvas.tsx');

  it('the shell holds a preview-as visitor and shows the control only in preview', () => {
    expect(shell).toContain('const [previewAs, setPreviewAs] = useState<VisitorSignals>');
    // The control is gated on preview, and so is what is handed to the canvas.
    expect(shell).toContain('{preview && (');
    expect(shell).toContain('previewAs={preview ? previewAs : undefined}');
    // It offers the same axes the rule uses.
    expect(shell).toContain('ISO_COUNTRIES.map');
    expect(shell).toContain('Been before');
  });

  it('the canvas filters the draft against the preview-as visitor, only when set', () => {
    // A profile is only ever set in preview, so filtering keys on its presence,
    // and editing (no profile) shows every section so a hidden one stays
    // selectable. The renderer draws the filtered tree.
    expect(canvas).toContain('previewAs ? { ...shown, sections: personaliseSections(shown.sections, previewAs) } : shown');
    expect(canvas).toContain('fillNavFolders(shownForVisitor, navPages)');
  });
});
