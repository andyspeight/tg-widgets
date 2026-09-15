/**
 * Where a stored enquiry ALSO goes: a webhook, and a Brevo list.
 *
 * Elementor gap #2 (docs/elementor-gap-analysis.md, built 15 Sep 2026). Until
 * now a form stopped at Enquiries and a courtesy email, and an agency that
 * keeps its leads in a CRM or a mailing list retyped them. Elementor Pro's
 * form fires actions after submit; these are our two, the general one and the
 * one named integration the agencies we work with actually use.
 *
 * BEST EFFORT, AFTER THE STORE, NEVER THE VISITOR'S PROBLEM. The submission
 * is in the table before any of this runs (see the submit route), and every
 * path here ends in a boolean rather than a throw. A hook that is down, a key
 * that was revoked, a list that was deleted: each is a quiet false and the
 * enquiry still sits in Enquiries. Same stance as lib/forms/notify.ts.
 *
 * THE WEBHOOK IS SIGNED when the site has a secret: HMAC-SHA256 over the exact
 * body bytes, hex, in X-TGS-Signature as "sha256=<hex>". A receiver that
 * recomputes it can tell our deliveries from anybody else's POST to the same
 * address, which matters because the address is not a secret. The recipe is
 * written down in docs/tg-sites-form-actions.md for whoever wires the other end.
 *
 * NEVER TO OUR OWN NETWORK. The address is checked again here, at send time,
 * with the same rule the settings parser applied when it was saved
 * (cleanWebhookUrl: https, a public name, no IP literal), so a row edited by
 * hand cannot turn this into a request to something inside the platform.
 *
 * PURE, LIKE lib/forms/submit.ts: no server-only import, and the fetch is a
 * parameter, so the whole thing is tested against a fake and against a real
 * local receiver without touching the network. The route passes nothing and
 * gets the global fetch.
 */

import { createHmac } from 'node:crypto';

import { cleanWebhookUrl, type FormActionsSettings } from '../settings/schema';
import { cleanNotifyEmail, type FoundForm } from './submit';

/** Node's fetch, or a stand-in with the same shape. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** What one enquiry looks like to the outside: the words a visitor sent, and where. */
export interface FormActionContext {
  host: string;
  formName: string;
  pageTitle: string;
  /** The page's path on the site, with its leading slash. */
  path: string;
  /** The answers, keyed by the published field labels. */
  data: Record<string, string>;
  /** When it was sent, ISO 8601. */
  sentAt: string;
}

/** How long any one delivery may take. A hook that answers slower than this is down. */
export const ACTION_TIMEOUT_MS = 8000;

export const WEBHOOK_EVENT = 'form.submitted';
export const SIGNATURE_HEADER = 'X-TGS-Signature';
export const BREVO_CONTACTS_URL = 'https://api.brevo.com/v3/contacts';

// ---------------------------------------------------------------------------
// The webhook
// ---------------------------------------------------------------------------

/**
 * The body a receiver gets. Flat and boring on purpose: a Zapier or Make step
 * maps fields by name, and a name that is the label the client typed is the one
 * they will recognise. The site and the page are there so one hook can serve
 * every form on a site and still tell them apart.
 */
export function webhookPayload(context: FormActionContext): Record<string, unknown> {
  return {
    event: WEBHOOK_EVENT,
    form: context.formName,
    site: context.host,
    page: { title: context.pageTitle, path: context.path },
    sentAt: context.sentAt,
    fields: { ...context.data },
  };
}

/** The signature for a body, as it goes in the header. */
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

/**
 * POST the enquiry to the site's webhook. True when the receiver answered 2xx.
 * The address is re-checked here; anything the parser would refuse is refused.
 */
export async function deliverWebhook(input: {
  url: string;
  secret: string;
  context: FormActionContext;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<boolean> {
  const url = cleanWebhookUrl(input.url);
  if (!url) return false;
  const body = JSON.stringify(webhookPayload(input.context));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Travelgenix-Sites-Webhook/1',
    'X-TGS-Event': WEBHOOK_EVENT,
  };
  if (input.secret) headers[SIGNATURE_HEADER] = signBody(body, input.secret);
  const doFetch = input.fetchImpl ?? (fetch as FetchLike);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs ?? ACTION_TIMEOUT_MS),
    });
    try {
      await res.text();
    } catch {
      // The body is not ours to need; draining it only frees the socket.
    }
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Brevo
// ---------------------------------------------------------------------------

