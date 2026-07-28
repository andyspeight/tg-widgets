'use strict';

/**
 * lib/score.js — combine the pillars, band the result, write the findings.
 *
 * Two rules govern everything here.
 *
 *   A pillar we could not honestly assess is EXCLUDED from the average. It is
 *   never counted as a zero. A tool that turns "we could not tell" into "you
 *   failed" is a tool a knowledgeable prospect can debunk.
 *
 *   Every non-pass carries a fix. A finding without a fix is just a complaint.
 *
 * All copy in this file is client-facing. UK English, no em dashes, no Oxford
 * commas, no filler.
 */

const PILLARS = [
  { id: 'access', label: 'AI crawler access', blurb: 'Whether the AI engines can reach your pages at all.' },
  { id: 'schema', label: 'Structured data', blurb: 'What your pages tell a machine about themselves.' },
  { id: 'content', label: 'Answer-ready content', blurb: 'Whether your writing can be lifted into an answer.' },
  { id: 'authority', label: 'Authority signals', blurb: 'The trust markers an engine looks for before it cites you.' },
];

const BANDS = [
  { min: 85, name: 'Strong' },
  { min: 70, name: 'Good' },
  { min: 50, name: 'Needs work' },
  { min: 30, name: 'At risk' },
  { min: 0, name: 'Invisible' },
];

/** @param {number} n @returns {string} */
function bandFor(n) {
  for (const band of BANDS) if (n >= band.min) return band.name;
  return 'Invisible';
}

