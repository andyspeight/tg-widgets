/**
 * The new-comment notification's pure half: who it goes to, and what it says.
 * Tested without a tenant or a mail provider, the same split the resolver uses.
 */

import { describe, expect, it } from 'vitest';

import { buildCommentEmail, firstLine, staffRecipients } from '../lib/comments/notify-content';

const members = [
  { userId: 'client', email: 'jane@acme-travel.co.uk' },
  { userId: 'staff1', email: 'sam@travelgenix.com' },
  { userId: 'staff2', email: 'lee@agendas.group' },
];

describe('staffRecipients', () => {
  it('keeps only staff addresses and drops the client author', () => {
    const to = staffRecipients(members, 'client');
    expect(to).toEqual(['sam@travelgenix.com', 'lee@agendas.group']);
  });

  it('never emails the author, even when the author is staff', () => {
    const to = staffRecipients(members, 'staff1');
    expect(to).not.toContain('sam@travelgenix.com');
    expect(to).toContain('lee@agendas.group');
  });

  it('de-duplicates a repeated staff address, case-insensitively', () => {
    // Two rows for one address should not send twice (a data anomaly, but cheap
    // to be safe about). The author is the client, so neither staff row is theirs.
    const withDup = [...members, { userId: 'staff2b', email: 'LEE@agendas.group' }];
    const to = staffRecipients(withDup, 'client');
    expect(to.filter((email) => email === 'lee@agendas.group')).toHaveLength(1);
  });

  it('is empty when the site has no staff to tell', () => {
    expect(staffRecipients([{ userId: 'a', email: 'a@acme.co.uk' }], 'a')).toEqual([]);
  });
});

describe('firstLine', () => {
  it('collapses whitespace and caps the length with an ellipsis', () => {
    expect(firstLine('  hello   there  ')).toBe('hello there');
    expect(firstLine('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('buildCommentEmail', () => {
  it('names the page, previews the body, and links when there is a link', () => {
    const email = buildCommentEmail({
      authorName: 'Jane',
      pageTitle: 'Home',
      body: 'Can we make the hero bigger?',
      link: 'https://widgets.example/editor?page=p1&comment=c1',
    });
    expect(email.subject).toBe('New comment on Home');
    expect(email.text).toContain('Jane left a comment on Home.');
    expect(email.text).toContain('Can we make the hero bigger?');
    expect(email.html).toContain('https://widgets.example/editor?page=p1&amp;comment=c1');
    expect(email.text).toContain('Open the comment: https://widgets.example/editor?page=p1&comment=c1');
  });

  it('escapes the body and author for the HTML part', () => {
    const email = buildCommentEmail({
      authorName: '<b>x</b>',
      pageTitle: 'About',
      body: '<script>alert(1)</script>',
      link: null,
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).not.toContain('<b>x</b>');
  });

  it('carries no link line when there is no link', () => {
    const email = buildCommentEmail({ authorName: 'Jane', pageTitle: 'Home', body: 'hi', link: null });
    expect(email.text).not.toContain('Open the comment');
    expect(email.html).not.toContain('Open the comment');
  });

  it('falls back to a plain name and page when either is blank', () => {
    const email = buildCommentEmail({ authorName: '  ', pageTitle: '  ', body: 'hi', link: null });
    expect(email.subject).toBe('New comment on a page');
    expect(email.text).toContain('A client left a comment on a page.');
  });
});