export interface BrevoContact {
  email: string;
  attributes: { FIRSTNAME?: string; LASTNAME?: string };
}

/**
 * The contact a submission makes: the first email field that holds a plausible
 * address, and a name from the first short-answer field whose label says name,
 * split on its first space. Only FIRSTNAME and LASTNAME, because every Brevo
 * account has those two and an attribute the account does not have is refused
 * or dropped depending on the day. Null when there is no address, since a list
 * entry without one is nothing.
 */
export function brevoContact(form: FoundForm, data: Record<string, string>): BrevoContact | null {
  let email = '';
  let name = '';
  for (let index = 0; index < form.fields.length; index += 1) {
    const field = form.fields[index];
    const key = field.label || `Field ${index + 1}`;
    const value = (data[key] ?? '').trim();
    if (!email && field.kind === 'email') email = cleanNotifyEmail(value);
    if (!name && field.kind === 'text' && /name/i.test(field.label) && value) name = value.slice(0, 120);
  }
  if (!email) return null;
  const attributes: BrevoContact['attributes'] = {};
  if (name) {
    const space = name.indexOf(' ');
    if (space === -1) attributes.FIRSTNAME = name;
    else {
      attributes.FIRSTNAME = name.slice(0, space);
      attributes.LASTNAME = name.slice(space + 1).trim();
    }
  }
  return { email, attributes };
}

/**
 * Create or update the contact on the list. Brevo answers 201 for a new
 * contact and 204 for one it already had (updateEnabled), and both are success;
 * anything else, including a bad key (401) or a list that is gone (400), is a
 * quiet false.
 */
export async function addToBrevo(input: {
  apiKey: string;
  listId: number;
  contact: BrevoContact;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<boolean> {
  if (!input.apiKey || !Number.isInteger(input.listId) || input.listId <= 0) return false;
  const doFetch = input.fetchImpl ?? (fetch as FetchLike);
  try {
    const res = await doFetch(BREVO_CONTACTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': input.apiKey,
      },
      body: JSON.stringify({
        email: input.contact.email,
        attributes: input.contact.attributes,
        listIds: [input.listId],
        updateEnabled: true,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs ?? ACTION_TIMEOUT_MS),
    });
    try {
      await res.text();
    } catch {
      // ignore
    }
    return res.status === 201 || res.status === 204;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Both, from the route
// ---------------------------------------------------------------------------

/** What happened, for a log line or a test. Null means the form did not ask. */
export interface FormActionsOutcome {
  webhook: boolean | null;
  brevo: boolean | null;
}

/**
 * Run whichever actions this form asked for and the site has configured, in
 * parallel, and never throw. A form that asks for the webhook on a site with no
 * address does nothing and says so with a false, which is what the Enquiries
 * screen would show if it ever learns to.
 */
export async function runFormActions(input: {
  settings: FormActionsSettings;
  form: FoundForm;
  context: FormActionContext;
  fetchImpl?: FetchLike;
}): Promise<FormActionsOutcome> {
  const outcome: FormActionsOutcome = { webhook: null, brevo: null };
  const jobs: Array<Promise<void>> = [];

  if (input.form.sendWebhook) {
    outcome.webhook = false;
    if (input.settings.webhookUrl) {
      jobs.push(
        deliverWebhook({
          url: input.settings.webhookUrl,
          secret: input.settings.webhookSecret,
          context: input.context,
          fetchImpl: input.fetchImpl,
        }).then((ok) => {
          outcome.webhook = ok;
        }),
      );
    }
  }

  if (input.form.addToBrevo) {
    outcome.brevo = false;
    const contact = brevoContact(input.form, input.context.data);
    if (contact && input.settings.brevoApiKey && input.settings.brevoListId) {
      jobs.push(
        addToBrevo({
          apiKey: input.settings.brevoApiKey,
          listId: input.settings.brevoListId,
          contact,
          fetchImpl: input.fetchImpl,
        }).then((ok) => {
          outcome.brevo = ok;
        }),
      );
    }
  }

  await Promise.allSettled(jobs);
  return outcome;
}
