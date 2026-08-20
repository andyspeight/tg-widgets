/**
 * What is wrong with this page, in the eyes of a search engine and an assistant.
 *
 * WHAT THIS IS FOR. Andy is building a separate tool that tells a prospect how
 * their current site is found, and asked on 1 Aug 2026 for the same thing inside
 * the product: "a dashboard full of tools and reports". This is the engine
 * behind it. The screen is a rendering of what comes out of here.
 *
 * PURE, AND THAT IS THE POINT. No database, no network, no React. It takes a
 * page and the site's settings and returns findings. That makes it testable
 * against real pages without a browser, and it means the same function can one
 * day score a page in the editor, a page in a report, and somebody else's page
 * pasted into the sales tool, with no chance of the three disagreeing.
 *
 * EVERY FINDING HAS TO BE ACTIONABLE, and that rules out most of what SEO
 * checkers report. "Keyword density is 1.2%" is not something a travel agent can
 * act on and is not something any engine has used for a decade. Every check
 * below is something a person can fix this afternoon, and the `fix` field says
 * how in a sentence. A report full of findings nobody can act on trains people
 * to ignore the report.
 *
 * THREE SEVERITIES AND NO SCORE OUT OF A HUNDRED. A number out of a hundred is
 * a number people optimise instead of the thing it stands for, and every tool
 * invents its own. `problem` means this is costing you, `warning` means it is
 * worth doing, `good` means it is done. The screen can count them.
 */

import type { Page, Section } from '../content/schema';
import { hasOpeningHours, hasPostalAddress, type SiteSettings } from '../settings/schema';
import { plainText } from './jsonld';

export type Severity = 'problem' | 'warning' | 'good';

export interface Finding {
  /** Stable key, so a screen can filter and a test can name one. */
  id: string;
  severity: Severity;
  /** What is true, in one line, in plain words. */
  title: string;
  /** What to do about it. Empty for a `good`, which needs no action. */
  fix: string;
}

/** Everything counted while walking a page once. */
export interface PageStats {
  words: number;
  images: number;
  imagesWithoutAlt: number;
  headings: number;
  links: number;
  /** Questions and answers, which become FAQ structured data. */
  faqPairs: number;
}

// ---------------------------------------------------------------------------
// The limits, named so the report and the tests agree about them
// ---------------------------------------------------------------------------

/**
 * Google truncates a title around 60 characters and the schema caps it at 70.
 * Under 15 is not a title, it is a word.
 */
export const TITLE_MIN = 15;
export const TITLE_MAX = 60;

/** Under 70 wastes the space, over 160 is cut off mid-sentence. */
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;

/**
 * THIN CONTENT, and the number is a judgement rather than a rule.
 *
 * Nobody outside Google knows the real threshold and anybody quoting one is
 * guessing. 150 words is the point at which a page stops being able to answer a
 * question on its own, which is what an assistant needs it to do: a page it
 * cannot answer from is a page it will not cite. Deliberately low, so it flags
 * a genuinely empty page rather than nagging about a short contact page.
 */
export const THIN_WORDS = 150;

// ---------------------------------------------------------------------------
// Walking the page
// ---------------------------------------------------------------------------

const TEXT_PROPS = ['html', 'text', 'title', 'body', 'caption', 'label', 'quote', 'attribution', 'summary'];

/**
 * Count everything worth counting, in one pass over the tree.
 *
 * ONE PASS, because a page is a small tree and six separate walks would be six
 * chances for two of them to disagree about what counts as a block.
 *
 * IMAGES ARE COUNTED FROM ANY BLOCK THAT HAS A `src` AND AN `alt`, rather than
 * from a list of block types. Image, gallery rows, card rows, slider slides and
 * the logo strip all carry that pair, and a list of types would go stale the
 * next time a block gains a picture, which is exactly the failure that leaves a
 * client's report saying everything is fine.
 */
