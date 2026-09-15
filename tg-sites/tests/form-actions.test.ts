/**
 * Where an enquiry also goes: the webhook and the Brevo list (Elementor gap #2,
 * 15 Sep 2026).
 *
 * WHAT IS PINNED. That a webhook address is https to a public name and nothing
 * else, at save time AND at send time; that the body is the flat shape a Zapier
 * step maps by label and the signature over it is the documented HMAC; that a
 * delivery is a boolean whatever the receiver does; that the Brevo contact is
 * the first email field and a name split once; that the two run only when the
 * form asked and the site is configured, and never throw; that the route runs
 * them after the store; that the switches are on the Form block and the keys
 * are in settings; and that nothing renders a key.
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BLOCKS, blockDefinition, defaultPropsFor } from '../lib/content/blocks';
import type { Page } from '../lib/content/schema';
import {
  ACTION_TIMEOUT_MS,
  addToBrevo,
  BREVO_CONTACTS_URL,
  brevoContact,
  deliverWebhook,
  runFormActions,
  SIGNATURE_HEADER,
  signBody,
  webhookPayload,
  type FetchLike,
  type FormActionContext,
} from '../lib/forms/actions';
import { findFormBlock, type FoundForm } from '../lib/forms/submit';
import { cleanWebhookUrl, DEFAULT_FORM_ACTIONS, DEFAULT_SETTINGS, parseSettings } from '../lib/settings/schema';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

const FORM: FoundForm = {
  name: 'Enquiry',
  notifyEmail: '',
  sendWebhook: true,
  addToBrevo: true,
  fields: [
    { kind: 'text', label: 'Your name', required: true },
    { kind: 'email', label: 'Email', required: true },
    { kind: 'textarea', label: 'Message', required: false },
  ],
};

const CONTEXT: FormActionContext = {
  host: 'www.coastwise.example',
  formName: 'Enquiry',
  pageTitle: 'Contact',
  path: '/contact',
  data: { 'Your name': 'Ann Byrne', Email: 'ann@example.com', Message: 'Hello' },
  sentAt: '2026-09-15T16:30:00.000Z',
};

/** A fetch that records what it was asked and answers with the given status. */
function fakeFetch(status: number, seen: Array<{ url: string; init: RequestInit }> = []): { fetch: FetchLike; seen: typeof seen } {
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, init });
    // A 204 may carry no body, or the Response constructor throws.
    return new Response(status === 204 ? null : '{}', { status });
  };
  return { fetch, seen };
}

// ---------------------------------------------------------------------------
// The address
// ---------------------------------------------------------------------------

describe('cleanWebhookUrl', () => {
  it('keeps an https address to a public name, tidied', () => {
    expect(cleanWebhookUrl(' https://hooks.zapier.com/hooks/catch/1/abc ')).toBe('https://hooks.zapier.com/hooks/catch/1/abc');
    expect(cleanWebhookUrl('https://hook.eu1.make.com/x?y=1')).toBe('https://hook.eu1.make.com/x?y=1');
  });

  it('refuses http, because a visitor\'s enquiry does not travel in the clear', () => {
    expect(cleanWebhookUrl('http://hooks.zapier.com/x')).toBeNull();
  });

  /*
   * LOAD-BEARING. The server POSTs a body to this address on a visitor's
   * behalf. An address inside our own network would make the submit route a
   * way to reach the database, the host's metadata service, or a neighbour.
   */
  it('refuses anything that could point inside our own network', () => {
    for (const bad of [
      'https://localhost/x',
      'https://api.localhost/x',
      'https://db.internal/x',
      'https://printer.local/x',
      'https://10.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://hooks/x',
    ]) {
      expect(cleanWebhookUrl(bad), bad).toBeNull();
    }
  });

  it('refuses credentials in the address, other schemes and junk', () => {
    expect(cleanWebhookUrl('https://user:pw@hooks.zapier.com/x')).toBeNull();
    expect(cleanWebhookUrl('javascript:alert(1)')).toBeNull();
    expect(cleanWebhookUrl('ftp://hooks.zapier.com/x')).toBeNull();
    expect(cleanWebhookUrl('not a url')).toBeNull();
    expect(cleanWebhookUrl('')).toBeNull();
    expect(cleanWebhookUrl(42)).toBeNull();
    expect(cleanWebhookUrl(`https://hooks.zapier.com/${'a'.repeat(600)}`)).toBeNull();
  });
});

