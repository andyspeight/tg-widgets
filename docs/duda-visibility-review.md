# Duda's AI visibility tool, and what ours should become

**Written 15 Sep 2026. Andy: "review the Duda website and in particular their
visibility tool for AI and SEO, the reporting they offer and how it all works,
the display, and then we need to upgrade our version."** Companion to
`duda-gap-analysis.md` (23 Aug, the platform comparison) and
`tg-sites-speed-and-visibility.md` (23 Aug, the performance and plumbing
analysis). This one is narrower and later: it compares one Duda product, AI
Visibility, with our Search and AI visibility screen, and ends with the build
order for closing the gap.

**Basis, before anything else.** duda.co, support.duda.co and every third-party
review site are blocked by the session's network egress, the same as on 23 Aug.
Everything below about Duda comes from web-search snippets of their own pages
(`duda.co/ai-visibility`, `duda.co/aeo`, their product updates and their 2026
AEO report) and from press coverage of that report (TechRadar, Search Engine
Journal, EIN Presswire). Treat feature wording as accurate (it is Duda's own
copy) and treat pricing, the list of engines tracked and the refresh cadence as
indicative until somebody reads the live page. Our side is read from the code on
`main` at commit `9ee23b35`.

---

## The short version

Duda measures OUTPUTS: does ChatGPT, or Google's AI answer, mention this
business when somebody asks the questions its customers ask, how often, in what
tone, compared with which competitors, and are the AI crawlers even visiting.
Then it sells the number back to the client every month in a white-labelled
report, and to prospects as an audit.

We measure INPUTS: is every page shaped so that an assistant CAN cite it. Title,
description, alt text, thin content, FAQ pairs, the company profile, the contact
facts; robots.txt that lets every AI crawler in, llms.txt written for it, ten
kinds of structured data, a sitemap with the collections in it. That plumbing is
genuinely better than Duda's, and the 23 Aug analysis said so. But nothing on our
screen can answer the only question a client actually asks: **"does the AI
recommend me?"** Our score is a percentage of checks passed, computed fresh on
every visit, with no history, no crawler data, no traffic, no competitors and no
monthly report anyone receives.

So the upgrade is not a redesign of the screen. It is five things underneath it,
in this order: **log who reads the site** (AI crawlers, and visitors that arrive
FROM an AI assistant), **ask the assistants ourselves** on a monthly clock with a
prompt set per client, **keep history** so a trend exists, **send the monthly
report** the client never has to look for, and **turn a miss into a page** with
the AI writer we already have. The first is a day and needs no keys. The second
is the headline feature and needs the keys Andy already holds plus one new one.

---

## What Duda sells, as far as it can be read from outside

### The product

**AI Visibility**, an add-on to a Duda account, "starting at $19 per month for one
domain, with higher-tier plans unlocking additional domains", custom plans
negotiable. Positioned for agencies: "measure AI search performance, identify
optimization gaps, apply AI-powered fixes, and scale visibility across all of
your clients' sites." Two uses Duda names outright: "audit prospect sites for
data-driven outbounding" and "offer AI visibility as an add-on for existing
customers". That second one is the business model: the agency resells the
number.

### What it measures