export function pageStats(page: Page): PageStats {
  const stats: PageStats = {
    words: 0,
    images: 0,
    imagesWithoutAlt: 0,
    headings: 0,
    links: 0,
    faqPairs: 0,
  };

  const countImage = (props: Record<string, unknown>) => {
    const src = typeof props.src === 'string' ? props.src.trim() : '';
    if (src === '') return;
    stats.images += 1;
    const alt = typeof props.alt === 'string' ? props.alt.trim() : '';
    if (alt === '') stats.imagesWithoutAlt += 1;
  };

  const countText = (props: Record<string, unknown>) => {
    for (const key of TEXT_PROPS) {
      const words = plainText(props[key], 20_000);
      if (words) stats.words += words.split(/\s+/).filter(Boolean).length;
    }
  };

  const walkProps = (type: string, props: Record<string, unknown>) => {
    if (type === 'heading') stats.headings += 1;
    if (typeof props.href === 'string' && props.href.trim() !== '') stats.links += 1;

    countImage(props);
    countText(props);

    // A repeater's rows are objects with the same kinds of key, so the same
    // counting applies to each. Nested one level, which is all any block has.
    for (const value of Object.values(props)) {
      if (!Array.isArray(value)) continue;
      for (const row of value) {
        if (!row || typeof row !== 'object') continue;
        const item = row as Record<string, unknown>;
        countImage(item);
        countText(item);
        if (typeof item.href === 'string' && item.href.trim() !== '') stats.links += 1;
      }
    }
  };

  for (const section of sectionsOf(page)) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          walkProps(block.type, block.props);

          if (block.type === 'accordion') {
            const items = Array.isArray(block.props.items) ? block.props.items : [];
            stats.faqPairs += items.filter((raw) => {
              const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
              return plainText(item.title, 300) !== '' && plainText(item.body, 1000) !== '';
            }).length;
          }
        }
      }
    }
  }

  return stats;
}

/**
 * Anything made of sections: a page, a header or footer region, or a blog post.
 *
 * STRUCTURAL RATHER THAN `Page`, because a collection item is section-shaped
 * without being a page (no slug, no SEO, no place in the tree — see
 * lib/content/collection.ts) and pageText below has to be able to read one. The
 * walk only ever touches `sections`, so asking for a whole Page was asking for
 * more than the job needs.
 */
type SectionTree = { sections?: readonly Section[] };

function sectionsOf(page: SectionTree): readonly Section[] {
  return Array.isArray(page.sections) ? page.sections : [];
}

/**
 * The words on a page, in reading order, for the writing assistant.
 *
 * SEPARATE FROM pageStats, which counts the same words but throws them away.
 * The assistant has to READ the page to write a description of it, and the one
 * thing that makes an AI-written description worthless is being written from the
 * page's title alone: "Holidays in Greece. Browse our holidays in Greece."
 *
 * IN READING ORDER, AND HEADINGS FIRST WITHIN A BLOCK, because the first two
 * hundred words of a page are what it is about and the cap below will cut the
 * rest. A walker that gathered every `body` before every `title` would hand the
 * model the footer small print and none of the headings.
 *
 * CAPPED, because this is sent to a model that charges by the token and a
 * client can paste an entire brochure into one page. 6000 characters is several
 * screens, far more than is needed to say what a page is for.
 */
export function pageText(page: SectionTree, max = 6000): string {
  const parts: string[] = [];

  const take = (props: Record<string, unknown>) => {
    for (const key of TEXT_PROPS) {
      const words = plainText(props[key], 2000);
      if (words) parts.push(words);
    }
  };

  for (const section of sectionsOf(page)) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks) {
          take(block.props);

          for (const value of Object.values(block.props)) {
            if (!Array.isArray(value)) continue;
            for (const item of value) {
              if (item && typeof item === 'object') take(item as Record<string, unknown>);
            }
          }
        }
      }
    }
  }

  return parts.join('\n').slice(0, max).trim();
}

// ---------------------------------------------------------------------------
// The findings
// ---------------------------------------------------------------------------

function finding(
  id: string,
  severity: Severity,
  title: string,
  fix = '',
): Finding {
  return { id, severity, title, fix };
}

/**
 * One page, checked.
 *
 * `pageTitle` is the page's own name, which is what the title tag falls back to
 * when nobody has written a search title. Both are needed: a page called "Home"
 * has a title and it is a bad one, and telling somebody "you have a title" would
 * be true and useless.
 */