describe('the settings', () => {
  it('default to nowhere, so no stored site changes', () => {
    expect(DEFAULT_SETTINGS.formActions).toEqual(DEFAULT_FORM_ACTIONS);
    expect(parseSettings({}).formActions).toEqual({ webhookUrl: null, webhookSecret: '', brevoApiKey: '', brevoListId: null });
  });

  it('keep what a client typed, tidied, and refuse what cannot be used', () => {
    const parsed = parseSettings({
      formActions: {
        webhookUrl: 'https://hooks.zapier.com/hooks/catch/1/abc',
        webhookSecret: ' s3cret\nphrase ',
        brevoApiKey: 'xkeysib-abc',
        brevoListId: '12',
      },
    }).formActions;
    expect(parsed.webhookUrl).toBe('https://hooks.zapier.com/hooks/catch/1/abc');
    expect(parsed.webhookSecret).toBe('s3cretphrase');
    expect(parsed.brevoApiKey).toBe('xkeysib-abc');
    expect(parsed.brevoListId).toBe(12);
  });

  it('come back null for a refused address and a list id that is not a number', () => {
    const parsed = parseSettings({ formActions: { webhookUrl: 'http://x.example/x', brevoListId: 'twelve' } }).formActions;
    expect(parsed.webhookUrl).toBeNull();
    expect(parsed.brevoListId).toBeNull();
    expect(parseSettings({ formActions: { brevoListId: -3 } }).formActions.brevoListId).toBeNull();
    expect(parseSettings({ formActions: { brevoListId: 2.5 } }).formActions.brevoListId).toBeNull();
  });

  it('are total: nonsense in, defaults out', () => {
    expect(parseSettings({ formActions: 'nonsense' }).formActions).toEqual(DEFAULT_FORM_ACTIONS);
    expect(parseSettings({ formActions: null }).formActions).toEqual(DEFAULT_FORM_ACTIONS);
    expect(parseSettings({ formActions: { webhookSecret: { deep: true } } }).formActions.webhookSecret).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The webhook
// ---------------------------------------------------------------------------

describe('the webhook body and its signature', () => {
  it('is the flat shape a Zapier step maps by label', () => {
    expect(webhookPayload(CONTEXT)).toEqual({
      event: 'form.submitted',
      form: 'Enquiry',
      site: 'www.coastwise.example',
      page: { title: 'Contact', path: '/contact' },
      sentAt: '2026-09-15T16:30:00.000Z',
      fields: { 'Your name': 'Ann Byrne', Email: 'ann@example.com', Message: 'Hello' },
    });
  });

  it('signs the exact body bytes with HMAC-SHA256, hex, as sha256=', () => {
    const body = JSON.stringify(webhookPayload(CONTEXT));
    const expected = `sha256=${createHmac('sha256', 'phrase').update(body).digest('hex')}`;
    expect(signBody(body, 'phrase')).toBe(expected);
    expect(signBody(body, 'other')).not.toBe(expected);
  });
});

describe('deliverWebhook', () => {
  it('posts JSON to the address with the event and the signature headers, and reads 2xx as delivered', async () => {
    const { fetch, seen } = fakeFetch(200);
    const ok = await deliverWebhook({ url: 'https://hooks.zapier.com/hooks/catch/1/abc', secret: 'phrase', context: CONTEXT, fetchImpl: fetch });
    expect(ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://hooks.zapier.com/hooks/catch/1/abc');
    expect(seen[0].init.method).toBe('POST');
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-TGS-Event']).toBe('form.submitted');
    expect(headers[SIGNATURE_HEADER]).toBe(signBody(String(seen[0].init.body), 'phrase'));
    expect(JSON.parse(String(seen[0].init.body))).toEqual(webhookPayload(CONTEXT));
    // Never follows a redirect: a 3xx to somewhere else is not a delivery.
    expect(seen[0].init.redirect).toBe('manual');
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends no signature header without a secret', async () => {
    const { fetch, seen } = fakeFetch(202);
    expect(await deliverWebhook({ url: 'https://hooks.zapier.com/x', secret: '', context: CONTEXT, fetchImpl: fetch })).toBe(true);
    expect((seen[0].init.headers as Record<string, string>)[SIGNATURE_HEADER]).toBeUndefined();
  });

  it('is a false, never a throw, when the receiver fails, redirects, or is unreachable', async () => {
    expect(await deliverWebhook({ url: 'https://hooks.zapier.com/x', secret: '', context: CONTEXT, fetchImpl: fakeFetch(500).fetch })).toBe(false);
    expect(await deliverWebhook({ url: 'https://hooks.zapier.com/x', secret: '', context: CONTEXT, fetchImpl: fakeFetch(302).fetch })).toBe(false);
    const down: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    expect(await deliverWebhook({ url: 'https://hooks.zapier.com/x', secret: '', context: CONTEXT, fetchImpl: down })).toBe(false);
  });

  it('refuses at send time what the parser refuses, so a hand-edited row cannot reach inside', async () => {
    const { fetch, seen } = fakeFetch(200);
    expect(await deliverWebhook({ url: 'https://169.254.169.254/latest', secret: '', context: CONTEXT, fetchImpl: fetch })).toBe(false);
    expect(await deliverWebhook({ url: 'http://hooks.zapier.com/x', secret: '', context: CONTEXT, fetchImpl: fetch })).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('gives up on a receiver that answers slower than the timeout', async () => {
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      });
    expect(ACTION_TIMEOUT_MS).toBe(8000);
    expect(await deliverWebhook({ url: 'https://hooks.zapier.com/x', secret: '', context: CONTEXT, fetchImpl: slow, timeoutMs: 20 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Brevo
// ---------------------------------------------------------------------------

describe('brevoContact', () => {
  it('takes the first email field and splits a name field once', () => {
    expect(brevoContact(FORM, CONTEXT.data)).toEqual({ email: 'ann@example.com', attributes: { FIRSTNAME: 'Ann', LASTNAME: 'Byrne' } });
  });

  it('keeps a one-word name as the first name, and a form with no name field sends none', () => {
    expect(brevoContact(FORM, { ...CONTEXT.data, 'Your name': 'Ann' })!.attributes).toEqual({ FIRSTNAME: 'Ann' });
    const nameless: FoundForm = { ...FORM, fields: [{ kind: 'email', label: 'Email', required: true }] };
    expect(brevoContact(nameless, { Email: 'ann@example.com' })).toEqual({ email: 'ann@example.com', attributes: {} });
  });

  it('is null without a plausible address, since a list entry needs one', () => {
    expect(brevoContact(FORM, { ...CONTEXT.data, Email: 'not an address' })).toBeNull();
    expect(brevoContact(FORM, {})).toBeNull();
  });

  it('never reads a short-answer field as the address, whatever it holds', () => {
    const swapped: FoundForm = { ...FORM, fields: [{ kind: 'text', label: 'Email', required: true }] };
    expect(brevoContact(swapped, { Email: 'ann@example.com' })).toBeNull();
  });
});

describe('addToBrevo', () => {
  const contact = { email: 'ann@example.com', attributes: { FIRSTNAME: 'Ann', LASTNAME: 'Byrne' } };

  it('creates or updates the contact on the list with the key in the header', async () => {
    const { fetch, seen } = fakeFetch(201);
    expect(await addToBrevo({ apiKey: 'xkeysib-abc', listId: 12, contact, fetchImpl: fetch })).toBe(true);
    expect(seen[0].url).toBe(BREVO_CONTACTS_URL);
    expect((seen[0].init.headers as Record<string, string>)['api-key']).toBe('xkeysib-abc');
    expect(JSON.parse(String(seen[0].init.body))).toEqual({
      email: 'ann@example.com',
      attributes: { FIRSTNAME: 'Ann', LASTNAME: 'Byrne' },
      listIds: [12],
      updateEnabled: true,
    });
    // 204 is Brevo's "already had them, updated".
    expect(await addToBrevo({ apiKey: 'xkeysib-abc', listId: 12, contact, fetchImpl: fakeFetch(204).fetch })).toBe(true);
  });

  it('is a false for a bad key, a gone list, or no key at all', async () => {
    expect(await addToBrevo({ apiKey: 'xkeysib-abc', listId: 12, contact, fetchImpl: fakeFetch(401).fetch })).toBe(false);
    expect(await addToBrevo({ apiKey: 'xkeysib-abc', listId: 12, contact, fetchImpl: fakeFetch(400).fetch })).toBe(false);
    const { fetch, seen } = fakeFetch(201);
    expect(await addToBrevo({ apiKey: '', listId: 12, contact, fetchImpl: fetch })).toBe(false);
    expect(await addToBrevo({ apiKey: 'k', listId: 0, contact, fetchImpl: fetch })).toBe(false);
    expect(seen).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Both, from the route
// ---------------------------------------------------------------------------

describe('runFormActions', () => {
  const configured = { webhookUrl: 'https://hooks.zapier.com/x', webhookSecret: 'phrase', brevoApiKey: 'xkeysib-abc', brevoListId: 12 };

  it('runs both when the form asked and the site is configured', async () => {
    const { fetch, seen } = fakeFetch(201);
    expect(await runFormActions({ settings: configured, form: FORM, context: CONTEXT, fetchImpl: fetch })).toEqual({ webhook: true, brevo: true });
    expect(seen.map((s) => s.url).sort()).toEqual([BREVO_CONTACTS_URL, 'https://hooks.zapier.com/x']);
  });

  it('runs neither when the form did not ask, whatever the site has', async () => {
    const { fetch, seen } = fakeFetch(201);
    const quiet: FoundForm = { ...FORM, sendWebhook: false, addToBrevo: false };
    expect(await runFormActions({ settings: configured, form: quiet, context: CONTEXT, fetchImpl: fetch })).toEqual({ webhook: null, brevo: null });
    expect(seen).toHaveLength(0);
  });

  it('says false, and sends nothing, when the form asked and the site is not configured', async () => {
    const { fetch, seen } = fakeFetch(201);
    expect(await runFormActions({ settings: DEFAULT_FORM_ACTIONS, form: FORM, context: CONTEXT, fetchImpl: fetch })).toEqual({ webhook: false, brevo: false });
    expect(seen).toHaveLength(0);
  });

  it('never throws, and one failing does not stop the other', async () => {
    const fetch: FetchLike = async (url) => {
      if (url === BREVO_CONTACTS_URL) throw new Error('down');
      return new Response('', { status: 200 });
    };
    expect(await runFormActions({ settings: configured, form: FORM, context: CONTEXT, fetchImpl: fetch })).toEqual({ webhook: true, brevo: false });
  });
});

// ---------------------------------------------------------------------------
// The wiring
// ---------------------------------------------------------------------------

describe('the form block', () => {
  it('offers the two switches, off by default, and the found form reads them strictly', () => {
    const def = blockDefinition('form')!;
    expect(def.fields.some((f) => f.key === 'sendWebhook' && f.kind === 'toggle')).toBe(true);
    expect(def.fields.some((f) => f.key === 'addToBrevo' && f.kind === 'toggle')).toBe(true);
    expect(defaultPropsFor('form').sendWebhook).toBe(false);
    expect(defaultPropsFor('form').addToBrevo).toBe(false);
    expect(BLOCKS.some((b) => b.type === 'form')).toBe(true);

    const page = {
      id: 'p', title: 'Contact', slug: 'contact', sections: [
        { id: 's', rows: [{ id: 'r', columns: [{ id: 'c', blocks: [
          { id: 'b1', type: 'form', props: { name: 'A', fields: [], sendWebhook: true, addToBrevo: 'yes' } },
          { id: 'b2', type: 'form', props: { name: 'B', fields: [] } },
        ] }] }] },
      ],
    } as unknown as Page;
    expect(findFormBlock(page, 'b1')).toMatchObject({ sendWebhook: true, addToBrevo: false });
    expect(findFormBlock(page, 'b2')).toMatchObject({ sendWebhook: false, addToBrevo: false });
  });
});

describe('the route', () => {
  const route = source('app', 'site', '[host]', '_form', 'route.ts');

  it('runs the actions only after a stored submission, and reads settings only when a form asks', () => {
    const stored = route.indexOf('if (stored) {');
    const asked = route.indexOf('if (declared.sendWebhook || declared.addToBrevo) {');
    const actions = route.indexOf('await runFormActions({');
    expect(stored).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(stored);
    expect(actions).toBeGreaterThan(asked);
    expect(route.indexOf('await getPublicSettings(tenantId)')).toBeGreaterThan(asked);
  });

  /*
   * A client's hook may take eight seconds to answer. The visitor who pressed
   * Send is not made to wait for it: the redirect goes first, the deliveries
   * run after it in the same invocation.
   */
  it('delivers after the response, so a slow receiver never holds the visitor', () => {
    expect(route).toContain("import { after } from 'next/server';");
    const afterAt = route.indexOf('after(async () => {');
    expect(afterAt).toBeGreaterThan(-1);
    expect(route.indexOf('await runFormActions({')).toBeGreaterThan(afterAt);
    // The redirect is still the last thing in the handler.
    expect(route.indexOf('return backTo(path, done);', afterAt)).toBeGreaterThan(afterAt);
  });
});

describe('the settings screen', () => {
  const editor = source('components', 'settings', 'SettingsEditor.tsx');

  it('has a Forms tab a client can reach, with the key and the secret as passwords', () => {
    expect(editor).toContain("{ id: 'forms', label: 'Forms' }");
    expect(editor).toContain("{tab === 'forms' && (");
    expect(editor).toContain('id="fa-secret"\n                  className="tv-input"\n                  type="password"');
    expect(editor).toContain('id="fa-brevo-key"\n                  className="tv-input"\n                  type="password"');
    expect(editor).toContain('id="fa-webhook"\n                  className="tv-input"\n                  type="url"');
  });
});

describe('nothing renders a key', () => {
  it('the published head and the AI prompts never see the form actions', () => {
    for (const file of [
      source('lib', 'settings', 'head.ts'),
      source('lib', 'ai', 'prompt.ts'),
      source('components', 'render', 'PageRenderer.tsx'),
      source('components', 'render', 'blocks.tsx'),
    ]) {
      expect(file).not.toContain('formActions');
      expect(file).not.toContain('brevoApiKey');
      expect(file).not.toContain('webhookSecret');
    }
  });

  it('the actions module logs nothing and imports no server-only marker, so it is testable as it runs', () => {
    const actions = source('lib', 'forms', 'actions.ts');
    expect(actions).not.toContain('console.');
    expect(actions).not.toContain("'server-only'");
  });
});