| Piece | Duda's own words | What it is, read plainly |
|---|---|---|
| **AI Visibility Score** | "Monitor performance at a glance with Duda's composite AI visibility Score." Calculated "by dividing the number of responses mentioning your measured brand against the total number of responses in general, then multiplying that number by 100." | Ask a set of prompts, count the answers that name the brand, express it as a percentage. A share of voice, not a health check. |
| **Prompts** | "Review exactly how LLMs respond to the specific prompts your clients care about the most." | A prompt list per site, with the actual AI answer shown against each. The part a client can read and believe. |
| **LLM mentions and sentiment** | "Discover how often LLMs are mentioning your clients' sites, and what they're saying." "Determine how LLMs perceive your clients' brands and what opinions drive that narrative." Sentiment "on a scale from 0 to 100". | Mention count over time and a tone score. |
| **Competitors** | "Compare your clients' visibility, sentiment, and mentions against their top competitors." | The same prompts, the same count, for named rivals. |
| **Crawler tracking** | "Analyze how often crawlers are visiting your clients' sites, and which platforms are visiting most often." Duda's own finding: "the number of times a crawler visits a website is a strong indicator of how often that site's brand is recommended by the associated LLM." | Server logs filtered to GPTBot, PerplexityBot and friends, by bot, over time. |
| **Recommendations** | "Personalized recommendations unique to your clients' sites that can be implemented in just a click." Plus AI blog generation, "boost visibility by as much as 33X". | Audit findings with an apply button, and a content generator sold on the crawler correlation. |
| **Reporting** | "Prove ROI with automated monthly AI visibility reporting, completely white-labeled with your own branding." "Track traffic, AI Visibility, and search performance from one dashboard", with "direct integration with Google's Search Console". | A monthly client report, sent, in the agency's name, with traffic and Search Console beside the AI numbers. |

**Engines tracked.** Duda's copy names "ChatGPT and Google's AI Overviews". The
full list (Gemini, Perplexity, Claude, Copilot) could not be confirmed with the
site blocked. Assume the big four plus AI Overviews, which is what every rival
tracker in the same search results covers.

**Refresh.** Not stated in anything readable. Rival trackers refresh weekly; the
report is monthly. Assume the score is refreshed at least monthly.

### The marketing engine behind it

Duda's 2026 AEO report (`duda.co/knowledge/2026-ai-visibility-aeo-report`, and
the TechRadar interview with Oded Ouaknine, 16 Apr 2026) is the reason every
agency has heard of this: 858,457 small-business sites, 69 million AI crawler
visits in February 2026, and the cohort of "AI-visible" sites getting 320% more
human traffic, 270% more form submissions and 250% more click-to-call than the
rest, with each blog post associated with 7% more AI crawler activity. It is a
correlation across their own customers, and Duda's own write-ups say so, but it
is the sentence every prospect will have read: "AI-visible sites get three times
the traffic". A visibility number is how an agency proves it is on the right
side of that line.

### The display, as far as it can be inferred

Nobody outside Duda has published a screenshot in anything the search can reach.
From the feature list, the site dashboard carries: one composite score with its
trend, a prompts table (prompt, engine, mentioned or not, the answer), a
competitors comparison (visibility, mentions, sentiment side by side), a crawler
chart (visits by bot over time), the Site Audit's findings with apply buttons,
traffic and Search Console beside them, and a monthly report generated from the
same numbers under the agency's branding. That is the standard shape of every AI
visibility tool on the market in 2026, and there is no reason to think Duda's
departs from it.

### Duda's wider reporting, for context

Independent of the add-on: an account dashboard with per-site Stats (visits,
sources, form submissions, e-commerce), client-facing dashboards, white-labelled
client emails on the White Label plan, and "automate client billing, analytic
reporting, email notifications". The AI numbers slot into a reporting habit the
agency already has.

---

## What we have today, read from the code

**The screen** (`app/seo/page.tsx`, `components/seo/SeoDashboard.tsx`): "Search
and AI visibility". A score ring (the share of checks that pass), four tiles
(pages checked, issues to fix, quick wins, pages ready), a "Fix these first" list
worst first with a button that goes straight to the fix, a "Working well" panel,
and every published page with its own count and a Review button. Every number is
derived from the published content at view time; nothing is stored, so it is
never stale and never has a history.

**The audit** (`lib/seo/audit.ts`): pure, no network, and every finding
actionable by a travel agent this afternoon. Per page: noindex, title length,
description length, missing alt text, thin content, headings, FAQ pairs. Per
site: the company profile, the site name, the about text, the contact facts and
opening hours. Three severities, no invented weightings.

