/**
 * Who is reading a page: a person, a person sent by an AI assistant, a named
 * crawler, or some other robot.
 *
 * The first slice of the Duda visibility upgrade (docs/duda-visibility-review.md,
 * 15 Sep 2026). Duda's headline finding is that AI crawler visits predict AI
 * recommendations; we allow every crawler in (lib/seo/robots.ts) and could not
 * say whether one had ever come. This sorts one request into one of four kinds
 * from two headers, and nothing else: no IP, no cookie, no fingerprint. It is a
 * tally of pages read, never a record of people.
 *
 * PURE, like lib/seo/audit.ts and lib/forms/submit.ts: strings in, a kind and a
 * source out, so every line here is tested without a request in sight.
 *
 * THE NAMES ARE THE ONES robots.txt ALREADY NAMES, plus the search crawlers and
 * the "asked by a person" fetchers. The label is what a client reads on the
 * dashboard, so it says the product a person would recognise (ChatGPT,
 * Perplexity, Google) rather than the token in the header. Two crawlers that
 * belong to one product share a label, because "how often does ChatGPT read my
 * site" is the question, not "which of OpenAI's three crawlers".
 */

export type VisitKind = 'visitor' | 'ai' | 'crawler' | 'bot';

export interface VisitClass {
  kind: VisitKind;
  /** The crawler's name or the assistant a visitor came from; '' otherwise. */
  source: string;
}

export type CrawlerFamily = 'ai' | 'search';

export interface CrawlerEntry {
  /** Lower-case token looked for in the user agent. */
  token: string;
  /** What the dashboard calls it. */
  label: string;
  family: CrawlerFamily;
}

/**
 * Only names that appear in a real user agent. Google-Extended, Applebot-
 * Extended, anthropic-ai and cohere-ai are robots.txt names with no fetcher of
 * their own: Google's AI reads through Googlebot and Apple's through Applebot,
 * so those visits count as search, which is what they are. Order matters where
 * one token contains another.
 */
export const CRAWLERS: readonly CrawlerEntry[] = [
  { token: 'oai-searchbot', label: 'ChatGPT', family: 'ai' },
  { token: 'chatgpt-user', label: 'ChatGPT', family: 'ai' },
  { token: 'gptbot', label: 'ChatGPT', family: 'ai' },
  { token: 'perplexitybot', label: 'Perplexity', family: 'ai' },
  { token: 'perplexity-user', label: 'Perplexity', family: 'ai' },
  { token: 'claude-searchbot', label: 'Claude', family: 'ai' },
  { token: 'claude-user', label: 'Claude', family: 'ai' },
  { token: 'claudebot', label: 'Claude', family: 'ai' },
  { token: 'meta-externalagent', label: 'Meta AI', family: 'ai' },
  { token: 'meta-externalfetcher', label: 'Meta AI', family: 'ai' },
  { token: 'facebookbot', label: 'Meta AI', family: 'ai' },
  { token: 'amazonbot', label: 'Amazon Alexa', family: 'ai' },
  { token: 'bytespider', label: 'ByteDance', family: 'ai' },
  { token: 'ccbot', label: 'Common Crawl', family: 'ai' },
  { token: 'mistralai-user', label: 'Mistral', family: 'ai' },
  { token: 'youbot', label: 'You.com', family: 'ai' },
  { token: 'duckassistbot', label: 'DuckDuckGo AI', family: 'ai' },
  { token: 'googlebot', label: 'Google', family: 'search' },
  { token: 'bingbot', label: 'Bing', family: 'search' },
  { token: 'applebot', label: 'Apple', family: 'search' },
  { token: 'duckduckbot', label: 'DuckDuckGo', family: 'search' },
  { token: 'yandexbot', label: 'Yandex', family: 'search' },
  { token: 'baiduspider', label: 'Baidu', family: 'search' },
];

/**
 * The AI engines the dashboard asks "has this one found you yet" about: every
 * AI crawler label above, once, best known first. Derived from the table so a
 * crawler added there joins the roster on its own.
 */
