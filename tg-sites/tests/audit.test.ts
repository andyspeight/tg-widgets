/**
 * The SEO and AI-visibility audit.
 *
 * WHAT IS AT RISK HERE IS TRUST IN THE REPORT, which is a different kind of risk
 * from the rest of this suite. Nothing here can leak data or break a page. What
 * it can do is tell a travel agent their page is fine when it is not, or nag
 * them about something they cannot act on, and either one ends with the report
 * being ignored, which makes the whole screen worthless.
 *
 * So the tests fall into three groups:
 *
 *   1. THE COUNTING IS RIGHT. The walker has to find pictures inside repeaters,
 *      because that is where most pictures on a real page live: a gallery, a row
 *      of cards, the slides of a slider. A walker that only looked at top-level
 *      image blocks would report "every picture has a description" on a page
 *      with twelve undescribed ones.
 *
 *   2. NOTHING IS REPORTED THAT CANNOT BE ACTED ON. Every finding that is not
 *      `good` must carry a fix, and no finding may be raised against a page
 *      somebody deliberately hid.
 *
 *   3. THE THRESHOLDS ARE THE ONES THE COPY CLAIMS. The message quotes a number
 *      and the check uses a constant, and the two drifting apart is a report
 *      that contradicts itself.
 */

import { describe, expect, it } from 'vitest';

import { parsePage } from '../lib/content/schema';
import { DEFAULT_SETTINGS } from '../lib/settings/schema';
import {
  auditPage,
  auditSite,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  pageStats,
  tally,
  THIN_WORDS,
  TITLE_MAX,
  type Finding,
} from '../lib/seo/audit';

const SETTINGS = {
  ...DEFAULT_SETTINGS,
  companyName: 'Someshop Travel',
  companyAbout: 'A high street agency in Leeds.',
  socialImageUrl: 'https://cdn.example.com/share.jpg',
};