**The plumbing** (the part that is better than Duda's): robots.txt that names
every AI crawler and allows all of them, with the training, search-time and
user-triggered classes explained in the file itself (`lib/seo/robots.ts`);
llms.txt derived from the profile and the published pages (`lib/seo/llms.ts`);
ten JSON-LD types; a sitemap with collection entries; search listings written by
the model on publish; alt text described by the model; server-rendered HTML with
no client bundle, so a crawler that runs no JavaScript still gets the whole page.

**The monthly report** (`app/reports/page.tsx`, `lib/content/report.ts`): a month
of enquiries, pages published and created, items published, media added, with
deltas against the previous month. Its own header says "no visitor numbers yet:
web analytics is off". Not emailed, not white-labelled, no visibility numbers.

**What does not exist.** Any record of which crawlers visit. Any record of
visitors at all. Any query to any AI engine asking about the client. Any
competitor. Any sentiment. Any stored score. Any report that reaches a client
without them opening the tool.

---

## The gap, ranked by what a client would pay for

1. **Nothing measures the answer.** This is the whole gap. Duda can say "ChatGPT
   names you for 'small-ship cruises in the Hebrides' and not for 'family holidays
   in Crete'". We can say "your Crete page has a good title". The second is the
   cause and the first is the effect, and clients buy effects.
2. **No crawler tracking.** Duda's own headline finding is that crawler visits
   predict recommendations. We allow every crawler in and cannot say whether one
   has ever come.
3. **No history.** A score with no trend is a number; a score that went from 41
   to 58 since the client added three pages is a reason to keep paying.
4. **No competitors.** "You are mentioned 30% of the time" means nothing; "your
   two rivals are at 55% and 20%" is a plan.
5. **No traffic in the report.** Duda's pitch is traffic. Ours cannot show a
   single visit, let alone a visit that came from ChatGPT, and web analytics is
   still switched off.
6. **The report is not sent.** A monthly page a client must remember to open is
   not a monthly report.
7. **Recommendations stop at the audit.** Ours has a Fix button per finding,
   which is good. Duda adds "write the content that would get you mentioned".
   We have the writer already (the AI page and section builders) and nothing
   points it at a visibility miss.

Two things Duda has that are NOT gaps: sentiment (a 0 to 100 tone score for a
travel agency is a vanity number until the mentions exist to score, so it comes
free with slice B and is not worth a day of its own), and Search Console
integration (real, useful, parked: it needs a Google OAuth flow and it is search,
not AI).

---

## The upgrade, in five slices

Same shape as every slice this month: schema and data, the route or cron, tests,
the screen, a browser or receiver check, docs, tsc + vitest + build, one commit.
Each is shippable alone and each makes the next one better.

### Slice A. Who is reading the site (no keys, one day)

**Built, 15 Sep 2026.** Migration `0034_page_visits.sql` (table
`page_visits`: tenant, UTC day, path, kind, source, count; the public site's
only privilege is executing `public.record_visit`, the app role reads and never
writes, `public.prune_page_visits` keeps ninety days), `lib/visits/classify.ts`
(pure: user agent and referer in, a kind and a source out), `lib/visits/
summary.ts` (the thirty-day window, zero-filled, with the thirty before it for
the change chips), `lib/visits/chart.ts` (the chart arithmetic: clean ticks,
five axis labels, bar shares), `lib/db/visits.ts`, the count in the site
route's `after()` with the headers read before it (a Server Component's
`after()` may not touch the request), `app/api/cron/housekeeping/route.ts` at
04:30 UTC, and the "Who is reading your site" panel on /seo
(`components/seo/VisitCharts.tsx`): four tiles washed in their series colour,
each with its own thirty-day sparkline and the change on the month before as a
pill; a roster of the ten AI engines we can name, the ones that have found the
site first with their visits and last-seen day, the rest dashed and "Not yet"
(the Duda crawler-tracking display, answered per engine at a glance); a donut of
who read the pages with the total in the middle; thirty stacked daily columns
that rise in on load, with a hover tooltip and a table behind "See the numbers";
crawlers by name tagged AI or Search with the day last seen; the assistants
people arrived from; and the pages each group read most. Andy's first reaction
to the plain version was "it's a bit boring", which is what the roster, the
donut, the washes, the sparklines and the movement answer. No script: every
chart is HTML, CSS and small inline SVG, so the phone gets real text, not a
shrunken picture. Three series colours validated for light and dark; the two
movements sit inside a prefers-reduced-motion guard. What differs from
the proposal below: FOUR kinds, not three, because monitors and link previews
need counting so they stay OUT of the people number (`bot`, never named on the
screen); the source is the product a client would recognise (three OpenAI
fetchers are all "ChatGPT"); Google-Extended and Applebot-Extended are dropped
because they are robots.txt names with no fetcher of their own (Google's AI
reads through Googlebot, so it counts as search); and Google's AI Overviews
cannot be told from ordinary Google search by referer, so they are not claimed.
Forty-three tests in `tests/visits.test.ts`; the browser smoke rendered the
panel at 1280, 390 and in the dark theme. The prune runs only once CRON_SECRET
is set in Vercel (the same secret reference-sync waits on); until then the table
simply grows past ninety days, which is harmless.

