/**
 * The File element: a document on a page, for a visitor to download.
 *
 * TWO HALVES, and the first is the one that matters. The media library held
 * images and only images until 20 Aug 2026, enforced by a check constraint, so a
 * File element meant widening what may be stored and served. Widening an upload
 * allowlist is the kind of change that goes wrong quietly, so most of this file
 * is about what did NOT get let in.
 *
 * THE PROPERTY UNDER TEST: the list admits things a person READS or OPENS IN
 * ANOTHER PROGRAM, and nothing that a browser would execute from an address we
 * served. SVG, HTML, XML and script types each get a line of their own, because
 * each is a way to run code in a session, and the one-line version of that
 * argument is what somebody in a hurry would skip.
 *
 * The second half is the block, which is a plain link, and everything worth
 * asserting about it follows from that.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blockDefinition, defaultPropsFor, isKnownBlock } from '../lib/content/blocks';
import { changeScope } from '../lib/content/change-scope';
import {
  ALLOWED_DOCUMENT_MIME,
  ALLOWED_MIME,
  DOCUMENT_MIME,
  isAllowedMime,
  MEDIA_MIME,
  storagePathFor,
} from '../lib/media/limits';
import { parsePage, type Page } from '../lib/content/schema';
import { sanitisePage } from '../lib/content/sanitise-page';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/** A sanitised page holding one file block with the given props. */
function pageWithFile(props: Record<string, unknown>): Page {
  const parsed = parsePage({
    version: 1,
    id: 'p1',
    title: 'Brochures',
    slug: 'brochures',
    seo: { noindex: false },
    sections: [
      {
        id: 's1',
        tone: 'light',
        rows: [
          { id: 'r1', columns: [{ id: 'c1', width: 100, blocks: [{ id: 'b1', type: 'file', props }] }] },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return sanitisePage(parsed.page);
}

const props0 = (page: Page) => page.sections[0].rows[0].columns[0].blocks[0].props;

// ---------------------------------------------------------------------------

describe('what a client may now upload', () => {
  it('covers the formats a travel agency actually sends', () => {
    for (const mime of [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv',
      'text/plain',
      'application/zip',
    ]) {
      expect(isAllowedMime(mime), mime).toBe(true);
    }
    expect(ALLOWED_DOCUMENT_MIME).toHaveLength(10);
  });

  /*
   * THE REFUSALS, one line each. Every entry here is a way to run code from an
   * address we served, which is the exact thing the original image-only list
   * existed to prevent and the exact thing widening it could have undone.
   */
  it('refuses everything a browser would execute', () => {
    for (const dangerous of [
      'image/svg+xml',
      'text/html',
      'application/xhtml+xml',
      'application/xml',
      'text/xml',
      'text/javascript',
      'application/javascript',
      'application/ecmascript',
      'application/x-httpd-php',
      'application/x-sh',
      'application/x-msdownload',
      'application/vnd.microsoft.portable-executable',
      'application/java-archive',
      'text/vtt',
    ]) {
      expect(isAllowedMime(dangerous), dangerous).toBe(false);
      expect(ALLOWED_MIME, dangerous).not.toContain(dangerous);
    }
  });

  it('gives every document an extension, so a stored object is named honestly', () => {
    for (const [mime, meta] of Object.entries(DOCUMENT_MIME)) {
      expect(MEDIA_MIME[mime as keyof typeof MEDIA_MIME], mime).toBe(meta.ext);
      expect(meta.label.length, mime).toBeGreaterThan(0);
    }
  });

  it('files a document under the tenant prefix, same as a picture', () => {
    const path = storagePathFor('ten-1', 'Summer Brochure 2027.pdf', 'application/pdf');
    expect(path).toBe('sites/ten-1/media/summer-brochure-2027.pdf');
  });
});

// ---------------------------------------------------------------------------

describe('the pipeline knows a document is not a picture', () => {
  /*
   * Everything below the guard in prepareImageForUpload is about pixels. Handed a
   * PDF, createImageBitmap throws and the catch returns the original, so a
   * document would have survived by ACCIDENT. Relying on a failure path is how a
   * brochure ends up quietly re-encoded as a JPEG the day somebody widens a catch.
   */
  it('skips the browser downscale rather than surviving it by accident', () => {
    const downscale = source('lib', 'media', 'downscale.ts');
    expect(downscale).toContain('if (declared && isDocumentMime(declared)) {');
  });

  /* A canvas produces pictures. The wider check would now wave through a type
     this branch could never legitimately see. */
  it('checks a canvas result against the picture list, not the wider one', () => {
    expect(source('lib', 'media', 'downscale.ts')).toContain('!isImageMime(encoded.type)');
  });

  /* Filtered in SQL, because the paging reads limit + 1 to work out hasMore. A
     page filtered after the read would claim there is more and then return the
     same four rows. */
  it('filters the library by kind in the query rather than after it', () => {
    const db = source('lib', 'db', 'media.ts');
    expect(db).toContain('where mime = any(${mimes})');
    expect(db).toContain('ALLOWED_DOCUMENT_MIME');
  });

  /* An image-only accept header would have made a duplicated site lose its
     files, since duplication copies whatever a client already had. */
  it('does not ask the store for images only when copying a file', () => {
    expect(source('lib', 'media', 'blob.ts')).toContain("headers: { accept: '*/*' }");
  });
});

// ---------------------------------------------------------------------------

describe('the block', () => {
  const definition = blockDefinition('file')!;

  it('is in the library, under Actions and contact, and belongs to the client', () => {
    expect(isKnownBlock('file')).toBe(true);
    expect(definition.group).toBe('Actions and contact');
    expect(definition.staffOnly).toBeUndefined();
  });

  it('sets a default for every field the editor offers', () => {
    const props = defaultPropsFor('file');
    for (const field of definition.fields) {
      expect(props, `no default for "${field.key}"`).toHaveProperty(field.key);
    }
  });

  /*
   * FOUR PROPS FOR ONE CHOICE. The name, size and format are written when the
   * file is picked rather than read at render time, because the alternative is a
   * database query per file per visitor to print "2.4MB". The field names the
   * three companion keys rather than trusting a convention: a size landing in the
   * wrong prop shows a wrong number on a live page.
   */
  it('names the three companion props explicitly', () => {
    const field = definition.fields.find((f) => f.key === 'url');
    expect(field?.kind).toBe('file');
    expect(field && 'nameKey' in field ? field.nameKey : null).toBe('name');
    expect(field && 'sizeKey' in field ? field.sizeKey : null).toBe('size');
    expect(field && 'formatKey' in field ? field.formatKey : null).toBe('format');
  });

  it('opens in a new tab by default, so a reader keeps the page they were on', () => {
    expect(defaultPropsFor('file').newTab).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('what the renderer promises', () => {
  const renderer = source('components', 'render', 'blocks.tsx');

  /*
   * A PLAIN LINK, which is the whole design. A published page ships no
   * JavaScript, so anything cleverer would simply not run; and a link is what
   * makes right-click, "save link as", a phone's share sheet and a screen reader
   * all work without being asked to.
   */
  it('is an anchor with an href, never a scripted control', () => {
    expect(renderer).toContain('export function FileBlock(');
    expect(renderer).toContain('const url = safeUrl(str(props, \'url\'));');
    expect(renderer).not.toMatch(/FileBlock[\s\S]{0,2000}onClick/);
  });

  it('severs the opener whenever it opens a tab', () => {
    expect(renderer).toContain("const target = newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {};");
  });

  /* The size and the format are what tell somebody on a train whether to tap it,
     and what stop a click being a surprise. */
  it('shows the format and the size together', () => {
    expect(renderer).toContain("const detail = [format, size > 0 ? humanBytes(size) : ''].filter(Boolean).join(' · ');");
  });

  it('uses the Button block\'s own control for the button look', () => {
    expect(renderer).toMatch(/FileBlock[\s\S]*?className="tgs-button"/);
  });

  it('draws a placeholder rather than an empty link when no file is chosen', () => {
    expect(renderer).toContain('Choose a file to offer');
  });

  /*
   * THE BADGE IS THE EXTENSION AND THE DETAIL LINE IS THE FORMAT'S NAME.
   *
   * Not a style preference. "PowerPoint" in a badge is nine characters wider
   * than "PDF", so a page of mixed downloads got badges of four widths and
   * titles that started at four different places. An extension is never more
   * than four characters, so every badge is the same size and a column of
   * downloads lines up.
   *
   * Read off the stored filename rather than a fifth prop, since the extension
   * is already in the name and a prop that could disagree with it eventually
   * would.
   */
  it('shows the extension in the badge and the format in the words', () => {
    expect(renderer).toContain("const badge = (name.toLowerCase().match(/\\.([a-z0-9]{1,4})$/)?.[1] ?? format ?? '').slice(0, 4);");
    expect(source('app', 'globals.css')).toContain('.tgs-file__badge {');
    // A fixed width, not a minimum: equal badges are the point.
    expect(source('app', 'globals.css')).toMatch(/\.tgs-file__badge \{[^}]*width: 3\.5rem;/);
  });
});

// ---------------------------------------------------------------------------

describe('a file block on a saved page', () => {
  it('keeps the address, the name, the size and the format', () => {
    const props = props0(
      pageWithFile({
        url: 'https://x.public.blob.vercel-storage.com/sites/t/media/brochure.pdf',
        name: 'Summer brochure.pdf',
        size: 2_400_000,
        format: 'PDF',
        title: 'Summer 2027 brochure',
        description: 'Every resort we sell, with prices.',
        look: 'card',
        align: 'left',
        newTab: true,
      }),
    );
    expect(props.url).toContain('brochure.pdf');
    expect(props.size).toBe(2_400_000);
    expect(props.format).toBe('PDF');
  });

  /* The words are content and a content-only member may change them; the file
     itself, its look and its alignment are not. */
  it('counts a change of title as content', () => {
    const before = pageWithFile({ url: 'https://x.test/a.pdf', title: 'Brochure', name: 'a.pdf' });
    const after = JSON.parse(JSON.stringify(before)) as Page;
    props0(after).title = 'Our brochure';
    expect(changeScope(before, after).structure).toBe(false);
  });

  it('counts a change of look as structure', () => {
    const before = pageWithFile({ url: 'https://x.test/a.pdf', title: 'Brochure', look: 'card' });
    const after = JSON.parse(JSON.stringify(before)) as Page;
    props0(after).look = 'button';
    expect(changeScope(before, after).structure).toBe(true);
  });
});