export function auditPage(
  page: Page,
  pageTitle: string,
  settings: SiteSettings,
): Finding[] {
  const findings: Finding[] = [];
  const stats = pageStats(page);
  const seo = page.seo ?? { noindex: false };

  /*
   * NOINDEX FIRST AND THEN STOP. A page deliberately hidden is not a page with
   * problems, and listing eight faults on a thank-you page somebody hid on
   * purpose is how a report loses its reader.
   */
  if (seo.noindex) {
    return [
      finding(
        'noindex',
        'warning',
        'This page is hidden from search engines',
        'That is deliberate if you set it. If not, turn off "Hide from search engines" in this page\'s settings.',
      ),
    ];
  }

  // --- The title ---
  const title = (seo.title ?? pageTitle ?? '').trim();
  if (title === '') {
    findings.push(finding(
      'title-missing',
      'problem',
      'This page has no title',
      'Give it a search title in the page settings. It is the line people click in the results.',
    ));
  } else if (title.length > TITLE_MAX) {
    findings.push(finding(
      'title-long',
      'warning',
      `The title is ${title.length} characters, so it will be cut off`,
      `Trim it to about ${TITLE_MAX}. Put the important words first.`,
    ));
  } else if (title.length < TITLE_MIN) {
    findings.push(finding(
      'title-short',
      'warning',
      'The title is very short',
      'Say what the page is and who it is for. "Holidays" tells nobody which ones.',
    ));
  } else {
    findings.push(finding('title-ok', 'good', 'The title is a good length'));
  }

  // --- The description ---
  const description = (seo.description ?? '').trim();
  if (description === '') {
    findings.push(finding(
      'description-missing',
      'problem',
      'This page has no search description',
      'Write one sentence saying what somebody gets from this page. It is what appears under the title in the results.',
    ));
  } else if (description.length > DESCRIPTION_MAX) {
    findings.push(finding(
      'description-long',
      'warning',
      `The description is ${description.length} characters, so it will be cut off`,
      `Trim it to about ${DESCRIPTION_MAX}.`,
    ));
  } else if (description.length < DESCRIPTION_MIN) {
    findings.push(finding(
      'description-short',
      'warning',
      'The description is shorter than the space it is given',
      `About ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX} characters uses the whole line.`,
    ));
  } else {
    findings.push(finding('description-ok', 'good', 'The description is a good length'));
  }

  // --- Pictures ---
  if (stats.imagesWithoutAlt > 0) {
    findings.push(finding(
      'alt-missing',
      'problem',
      stats.imagesWithoutAlt === 1
        ? 'One picture has no description'
        : `${stats.imagesWithoutAlt} pictures have no description`,
      'Add alt text in the image bank. It is what a screen reader reads out and what a search engine uses to know what the picture shows.',
    ));
  } else if (stats.images > 0) {
    findings.push(finding('alt-ok', 'good', 'Every picture has a description'));
  }

  // --- Enough to answer a question ---
  if (stats.words < THIN_WORDS) {
    findings.push(finding(
      'thin',
      stats.words < THIN_WORDS / 2 ? 'problem' : 'warning',
      `There are only about ${stats.words} words on this page`,
      'An assistant can only quote a page that answers the question. Say more about what you offer and who it suits.',
    ));
  } else {
    findings.push(finding('length-ok', 'good', 'There is enough here to answer a question'));
  }

  // --- Headings ---
  if (stats.headings === 0 && stats.words > 0) {
    findings.push(finding(
      'headings-missing',
      'warning',
      'This page has no headings',
      'Break it up with headings. They are how both a reader and an engine find the part that answers them.',
    ));
  }

  /*
   * THE FAQ ONE IS AN OPPORTUNITY RATHER THAN A FAULT, which is why it is only
   * ever a warning and never a problem. Questions and answers on the page become
   * FAQ structured data, and a question with an answer is exactly the shape of
   * what somebody asks an assistant. It is the cheapest win on this list.
   */
  if (stats.faqPairs >= 2) {
    findings.push(finding(
      'faq-ok',
      'good',
      'The questions on this page are offered to AI engines as answers',
    ));
  } else {
    findings.push(finding(
      'faq-none',
      'warning',
      'This page answers no questions directly',
      'Add an Accordion with the questions people actually ask. We hand those to AI engines as ready-made answers.',
    ));
  }

  // --- The site-wide thing that decides everything, said on every page ---
  if (!settings.companyName.trim()) {
    findings.push(finding(
      'profile-missing',
      'problem',
      'AI engines cannot tell whose website this is',
      'Fill in Company name and About in Settings. Without them we cannot tell an AI engine who you are, so it will not name you in an answer.',
    ));
  }

  return findings;
}