**And the board it sits on (16 Sep 2026).** After three mockup directions
(bento board, monthly story, command centre; canvas at
https://claude.ai/artifact/L7SPgbjqB4nfSWqovvCMpq), Andy chose the bento board
with the monthly story's plain sentences. It shipped as `/results`
(`components/results/ResultsDashboard.tsx`), replacing the visibility screen:
the audit's health ring and fix list, the readers' charts, the enquiries and the
per-page list on one twelve-column board, with a 30 or 90 day window. Slices B
and C will add the AI visibility ring, share of voice, the fifty questions and
six months of history to the same board.

The original proposal, kept for the record:

Log every request to a published page, aggregated per day, as one of three
kinds: an AI crawler (matched on user agent against the same list
`lib/seo/robots.ts` already names: GPTBot, OAI-SearchBot, ChatGPT-User,
ClaudeBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended,
Googlebot, Bingbot, Amazonbot, Applebot, CCBot, Meta-ExternalAgent, Bytespider),
a human visitor who arrived FROM an AI assistant (referer chatgpt.com,
perplexity.ai, gemini.google.com, copilot.microsoft.com, or Google with the AI
Overviews parameter), or an ordinary visitor. Counts only, per tenant per day per
path per kind, written in the site route's `after()` so a visitor is never
delayed: no cookies, no consent question, nothing per person, so the cookie
banner is untouched. One table (`page_visits`: tenant, day, path, kind, bot,
count), an upsert, 90-day retention in the nightly cron.

On the screen: a "Who is reading" panel: AI crawler visits this month by bot
(with the last-seen day), visitors who came from an AI assistant, ordinary
visitors, and the pages each group reads most. This is also the traffic the
monthly report has been missing, without switching on a paid analytics product
or asking a visitor to consent to anything.

### Slice B. Ask the assistants (the headline, needs keys)

A **prompt set per site**: ten questions a customer would ask an assistant,
written by the model from the company profile, the destinations and the
published pages ("Who offers tailor-made holidays to Crete from the UK?", "Is
Coastwise a good company for a first sailing holiday?"), shown to the client to
edit, add to, or drop, 25 at most. The prompts are the product: a client who
reads their own list understands the feature in ten seconds.

A **monthly run** (the cron we already have, `CRON_SECRET` pending with Andy)
asks each prompt of each engine we have a key for, in this order of value for
money: **Perplexity** (the Sonar API answers with citations, is cheap, and is the
engine whose answers most resemble what a search-minded customer sees), **OpenAI
with web search** (the ChatGPT answer; `OPENAI_API_KEY` is already pending for
image generation), **Gemini with grounding** (Google's AI answer, a new key),
**Claude with web search** (the key we hold). Ten prompts by four engines is
forty calls a month per site, pennies.

For each answer we store: mentioned (the brand name or the site's domain appears
in the answer or its citations), cited (our URL is in the citations, and which
page), position (first, in a list, in passing), the other businesses named, and
a tone read by a second cheap call. **The score is Duda's formula**, mentions
over answers as a percentage, because a client comparing us with Duda will
compare the numbers and the formula must be the same. **Competitors come free**:
the businesses the engines name instead are the competitors, ranked by how often
they appear across the same prompts, so a client never has to know who their
rivals are to see them.

On the screen: a second ring beside the health score, **AI visibility**, with its
trend; a prompts table (prompt, each engine's verdict, the answer on expand, who
was named instead); a competitors panel (name, mentions, share); the tone as one
line, not a gauge. Two rings rather than Duda's one composite, on purpose: a site
can be perfectly shaped and unmentioned, and blending the two would hide exactly
the thing the client needs to see.

### Slice C. History (rides along with B)

Store the audit score and the visibility score with each monthly run, and again
whenever a page is published (the audit only). Six months on a small chart on the
screen, and "since last month" deltas on every tile, the way `/reports` already
does for enquiries.

### Slice D. The monthly report, sent

Extend `/reports` with the month's visibility score and change, crawler visits
by bot, AI-referred visitors, the three prompts most improved and the three most
missed, the competitors leaderboard, and the enquiries it already shows. Email it
on the first of the month to every member of the site through SendGrid (already
wired), under the site's own name and logo, with a link back to the live screen
and a print stylesheet for the client who wants a PDF. The report is where the
number turns into a renewal.

### Slice E. From a miss to a page

For each prompt the engines answered without us, one button: **Write the page
that answers this**. It hands the prompt, the competitors' answers and the
company profile to the AI page builder we already have, which drafts a page in
the client's own design for them to publish. This is the one place we can do what
Duda's "one click" claims, because the writer, the design world per client and
the publish flow already exist. The audit's Fix buttons stay as they are.

### Also, and cheap: the prospect audit

The audit engine is pure and already scores any page given its content; the
prompt run in slice B works for any brand name, not only a tenant's. A staff-only
screen that takes a prospect's URL and business name and returns the health
findings and an AI visibility score is Andy's "data-driven outbounding" tool, the
one the 1 Aug 2026 note in `lib/seo/audit.ts` says he was building separately.
Half a day once B exists.

---

## Order, and why

**A first.** No keys, no cost, real data by tomorrow, and it makes the monthly
report honest with traffic for the first time. It also settles a question B
depends on: whether the AI crawlers are visiting at all.

**B second**, once `OPENAI_API_KEY` and `CRON_SECRET` are in Vercel and a
Perplexity key is added (a new account, minutes). B can ship with Perplexity
alone and gain engines as keys arrive.

**C with B**, D after B, E after D. Not before, because a report with no
visibility number in it is the report we already have.

**What Andy needs to do:** the two Vercel keys already on the list, a Perplexity
API key, and a decision on whether the monthly email goes to every site member or
only to owners.

---

## What to distrust

- **Everything about Duda is second-hand.** Their site and support centre are
  blocked from this session. The feature list is their own copy, quoted; the
  engine list, refresh cadence and the "$19 per month" are snippets and should be
  read from the live page before being repeated to a client.
- **The 320% is Duda's cohort study of Duda's customers**, and their own coverage
  calls it a correlation. Use it as the sentence prospects have heard, not as a
  forecast.
- **A visibility score depends entirely on the prompt set.** Ten flattering
  prompts give 90%; ten honest ones give 20%. The prompts must be shown, editable
  and stable month to month, or the trend is noise. This is the one design rule
  for slice B that matters more than any other.
- **Our screen has never been read by a client.** Andy's 24 Aug testing was of
  the AI output, not of the screen. The two-ring layout above is a proposal to
  be looked at on a real site before it is built.
