/**
 * What a client's robots.txt says.
 *
 * WHAT THIS FIXES, and it is a defect rather than a feature. Until 1 Aug 2026 a
 * site on this platform had NO robots.txt at all: /robots.txt is not in
 * isPlatformPath, so middleware.ts rewrote it to /site/<host>/robots.txt, the
 * page renderer went looking for a page whose slug was "robots.txt", and the
 * request 404d. Meanwhile app/robots.ts, which is the one the platform's own
 * hostname serves, said `disallow: /` for everything. So every client site was
 * either silent or actively telling crawlers to go away.
 *
 * EVERYTHING IS ALLOWED, decided by Andy on 1 Aug 2026, and the distinction the
 * decision turns on is worth writing down because it is not obvious.
 *
 * There are three kinds of AI crawler and they do different jobs:
 *
 *   TRAINING crawlers (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended,
 *   CCBot, Meta-ExternalAgent) feed the model's long-term knowledge. Blocking
 *   these is the fashionable choice and it is the wrong one for a travel agency:
 *   being part of what an assistant knows about holidays in Crete is an asset,
 *   not a cost.
 *
 *   SEARCH-TIME bots (OAI-SearchBot, PerplexityBot, Amazonbot) build the index
 *   an assistant queries mid-conversation. THESE ARE THE ONES THAT PRODUCE
 *   CITATIONS. Blocking them is what actually costs a client business, and it is
 *   the mistake somebody makes by pasting in a block-all-AI robots.txt.
 *
 *   USER-TRIGGERED fetchers (ChatGPT-User, Perplexity-User) run when a person
 *   asks an assistant about a specific page. Refusing these is refusing a
 *   visitor who is already interested.
 *
 * SO WHY NAME THEM AT ALL, when `User-agent: *` with no Disallow already allows
 * everything? Because a named group is a statement of intent that survives
 * somebody later adding a rule to the wildcard group, and because these are the
 * agents a client's own SEO consultant will look for. A robots.txt that mentions
 * OAI-SearchBot by name is one somebody can check.
 *
 * NOTHING HERE IS A CLIENT SETTING. A robots.txt is the single easiest file on a
 * website to get catastrophically wrong, and "why has my site disappeared from
 * Google" is not a support call worth the flexibility.
 */

/**
 * The agents named explicitly, and what each one is for.
 *
 * Kept as data with a purpose on each so that the next person to touch this can
 * tell a citation engine from a training crawler without going and looking it
 * up, which is the thing that leads to blocking the wrong half.
 */
export const AI_AGENTS: ReadonlyArray<{ name: string; purpose: string }> = [
  // The ones that produce citations. Never block these.
  { name: 'OAI-SearchBot', purpose: 'ChatGPT search index' },
  { name: 'ChatGPT-User', purpose: 'ChatGPT fetching a page for someone' },
  { name: 'PerplexityBot', purpose: 'Perplexity search index' },
  { name: 'Perplexity-User', purpose: 'Perplexity fetching a page for someone' },
  { name: 'Claude-SearchBot', purpose: 'Claude search index' },
  { name: 'Claude-User', purpose: 'Claude fetching a page for someone' },
  { name: 'Amazonbot', purpose: 'Alexa and Amazon answers' },
  // Training. Allowed on purpose: see the note at the top.
  { name: 'GPTBot', purpose: 'OpenAI training' },
  { name: 'ClaudeBot', purpose: 'Anthropic training' },
  { name: 'Google-Extended', purpose: 'Gemini training and grounding' },
  { name: 'Applebot-Extended', purpose: 'Apple Intelligence training' },
  { name: 'Meta-ExternalAgent', purpose: 'Meta AI training' },
  { name: 'CCBot', purpose: 'Common Crawl, which many models are built from' },
];

/**
 * Paths no crawler should spend its time on.
 *
 * SHORT ON PURPOSE. Every line here is a line that can go wrong, and a crawler
 * wasting a request on /api/ costs a client nothing. These two are worth it:
 * /api/ is machine-only and would return JSON to an indexer, and /site/ is the
 * internal render prefix which serves a client's own content back at a second
 * address. That second one is a genuine duplicate-content problem, and the
 * middleware already sets x-robots-tag on it; this says the same thing in the
 * place a crawler looks first.
 */
const DISALLOW = ['/api/', '/site/'];

/**
 * The robots.txt for one published site.
 *
 * `origin` is the site's own scheme and host, so the Sitemap line is absolute,
 * which the spec requires and which several crawlers enforce.
 */
export function robotsTxt(origin: string): string {
  const lines: string[] = [
    '# Travelgenix Sites',
    '# Every crawler is welcome, including the AI ones. See lib/seo/robots.ts.',
    '',
    'User-agent: *',
    ...DISALLOW.map((path) => `Disallow: ${path}`),
    '',
  ];

  for (const agent of AI_AGENTS) {
    lines.push(`# ${agent.purpose}`, `User-agent: ${agent.name}`, 'Allow: /', '');
  }

  lines.push(`Sitemap: ${origin}/sitemap.xml`, '');

  /*
   * A POINTER TO llms.txt, AS A COMMENT, because that is all it can be.
   *
   * There is no registered robots.txt directive for it, and inventing one would
   * mean writing a line every crawler is entitled to ignore or complain about.
   * A comment is read by the two audiences that matter: a person auditing the
   * file, and an assistant that has fetched robots.txt and is deciding what else
   * to ask for. See lib/seo/llms.ts.
   */
  lines.push(`# Plain-language site summary for assistants: ${origin}/llms.txt`, '');

  return lines.join('\n');
}

/**
 * The robots.txt for the platform's OWN hostname, which is the opposite answer.
 *
 * tg-sites.vercel.app and travelgenixsites.com serve the dashboard, the editor
 * and every client's site at a second address. None of that should ever be
 * indexed: the dashboard is behind a login and would only ever surface as a sign
 * in page, and the client content at /site/ is a duplicate of the real thing on
 * the client's own domain, which harms THEIR ranking rather than ours.
 */
export function platformRobotsTxt(): string {
  return [
    '# The Travelgenix Sites platform itself.',
    '# Client websites live on their own hostnames and have their own robots.txt,',
    '# which allows everything. This one is the dashboard and the editor.',
    '',
    'User-agent: *',
    'Disallow: /',
    '',
  ].join('\n');
}