/** Join a list the way a person would write it. No Oxford comma. */
function listOf(items) {
  const list = items.filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * Equal-weight average of the pillars we could actually assess.
 * @returns {{overall:number|null, band:string, scoredPillars:number, inconclusivePillars:string[]}}
 */
function combine(results) {
  const scored = [];
  const inconclusive = [];

  for (const pillar of PILLARS) {
    const result = results[pillar.id];
    if (!result || result.inconclusive || typeof result.score !== 'number') {
      inconclusive.push(pillar.id);
    } else {
      scored.push(result.score);
    }
  }

  if (scored.length === 0) {
    return { overall: null, band: 'Inconclusive', scoredPillars: 0, inconclusivePillars: inconclusive };
  }

  const overall = Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
  return {
    overall,
    band: bandFor(overall),
    scoredPillars: scored.length,
    inconclusivePillars: inconclusive,
  };
}

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

function accessFindings(access) {
  const out = [];
  if (!access) return out;

  if (access.inconclusive) {
    out.push({
      id: 'access-inconclusive',
      pillar: 'AI crawler access',
      severity: 'inconclusive',
      title: 'We could not test crawler access on this site',
      detail:
        access.reason ||
        'The site refused our browser check, so we cannot tell a crawler block from a block on everyone.',
      fix: 'This usually means a firewall or bot protection is turning away traffic from data centres. Ask us to run the check from a residential connection, or send us a screenshot of your Cloudflare bot settings and we will read them for you.',
    });
    return out;
  }

  const bots = access.bots || [];
  const robotsBlocked = bots.filter((b) => b.verdict.state === 'blocked' && b.verdict.source === 'robots');
  const edgeBlocked = bots.filter((b) => b.verdict.state === 'blocked' && b.verdict.source === 'edge');
  const warned = bots.filter((b) => b.verdict.state === 'warn');
  const unclear = bots.filter((b) => b.verdict.state === 'inconclusive');

  if (edgeBlocked.length) {
    out.push({
      id: 'access-edge-block',
      pillar: 'AI crawler access',
      severity: 'critical',
      title: `${listOf(edgeBlocked.map((b) => b.label))} cannot reach your site`,
      detail:
        `Your site served our browser check normally but turned these crawlers away at network level. ` +
        `That is the signature of bot protection, and Cloudflare Bot Fight Mode is the usual cause because it is on by default for new domains. ` +
        `Nothing else on this page matters while this is true, because the engines never see your content.`,
      fix: 'In Cloudflare, go to Security then Bots and turn off Bot Fight Mode, then add a WAF rule that allows the AI search crawlers by user agent. If you are not on Cloudflare, ask your host which bot filter is running. We can do this for you.',
    });
  }

  if (robotsBlocked.length) {
    out.push({
      id: 'access-robots-block',
      pillar: 'AI crawler access',
      severity: 'critical',
      title: `Your robots.txt tells ${listOf(robotsBlocked.map((b) => b.label))} to stay away`,
      detail:
        `We found ${listOf(Array.from(new Set(robotsBlocked.map((b) => `${b.token} (${b.verdict.detail.replace(/^robots\.txt says /, '')})`))))} in your robots.txt. ` +
        `The engines honour this, so they will not read your pages.`,
      fix: 'Edit robots.txt and remove the Disallow lines for the AI search crawlers. Keep any blocks on training-only bots if you want them, but let the retrieval bots through, because those are the ones that produce citations.',
    });
  }

  if (warned.length) {
    out.push({
      id: 'access-warn',
      pillar: 'AI crawler access',
      severity: 'medium',
      title: `${listOf(warned.map((b) => b.label))} had trouble reaching you`,
      detail: `These crawlers got through eventually or not at all. ${listOf(Array.from(new Set(warned.map((b) => b.verdict.detail))))}`,
      fix: 'Intermittent answers usually mean rate limiting or a slow origin. Check your rate limit rules are not counting crawlers as attackers, and look at server response times on the home page.',
    });
  }

  if (unclear.length) {
    out.push({
      id: 'access-unclear',
      pillar: 'AI crawler access',
      severity: 'low',
      title: `We could not get a clear answer for ${listOf(unclear.map((b) => b.label))}`,
      detail: 'These probes did not give us a result we would stand behind, so we have left them out of the score rather than guess.',
      fix: 'Nothing to do yet. Run the check again in a few minutes, and if it keeps coming back unclear send us the URL and we will look at it by hand.',
    });
  }

  if (!edgeBlocked.length && !robotsBlocked.length && !warned.length && !unclear.length) {
    out.push({
      id: 'access-clean',
      pillar: 'AI crawler access',
      severity: 'good',
      title: 'All six AI crawlers reached your site',
      detail:
        'Every crawler we test was served your home page normally and your robots.txt lets them in. ' +
        'This is a pass rather than a promise, because bot protection can also fingerprint a request beyond its user agent.',
      fix: 'Keep it that way. If you ever turn on new bot protection, run this check again before you assume nothing changed.',
    });
  }

  if (access.robots && access.robots.unknown) {
    out.push({
      id: 'access-robots-unknown',
      pillar: 'AI crawler access',
      severity: 'low',
      title: 'We could not read your robots.txt',
      detail: 'The file did not load, so we judged crawler access on the live probes alone.',
      fix: 'Check that yoursite.com/robots.txt loads in a browser and returns plain text. If it errors, the engines are guessing too.',
    });
  } else if (access.robots && !access.robots.found) {
    out.push({
      id: 'access-robots-missing',
      pillar: 'AI crawler access',
      severity: 'low',
      title: 'You have no robots.txt',
      detail: 'That is not a problem in itself, because no file means no restrictions, but it does mean you have no way to point crawlers at your sitemap.',
      fix: 'Add a simple robots.txt that allows everything and lists your sitemap. One line for the sitemap is enough to help the engines find the rest of your pages.',
    });
  } else if (access.robots && access.robots.found && (!access.robots.sitemaps || access.robots.sitemaps.length === 0)) {
    out.push({
      id: 'access-no-sitemap',
      pillar: 'AI crawler access',
      severity: 'low',
      title: 'Your robots.txt does not point to a sitemap',
      detail: 'Crawlers use the sitemap line to find pages they would otherwise have to guess at.',
      fix: 'Add a Sitemap line to robots.txt pointing at your sitemap.xml. It takes a minute and it helps every engine, not just the AI ones.',
    });
  }

  return out;
}

function schemaFindings(schema) {
  const out = [];
  if (!schema) return out;

  if (schema.inconclusive) {
    out.push({
      id: 'schema-inconclusive',
      pillar: 'Structured data',
      severity: 'inconclusive',
      title: 'We could not read your page markup',
      detail: 'The home page did not come back in a form we could parse, so we have left this pillar out of the score.',
      fix: 'Check the home page loads for a plain HTTP request with no JavaScript. If it needs a browser to render, the AI crawlers will struggle too.',
    });
    return out;
  }

  const types = schema.types || [];
  const hasOrg = types.some((t) => ['Organization', 'LocalBusiness', 'TravelAgency', 'Corporation', 'ProfessionalService', 'Store'].includes(t));

  if (schema.blocks === 0 && schema.microdata === 0) {
    out.push({
      id: 'schema-none',
      pillar: 'Structured data',
      severity: 'high',
      title: 'Your pages carry no structured data',
      detail:
        'There is no JSON-LD and no microdata on the home page. Structured data is how a page states plainly what it is, who runs it and what it sells. ' +
        'Without it an engine has to infer everything from the prose, and it often gets it wrong.',
      fix: 'Add JSON-LD to the home page describing your business as a TravelAgency, with your name, phone number, address and opening hours. It is one script tag and it is the single highest-value markup change you can make.',
    });
    return out;
  }

  if (schema.invalid > 0) {
    out.push({
      id: 'schema-invalid',
      pillar: 'Structured data',
      severity: 'high',
      title: `${schema.invalid === 1 ? 'One of your' : `${schema.invalid} of your`} structured data blocks will not parse`,
      detail: 'A block of JSON-LD on the page is not valid JSON, so engines throw it away rather than reading round the error.',
      fix: 'Run the page through the Schema.org validator and fix the broken block. Nine times out of ten it is a stray comma or an unescaped quote in a business name.',
    });
  }

  if (!hasOrg) {
    out.push({
      id: 'schema-no-org',
      pillar: 'Structured data',
      severity: 'high',
      title: 'Nothing on the page says who you are',
      detail: 'There is structured data, but none of it identifies the business. Engines use the organisation block to connect your site to your name, your reviews and your contact details.',
      fix: 'Add an Organization or TravelAgency block with your legal name, logo, telephone, address and sameAs links to your social profiles.',
    });
  }

  if (!types.includes('FAQPage') && !types.includes('Question')) {
    out.push({
      id: 'schema-no-faq',
      pillar: 'Structured data',
      severity: 'medium',
      title: 'You have no FAQ markup',
      detail: 'FAQ markup is the most direct way to hand an engine a question and the answer you want quoted alongside it.',
      fix: 'Pick the ten questions your customers actually ask, write short honest answers and mark them up as an FAQPage. Put them on the pages where those questions come up.',
    });
  }

  if (!types.includes('BreadcrumbList')) {
    out.push({
      id: 'schema-no-breadcrumb',
      pillar: 'Structured data',
      severity: 'low',
      title: 'No breadcrumb markup',
      detail: 'Breadcrumbs tell an engine where a page sits in your site, which helps it judge how specific the page is.',
      fix: 'Add BreadcrumbList markup to your destination and offer pages. Most site builders can do this from a setting.',
    });
  }

  return out;
}

function contentFindings(content) {
  const out = [];
  if (!content) return out;
  const s = content.signals || {};

  if (content.inconclusive) {
    out.push({
      id: 'content-inconclusive',
      pillar: 'Answer-ready content',
      severity: 'inconclusive',
      title: 'There is not enough text here for us to judge',
      detail: content.reason || 'There is too little text on the home page to judge fairly, so we have left this pillar out of the score rather than mark you down for it.',
      fix: s.likelyClientRendered
        ? 'Your home page arrives nearly empty and fills in with JavaScript. Most AI crawlers do not run JavaScript, so they see the empty version. Ask your developer to server-render the main content, or add a static version of the key copy to the initial HTML.'
        : 'Add real content to the home page. Three or four hundred words that answer the questions a customer would ask is enough to be worth reading.',
    });
    return out;
  }

  if (s.likelyClientRendered) {
    out.push({
      id: 'content-client-rendered',
      pillar: 'Answer-ready content',
      severity: 'high',
      title: 'Your content arrives after the page does',
      detail: 'The page comes back nearly empty and fills in with JavaScript. Most AI crawlers do not run JavaScript, so they see the empty version.',
      fix: 'Server-render the main content, or output a static copy of the key text in the initial HTML. Your developer will know which applies.',
    });
  }

  if (!s.title) {
    out.push({
      id: 'content-no-title',
      pillar: 'Answer-ready content',
      severity: 'high',
      title: 'The home page has no title',
      detail: 'The title is the first thing an engine reads and often the line it quotes back.',
      fix: 'Write a title of roughly 50 to 60 characters that says who you are and what you sell. Put the useful words first.',
    });
  } else if (s.titleLength > 70 || s.titleLength < 15) {
    out.push({
      id: 'content-title-length',
      pillar: 'Answer-ready content',
      severity: 'low',
      title: s.titleLength < 15 ? 'Your page title is very short' : 'Your page title is very long',
      detail: `The title is ${s.titleLength} characters. Titles that sit around 50 to 60 characters get quoted whole.`,
      fix: 'Rewrite the title to roughly 50 to 60 characters, leading with what you actually offer rather than the company name.',
    });
  }

  if (!s.description) {
    out.push({
      id: 'content-no-description',
      pillar: 'Answer-ready content',
      severity: 'medium',
      title: 'No meta description',
      detail: 'The description is a free summary of the page in your own words. Without one the engine writes its own, and it may pick the wrong sentence.',
      fix: 'Add a meta description of 120 to 155 characters to every important page. Say what the page covers, plainly.',
    });
  }

  if (s.h1Count === 0) {
    out.push({
      id: 'content-no-h1',
      pillar: 'Answer-ready content',
      severity: 'medium',
      title: 'The page has no main heading',
      detail: 'Without an h1 there is nothing telling a machine what the page is chiefly about.',
      fix: 'Add one h1 to the page that states the subject in plain words.',
    });
  } else if (s.h1Count > 1) {
    out.push({
      id: 'content-many-h1',
      pillar: 'Answer-ready content',
      severity: 'low',
      title: `The page has ${s.h1Count} main headings`,
      detail: 'More than one h1 blurs what the page is about.',
      fix: 'Keep one h1 and demote the rest to h2. It is usually a theme setting rather than a content change.',
    });
  }

  if ((s.questionHeadings || 0) < 2) {
    out.push({
      id: 'content-no-questions',
      pillar: 'Answer-ready content',
      severity: 'medium',
      title: 'Your headings are not shaped like questions',
      detail: 'People ask AI engines questions. Pages whose headings match those questions get quoted, because the answer sits directly underneath.',
      fix: 'Rewrite a few section headings as the questions customers actually ask, then answer each one in the first two sentences below it.',
    });
  }

  if ((s.words || 0) < 300) {
    out.push({
      id: 'content-thin',
      pillar: 'Answer-ready content',
      severity: 'medium',
      title: 'The home page is thin',
      detail: `We counted about ${s.words} words. There is not much for an engine to work with.`,
      fix: 'Add a few hundred words that answer real customer questions. Specific beats general, so name the destinations, the seasons and the prices.',
    });
  }

  if (!s.lists) {
    out.push({
      id: 'content-no-lists',
      pillar: 'Answer-ready content',
      severity: 'low',
      title: 'No lists on the page',
      detail: 'Lists are the easiest thing for an engine to lift into an answer.',
      fix: 'Where you have three or more of anything, set it as a bulleted list rather than a paragraph.',
    });
  }

  if (out.length === 0) {
    out.push({
      id: 'content-good',
      pillar: 'Answer-ready content',
      severity: 'good',
      title: 'Your content is in good shape for AI answers',
      detail: 'The page has a clear title, a single main heading, question-shaped sections and enough substance to quote.',
      fix: 'Keep going. The same treatment on your destination and offer pages is where the next gain is.',
    });
  }

  return out;
}

function authorityFindings(authority) {
  const out = [];
  if (!authority) return out;

  if (authority.inconclusive) {
    out.push({
      id: 'authority-inconclusive',
      pillar: 'Authority signals',
      severity: 'inconclusive',
      title: 'We could not read your trust signals',
      detail: 'The page did not load in a form we could read, so this pillar is out of the score.',
      fix: 'Check the home page returns HTML to a plain request. If it does not, no engine can read your trust signals either.',
    });
    return out;
  }

  const s = authority.signals || {};

  if (!s.tradeBodies || s.tradeBodies.length === 0) {
    out.push({
      id: 'authority-no-trade',
      pillar: 'Authority signals',
      severity: 'high',
      title: 'No ABTA or ATOL wording on the page',
      detail: 'For a travel business these are the strongest trust markers there are, and an engine looks for them in the text before it recommends you.',
      fix: 'If you hold ABTA, ATOL, IATA or AITO membership, say so in text on the home page and the footer, with the number. An image of the logo alone is invisible to a crawler.',
    });
  }

  if (!s.phone || !s.address) {
    out.push({
      id: 'authority-no-contact',
      pillar: 'Authority signals',
      severity: 'high',
      title: 'Your contact details are hard to find',
      detail: `We could not find ${listOf([!s.phone ? 'a phone number' : null, !s.address ? 'a postal address' : null])} in the page text.`,
      fix: 'Put a phone number and a full postal address in the footer as real text, not inside an image. Add the same details to your Organization markup.',
    });
  }

  if (!s.reviewPlatform && !s.rating) {
    out.push({
      id: 'authority-no-reviews',
      pillar: 'Authority signals',
      severity: 'medium',
      title: 'No reviews an engine can see',
      detail: 'There is no link to a review platform and no rating in your markup. Engines lean on reviews when they choose who to name.',
      fix: 'Link to your Trustpilot, Feefo or Google reviews from the home page, and add aggregateRating to your markup so the score is machine readable.',
    });
  }

  if (!s.registration) {
    out.push({
      id: 'authority-no-registration',
      pillar: 'Authority signals',
      severity: 'low',
      title: 'No company registration details',
      detail: 'A company number and registered address tell an engine you are a real trading business.',
      fix: 'Add your company number and registered office to the footer. It is a legal requirement for a UK limited company anyway.',
    });
  }

  if (!s.about) {
    out.push({
      id: 'authority-no-about',
      pillar: 'Authority signals',
      severity: 'low',
      title: 'No about page linked from the home page',
      detail: 'Engines use an about page to work out who is behind the advice.',
      fix: 'Link to an about page from the main navigation, and name the people on it.',
    });
  }

  if (!s.social) {
    out.push({
      id: 'authority-no-social',
      pillar: 'Authority signals',
      severity: 'low',
      title: 'No social profiles linked',
      detail: 'Links to your own profiles help an engine confirm that the business it is reading about is the one it already knows.',
      fix: 'Link your Facebook, Instagram and LinkedIn profiles from the footer, and list the same URLs under sameAs in your markup.',
    });
  }

  if (out.length === 0) {
    out.push({
      id: 'authority-good',
      pillar: 'Authority signals',
      severity: 'good',
      title: 'Your trust signals are all present',
      detail: 'Contact details, trade body wording, reviews and company details are all on the page where an engine can read them.',
      fix: 'Keep them current. If your ABTA or ATOL number changes, update the text and the markup together.',
    });
  }

  return out;
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, inconclusive: 4, good: 5 };

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

const CAVEAT =
  'A clean result here is a good sign, not a guarantee. Bot protection can fingerprint a visitor well beyond its user agent, ' +
  'so a crawler can still be turned away for reasons this check cannot see from the outside. We report what we can prove and nothing more.';

const PRESENCE_BLURB =
  'This is the part that tells you whether the engines actually name you when a customer asks. ' +
  'We do not show a number here, because guessing one would be worthless. It comes from putting real customer questions to the engines every month and counting who gets mentioned.';

function summaryLine(overall, band, access) {
  if (overall === null) {
    return 'We could not get a result we would stand behind on this site, so we are not going to invent one. The detail below explains what stopped us.';
  }
  const edgeBlocked = access && !access.inconclusive && (access.bots || []).some((b) => b.verdict.state === 'blocked' && b.verdict.source === 'edge');
  if (edgeBlocked) {
    return `Your site scores ${overall} out of 100, and the urgent part is the crawler block. Some AI engines are being turned away before they ever see your content, so everything else is waiting on that.`;
  }
  if (band === 'Strong') {
    return `Your site scores ${overall} out of 100. The engines can reach you and they can understand you. The gains left are small ones.`;
  }
  if (band === 'Good') {
    return `Your site scores ${overall} out of 100. Nothing is badly broken, and a handful of changes would put you well ahead of most travel sites.`;
  }
  if (band === 'Needs work') {
    return `Your site scores ${overall} out of 100. The engines can reach you, but they are having to work harder than they should to understand what you sell.`;
  }
  if (band === 'At risk') {
    return `Your site scores ${overall} out of 100. An AI engine reading your site today would struggle to say much about you with any confidence.`;
  }
  return `Your site scores ${overall} out of 100. As things stand there is very little here for an AI engine to work with.`;
}

/**
 * Build the whole client-facing report.
 * @returns {{overall:number|null, band:string, pillars:object[], findings:object[], summary:string, caveat:string, presence:object}}
 */
function buildReport({ url, accessResult, schemaResult, contentResult, authorityResult }) {
  const combined = combine({
    access: accessResult,
    schema: schemaResult,
    content: contentResult,
    authority: authorityResult,
  });

  const byId = {
    access: accessResult,
    schema: schemaResult,
    content: contentResult,
    authority: authorityResult,
  };

  const pillars = PILLARS.map((p) => {
    const r = byId[p.id] || {};
    return {
      id: p.id,
      label: p.label,
      blurb: p.blurb,
      score: r.inconclusive ? null : typeof r.score === 'number' ? r.score : null,
      inconclusive: Boolean(r.inconclusive) || typeof r.score !== 'number',
      band: r.inconclusive || typeof r.score !== 'number' ? 'Inconclusive' : bandFor(r.score),
    };
  });

  const findings = []
    .concat(accessFindings(accessResult))
    .concat(schemaFindings(schemaResult))
    .concat(contentFindings(contentResult))
    .concat(authorityFindings(authorityResult))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    url: url || null,
    overall: combined.overall,
    band: combined.band,
    scoredPillars: combined.scoredPillars,
    inconclusivePillars: combined.inconclusivePillars,
    pillars,
    findings,
    summary: summaryLine(combined.overall, combined.band, accessResult),
    caveat: CAVEAT,
    crawlers: accessResult && accessResult.bots
      ? accessResult.bots.map((b) => ({
          id: b.id,
          label: b.label,
          engine: b.engine,
          token: b.token,
          state: b.verdict.state,
          source: b.verdict.source,
          detail: b.verdict.detail,
          robotsOnly: b.robotsOnly,
        }))
      : [],
    presence: {
      locked: true,
      result: null,
      title: 'Live AI presence and share of model',
      blurb: PRESENCE_BLURB,
      cta: 'Part of the paid layer',
    },
  };
}

module.exports = {
  PILLARS,
  BANDS,
  bandFor,
  combine,
  buildReport,
  listOf,
  CAVEAT,
};
