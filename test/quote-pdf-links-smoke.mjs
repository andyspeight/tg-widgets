/**
 * Quote PDF — supplier <a href> links stay clickable (client feedback, Aug 2026).
 *
 * eTrip passes a hotel description whose HTML contains a real link, e.g.
 * "View Full Hotel Info >". The PDF renderer sanitised the description against an
 * allowlist that dropped <a>, so the link went to plain text and Adobe only
 * relinked it if the bare URL happened to be visible. sanitiseDescription now
 * keeps <a> with a scheme-validated href (and drops every other attribute), so
 * Chromium renders it as an active PDF link — while javascript:/other schemes
 * and attribute-breakout attempts are still neutralised.
 *
 * Run: node test/quote-pdf-links-smoke.mjs   (npm run test:quote-pdf-links)
 */
import { sanitiseDescription } from '../render-quote.js';

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

console.log('A safe supplier link is preserved and stays clickable');
{
  const html = '<p>Hotel: <a href="https://www.justsardinia.co.uk/accommodation/360-Is-Serenas-Badesi-Resort">View Full Hotel Info</a> &gt;</p>';
  const out = sanitiseDescription(html);
  ok('the <a href> survives with its URL', out.includes('<a href="https://www.justsardinia.co.uk/accommodation/360-Is-Serenas-Badesi-Resort">'));
  ok('the link text survives', out.includes('View Full Hotel Info'));
  ok('the surrounding paragraph survives', /^<p>/.test(out) && out.includes('</a>'));
}

console.log('Only the href is kept — target/onclick/style are dropped');
{
  const out = sanitiseDescription('<a href="https://x.com" target="_blank" onclick="alert(1)" style="color:red">y</a>');
  ok('href is kept', out.includes('<a href="https://x.com">'));
  ok('target is dropped', !/target/i.test(out));
  ok('onclick is dropped', !/onclick/i.test(out));
  ok('style is dropped', !/style=/i.test(out));
}

console.log('Dangerous schemes are neutralised (link text stays, no href)');
{
  const js = sanitiseDescription('<a href="javascript:alert(1)">click</a>');
  ok('javascript: URL is removed', !/javascript:/i.test(js));
  ok('the anchor carries no href (not clickable)', js.includes('<a>') && !/href/i.test(js));
  ok('the visible text is kept', js.includes('click'));

  const data = sanitiseDescription('<a href="data:text/html,<script>alert(1)</script>">x</a>');
  ok('data: URL is removed', !/data:text\/html/i.test(data) && !/href/i.test(data));
}

console.log('Query-string ampersands are not double-encoded');
{
  const out = sanitiseDescription('<a href="https://x.com/p?a=1&amp;b=2">z</a>');
  ok('the & is encoded exactly once for the attribute', out.includes('a=1&amp;b=2'));
  ok('it is not double-encoded', !out.includes('&amp;amp;'));
}

console.log('A bare domain is promoted to https');
{
  const out = sanitiseDescription('<a href="www.example.com/deal">e</a>');
  ok('bare domain becomes an https link', out.includes('<a href="https://www.example.com/deal">'));
}

console.log('Attribute-breakout attempts are escaped, not honoured');
{
  const out = sanitiseDescription('<a href="https://x.com/&quot;onmouseover=alert(1)">q</a>');
  ok('an injected quote is escaped inside the attribute', out.includes('&quot;') && !/"\s*onmouseover/i.test(out));
}

console.log('Non-allowlisted tags are still stripped');
{
  const out = sanitiseDescription('<script>alert(1)</script><div onclick="x">hi</div><strong>keep</strong>');
  ok('script is removed', !/<script/i.test(out));
  ok('div is removed', !/<div/i.test(out));
  ok('allowed formatting is kept', out.includes('<strong>keep</strong>'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