/** A page with the blocks given, in one section and one column. */
function page(blocks: Array<{ type: string; props: Record<string, unknown> }>, seo: Record<string, unknown> = {}) {
  const parsed = parsePage({
    version: 1,
    id: 'pg',
    title: 'A page',
    slug: 'a-page',
    seo: { noindex: false, ...seo },
    sections: [
      {
        id: 's1',
        rows: [
          {
            id: 'r1',
            columns: [
              {
                id: 'c1',
                width: 100,
                blocks: blocks.map((block, index) => ({ id: `b${index}`, ...block })),
              },
            ],
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.page;
}

/** Words, so a page can be pushed over or under the thin-content line. */
function words(count: number): string {
  return `<p>${Array.from({ length: count }, (_, i) => `word${i}`).join(' ')}</p>`;
}

const ids = (findings: Finding[]) => findings.map((f) => f.id);

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

describe('what the walker finds', () => {
  it('counts the words in the text a client actually typed', () => {
    const stats = pageStats(page([
      { type: 'heading', props: { html: '<h2>Holidays in Crete</h2>' } },
      { type: 'text', props: { html: '<p>One two three</p>' } },
    ]));

    expect(stats.headings).toBe(1);
    // "Holidays in Crete" is three, "One two three" is three.
    expect(stats.words).toBe(6);
  });

  /*
   * THE ONE THAT MATTERS MOST. Most pictures on a real page are inside a
   * repeater: a gallery's images, a card grid, a slider's slides, the logo
   * strip. A walker that only looked at top-level image blocks would tell a
   * client with a twelve-picture gallery that every picture has a description.
   */
  it('finds pictures inside a gallery, not just a bare image block', () => {
    const stats = pageStats(page([
      { type: 'image', props: { src: 'https://x/1.jpg', alt: 'A beach' } },
      {
        type: 'gallery',
        props: {
          images: [
            { src: 'https://x/2.jpg', alt: 'A harbour' },
            { src: 'https://x/3.jpg', alt: '' },
            { src: 'https://x/4.jpg' },
          ],
        },
      },
    ]));

    expect(stats.images).toBe(4);
    expect(stats.imagesWithoutAlt).toBe(2);
  });

  it('does not count a picture nobody has chosen yet', () => {
    const stats = pageStats(page([{ type: 'image', props: { src: '', alt: '' } }]));
    expect(stats.images).toBe(0);
    expect(stats.imagesWithoutAlt).toBe(0);
  });

  it('counts a question only when it has an answer', () => {
    const stats = pageStats(page([
      {
        type: 'accordion',
        props: {
          items: [
            { title: 'Is my money protected?', body: 'Yes, ATOL.' },
            { title: 'A question with no answer', body: '' },
          ],
        },
      },
    ]));

    expect(stats.faqPairs).toBe(1);
  });

  it('survives a page with nothing on it', () => {
    const stats = pageStats(page([]));
    expect(stats).toEqual({ words: 0, images: 0, imagesWithoutAlt: 0, headings: 0, links: 0, faqPairs: 0 });
  });
});

// ---------------------------------------------------------------------------
// The findings
// ---------------------------------------------------------------------------

describe('auditing a page', () => {
  /*
   * A HIDDEN PAGE IS NOT A BROKEN PAGE. Listing eight faults against a thank-you
   * page somebody deliberately hid is how a report loses its reader, and the
   * reader it loses is the one who hid the page on purpose.
   */
  it('says one thing about a page that was hidden on purpose, and stops', () => {
    const findings = auditPage(page([]), 'Thanks', SETTINGS, );
    const hidden = auditPage(page([], { noindex: true }), 'Thanks', SETTINGS);

    expect(ids(hidden)).toEqual(['noindex']);
    expect(findings.length).toBeGreaterThan(1);
  });

  it('reports a missing description as a problem, since it is the line under the title', () => {
    const findings = auditPage(page([{ type: 'text', props: { html: words(200) } }]), 'A good long page title', SETTINGS);
    const found = findings.find((f) => f.id === 'description-missing');

    expect(found?.severity).toBe('problem');
    expect(found?.fix).not.toBe('');
  });

  it('reports pictures with no description, and counts them', () => {
    const findings = auditPage(
      page([
        { type: 'gallery', props: { images: [{ src: 'https://x/1.jpg' }, { src: 'https://x/2.jpg' }] } },
        { type: 'text', props: { html: words(200) } },
      ]),
      'A good long page title',
      SETTINGS,
    );

    const found = findings.find((f) => f.id === 'alt-missing');
    expect(found?.severity).toBe('problem');
    expect(found?.title).toContain('2 pictures');
  });

  it('says so when every picture is described', () => {
    const findings = auditPage(
      page([
        { type: 'image', props: { src: 'https://x/1.jpg', alt: 'A beach at Elounda' } },
        { type: 'text', props: { html: words(200) } },
      ]),
      'A good long page title',
      SETTINGS,
    );

    expect(ids(findings)).toContain('alt-ok');
    expect(ids(findings)).not.toContain('alt-missing');
  });

  /*
   * THIN CONTENT IS ABOUT BEING QUOTABLE, not about a word count Google
   * publishes, because it does not publish one. A page an assistant cannot
   * answer from is a page it will not cite.
   */
  it('escalates a nearly empty page from a warning to a problem', () => {
    const nearlyEmpty = auditPage(page([{ type: 'text', props: { html: words(10) } }]), 'A good long page title', SETTINGS);
    const shortish = auditPage(page([{ type: 'text', props: { html: words(THIN_WORDS - 10) } }]), 'A good long page title', SETTINGS);

    expect(nearlyEmpty.find((f) => f.id === 'thin')?.severity).toBe('problem');
    expect(shortish.find((f) => f.id === 'thin')?.severity).toBe('warning');
  });

  it('is satisfied once there is enough to answer a question', () => {
    const findings = auditPage(page([{ type: 'text', props: { html: words(THIN_WORDS + 1) } }]), 'A good long page title', SETTINGS);
    expect(ids(findings)).toContain('length-ok');
    expect(ids(findings)).not.toContain('thin');
  });

  it('treats questions on the page as the opportunity they are, never a fault', () => {
    const without = auditPage(page([{ type: 'text', props: { html: words(200) } }]), 'A good long page title', SETTINGS);
    const withFaq = auditPage(
      page([
        { type: 'text', props: { html: words(200) } },
        {
          type: 'accordion',
          props: {
            items: [
              { title: 'Is my money protected?', body: 'Yes, every package is ATOL protected.' },
              { title: 'What is included?', body: 'Flights, transfers and seven nights.' },
            ],
          },
        },
      ]),
      'A good long page title',
      SETTINGS,
    );

    expect(without.find((f) => f.id === 'faq-none')?.severity).toBe('warning');
    expect(ids(withFaq)).toContain('faq-ok');
  });

  /*
   * THE ONE FINDING THAT IS REPEATED ON EVERY PAGE, deliberately: an empty
   * company profile is why the site emits NO structured data at all, and
   * somebody looking at one page's report should not have to go elsewhere to
   * find out why.
   */
  it('says on every page when AI engines cannot tell whose site this is', () => {
    const findings = auditPage(page([{ type: 'text', props: { html: words(200) } }]), 'A good long page title', DEFAULT_SETTINGS);
    const found = findings.find((f) => f.id === 'profile-missing');

    expect(found?.severity).toBe('problem');
    expect(found?.fix).toMatch(/Settings/i);
  });

  it('says nothing about the profile once it is filled in', () => {
    const findings = auditPage(page([{ type: 'text', props: { html: words(200) } }]), 'A good long page title', SETTINGS);
    expect(ids(findings)).not.toContain('profile-missing');
  });
});

// ---------------------------------------------------------------------------
// The two promises the whole report rests on
// ---------------------------------------------------------------------------

describe('what every finding has to be', () => {
  /*
   * ACTIONABLE OR SILENT. A finding a travel agent cannot act on is one that
   * teaches them to skim the list, and a list somebody skims is a list that
   * hides the one thing that mattered.
   */
  it('tells you what to do about anything that is not already fine', () => {
    const cases = [
      auditPage(page([]), '', DEFAULT_SETTINGS),
      auditPage(page([{ type: 'text', props: { html: words(200) } }]), 'x'.repeat(TITLE_MAX + 20), SETTINGS),
      auditSite(DEFAULT_SETTINGS, 0),
    ];

    for (const findings of cases) {
      for (const found of findings) {
        if (found.severity === 'good') continue;
        expect(found.fix.trim(), `${found.id} has no fix`).not.toBe('');
        expect(found.title.trim(), `${found.id} has no title`).not.toBe('');
      }
    }
  });

  /*
   * THE MESSAGE QUOTES A NUMBER AND THE CHECK USES A CONSTANT. If the two drift
   * the report contradicts itself, which is worse than being wrong once: it
   * tells somebody to trim to 160 characters and then complains at 158.
   */
  it('quotes the same limits it actually enforces', () => {
    const tooLong = auditPage(
      page([{ type: 'text', props: { html: words(200) } }]),
      'A good long page title',
      SETTINGS,
    );
    void tooLong;

    const longDescription = auditPage(
      page([{ type: 'text', props: { html: words(200) } }], { description: 'x'.repeat(DESCRIPTION_MAX + 5) }),
      'A good long page title',
      SETTINGS,
    ).find((f) => f.id === 'description-long');

    expect(longDescription?.title).toContain(String(DESCRIPTION_MAX + 5));
    expect(longDescription?.fix).toContain(String(DESCRIPTION_MAX));

    const shortDescription = auditPage(
      page([{ type: 'text', props: { html: words(200) } }], { description: 'Too short.' }),
      'A good long page title',
      SETTINGS,
    ).find((f) => f.id === 'description-short');

    expect(shortDescription?.fix).toContain(String(DESCRIPTION_MIN));
    expect(shortDescription?.fix).toContain(String(DESCRIPTION_MAX));
  });

  it('gives every finding an id of its own within one report', () => {
    const findings = auditPage(page([]), '', DEFAULT_SETTINGS);
    expect(new Set(ids(findings)).size).toBe(findings.length);
  });
});

describe('auditing the site', () => {
  it('leads with the company name, which is what decides everything else', () => {
    const findings = auditSite(DEFAULT_SETTINGS, 3);
    expect(findings[0].id).toBe('site-name-missing');
    expect(findings[0].severity).toBe('problem');
  });

  it('says a site with nothing published has nothing to find', () => {
    expect(ids(auditSite(SETTINGS, 0))).toContain('no-pages');
    expect(ids(auditSite(SETTINGS, 1))).not.toContain('no-pages');
  });

  it('is happy with a site that has been filled in', () => {
    const findings = auditSite(SETTINGS, 4);
    expect(findings.every((f) => f.severity === 'good')).toBe(true);
  });
});

describe('the summary line', () => {
  it('counts each kind, so a screen and a report cannot disagree', () => {
    const counted = tally([
      { id: 'a', severity: 'problem', title: '', fix: '' },
      { id: 'b', severity: 'problem', title: '', fix: '' },
      { id: 'c', severity: 'warning', title: '', fix: '' },
      { id: 'd', severity: 'good', title: '', fix: '' },
    ]);

    expect(counted).toEqual({ problem: 2, warning: 1, good: 1 });
  });
});