/**
 * The whole site, checked once, for the things that are not per page.
 *
 * SEPARATE FROM THE PAGE CHECKS because repeating "your company profile is
 * empty" against forty pages is how a report becomes noise. The one exception is
 * the profile itself, which appears in both: it is the single thing that decides
 * whether ANY structured data is emitted, and somebody looking at one page's
 * report should not have to go elsewhere to find out why they have none.
 */
export function auditSite(settings: SiteSettings, pageCount: number): Finding[] {
  const findings: Finding[] = [];

  if (!settings.companyName.trim()) {
    findings.push(finding(
      'site-name-missing',
      'problem',
      'Your company name is not set',
      'Settings, Company name. This is what we tell an AI engine the business is called. Without it we tell it nothing.',
    ));
  } else {
    findings.push(finding('site-name-ok', 'good', 'AI engines are told who you are'));
  }

  if (!settings.companyAbout.trim()) {
    findings.push(finding(
      'site-about-missing',
      'warning',
      'There is no description of the business',
      'Settings, About. One paragraph on what you do and who for. It goes to AI engines and to the writing assistant.',
    ));
  }

  /*
   * CONTACT DETAILS AS ONE FINDING, NOT THREE.
   *
   * The address, the phone number and the opening hours are three fields, one
   * panel and one job, and a new site that had them as three separate warnings
   * would open this report to six items, half of which say "go to Settings,
   * Contact details". That is the shape that teaches somebody to skim past the
   * warnings, which costs more than the extra detail buys.
   *
   * So it says what is missing in the title and where to go in the fix, and it
   * is one line whether one thing is missing or all three.
   */
  const missing: Array<{ words: string; plural: boolean }> = [];
  if (!hasPostalAddress(settings)) missing.push({ words: 'address', plural: false });
  if (!settings.telephone.trim()) missing.push({ words: 'phone number', plural: false });
  if (!hasOpeningHours(settings)) missing.push({ words: 'opening hours', plural: true });

  /*
   * The verb comes from the SUBJECT, not from the count, which is not the same
   * thing and reads wrong the moment it is. Two or more of anything takes "are";
   * one takes whatever that one is, and "opening hours" is already plural.
   */
  const verb = missing.length > 1 || missing[0]?.plural ? 'are' : 'is';

  if (missing.length === 3) {
    findings.push(finding(
      'contact-missing',
      'warning',
      'AI engines do not know where you are or how to reach you',
      'Settings, Contact details. An assistant asked to recommend somebody local will not name a business it cannot place. This is the single strongest thing you can add.',
    ));
  } else if (missing.length > 0) {
    findings.push(finding(
      'contact-partial',
      'warning',
      `Your ${listWords(missing.map((item) => item.words))} ${verb} not set`,
      'Settings, Contact details. The more of these an AI engine has, the more confident it is that this website is a real business in a real place.',
    ));
  } else {
    findings.push(finding(
      'contact-ok',
      'good',
      'AI engines know where you are, how to reach you and when you are open',
    ));
  }

  // Nullable in the schema, unlike the profile strings, so it needs the guard.
  if (!settings.socialImageUrl?.trim()) {
    findings.push(finding(
      'social-image-missing',
      'warning',
      'Shared links have no picture',
      'Settings, Sharing image. Without one, a link to your site posted anywhere is a bare line of text.',
    ));
  }

  if (pageCount === 0) {
    findings.push(finding(
      'no-pages',
      'problem',
      'Nothing has been published yet',
      'Publish a page. Until then there is nothing for a search engine to find.',
    ));
  }

  return findings;
}

/**
 * "address", "phone number and opening hours", "address, phone number and
 * opening hours".
 *
 * No Oxford comma, because this is customer-facing copy and the house style
 * does not use one.
 */
function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** How many of each, for a summary line. Counted here so every screen agrees. */
export function tally(findings: readonly Finding[]): Record<Severity, number> {
  return {
    problem: findings.filter((f) => f.severity === 'problem').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    good: findings.filter((f) => f.severity === 'good').length,
  };
}