export const AI_ENGINES: readonly string[] = CRAWLERS.filter((entry) => entry.family === 'ai')
  .map((entry) => entry.label)
  .filter((label, index, all) => all.indexOf(label) === index);

/** The family a dashboard label belongs to, so the chart can group them. */
export function crawlerFamily(label: string): CrawlerFamily | null {
  const hit = CRAWLERS.find((entry) => entry.label === label);
  return hit ? hit.family : null;
}

/**
 * Anything else that is plainly not a person: monitors, link previews, scripts
 * and headless browsers. Counted as `bot` so it stays out of the visitor number,
 * and never named, because a list of every scraper on earth is not a chart.
 */
const OTHER_BOT =
  /bot\b|bot\/|crawl|spider|slurp|curl\/|wget|python-requests|python-urllib|aiohttp|httpclient|headlesschrome|lighthouse|pingdom|uptimerobot|statuscake|monitor|scrapy|go-http-client|java\/|libwww|axios\/|node-fetch|okhttp|facebookexternalhit|linkedinbot|twitterbot|slackbot|discordbot|whatsapp|telegrambot|embedly|quora link preview|vercel-screenshot/i;

/**
 * The assistants a person can arrive from. A referer is only ever the host, so
 * this is the host of the assistant's own site; Google's AI answers arrive as a
 * plain google.com referer and cannot be told from ordinary search, which is why
 * Google is not in this list.
 */
export const AI_REFERRERS: ReadonlyArray<{ host: string; label: string }> = [
  { host: 'chatgpt.com', label: 'ChatGPT' },
  { host: 'chat.openai.com', label: 'ChatGPT' },
  { host: 'perplexity.ai', label: 'Perplexity' },
  { host: 'gemini.google.com', label: 'Gemini' },
  { host: 'bard.google.com', label: 'Gemini' },
  { host: 'copilot.microsoft.com', label: 'Copilot' },
  { host: 'claude.ai', label: 'Claude' },
  { host: 'you.com', label: 'You.com' },
  { host: 'duck.ai', label: 'DuckDuckGo AI' },
];

/** The assistant a referer names, or null. Subdomains count; look-alikes do not. */
export function aiReferrer(referer: string | null | undefined): string | null {
  if (!referer) return null;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const entry of AI_REFERRERS) {
    if (host === entry.host || host.endsWith(`.${entry.host}`)) return entry.label;
  }
  return null;
}

/** The named crawler a user agent belongs to, or null. */
export function namedCrawler(userAgent: string | null | undefined): CrawlerEntry | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  for (const entry of CRAWLERS) {
    if (ua.includes(entry.token)) return entry;
  }
  return null;
}

/**
 * Sort one request. A named crawler first, whatever its referer; then any other
 * robot; then a person from an assistant; then a person. An absent user agent
 * is a robot: every browser sends one.
 */
export function classifyVisit(input: {
  userAgent: string | null | undefined;
  referer: string | null | undefined;
}): VisitClass {
  const crawler = namedCrawler(input.userAgent);
  if (crawler) return { kind: 'crawler', source: crawler.label };
  if (!input.userAgent || OTHER_BOT.test(input.userAgent)) return { kind: 'bot', source: '' };
  const assistant = aiReferrer(input.referer);
  if (assistant) return { kind: 'ai', source: assistant };
  return { kind: 'visitor', source: '' };
}

/**
 * The path as the table keys it: a leading slash, no query or fragment, no
 * trailing slash but the root's own, and capped so a hostile address cannot
 * grow a row. Empty means the home page.
 */
export function cleanVisitPath(path: string | null | undefined): string {
  const raw = (path ?? '').split(/[?#]/)[0].trim();
  const segments = raw.split('/').filter(Boolean);
  const joined = `/${segments.join('/')}`;
  return joined.length > 400 ? joined.slice(0, 400) : joined;
}
