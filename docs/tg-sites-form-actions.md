# Form actions: where an enquiry also goes (tg-sites)

**Written 15 Sep 2026, when the webhook and the Brevo list shipped (Elementor
gap #2 in `docs/elementor-gap-analysis.md`).** This is the contract for whoever
wires the other end: a client's Zapier or Make step, a CRM's inbound hook, or
us, on the phone to a client who cannot see their leads arriving.

## What a client does

1. **Settings, Forms.** Paste the webhook address (https only), and if the
   receiver should be able to check the post came from the site, any phrase as
   the signing secret. For Brevo, the API key (Brevo: SMTP and API, then API
   keys) and the list id (the number in the list's address).
2. **On the form itself**, in the block's settings on the page: *Also send it
   to your webhook* and *Add the sender to your Brevo list*. Both are per form,
   so a newsletter box can feed the list and a quote form can feed the CRM.

Every enquiry still lands in Enquiries and is still emailed if the form asks.
The two actions are extra copies, sent after the enquiry is stored, and a hook
that is down loses nothing: the table is the record.

## The webhook

One `POST` per stored enquiry, to the address as saved.

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `Travelgenix-Sites-Webhook/1` |
| `X-TGS-Event` | `form.submitted` |
| `X-TGS-Signature` | `sha256=<hex>`, only when a secret is set |

The body:

```json
{
  "event": "form.submitted",
  "form": "Enquiry",
  "site": "www.coastwise.example",
  "page": { "title": "Contact", "path": "/contact" },
  "sentAt": "2026-09-15T16:30:00.000Z",
  "fields": {
    "Your name": "Ann Byrne",
    "Email": "ann@example.com",
    "How can we help?": "Seven nights in Hvar, please."
  }
}
```

`fields` is keyed by the labels the client gave the fields, exactly as they
appear on the page, so a Zapier step maps them by the words the client
recognises. Two fields with the same label are told apart with a suffix, the
same as in Enquiries. `site` and `page` are there so one hook can serve every
form on a site.

**Verifying the signature.** HMAC-SHA256 over the exact body bytes, keyed with
the secret, hex encoded, prefixed `sha256=`. In Node:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
if (expected !== req.headers['x-tgs-signature']) return res.status(401).end();
```

Compute it over the raw body, not over a re-serialised object: a JSON library
that reorders keys or changes spacing will produce a different digest.

**What counts as delivered.** Any 2xx. A redirect is not followed and is not a
delivery. A receiver that has not answered after 8 seconds is treated as down.
There is no retry: an enquiry is never sent twice, and Enquiries has the copy.

**What the address may be.** `https` only, to a public name: no IP addresses,
no `localhost`, no name without a dot, no credentials in the URL. The rule is
`cleanWebhookUrl` in `lib/settings/schema.ts`, applied when the address is
saved (a refused address comes back empty on the screen) and again at send
time. The reason is that the server posts to this address on a visitor's
behalf, so it must never be pointable at anything inside the platform.

## Brevo

`POST https://api.brevo.com/v3/contacts` with the client's key in the
`api-key` header and this body:

```json
{
  "email": "ann@example.com",
  "attributes": { "FIRSTNAME": "Ann", "LASTNAME": "Byrne" },
  "listIds": [12],
  "updateEnabled": true
}
```

The address is the form's first *Email address* field holding a plausible
address; with none, nothing is sent. The name is the first *Short answer* field
whose label contains "name", split once on its first space. Only `FIRSTNAME`
and `LASTNAME` are sent, because every Brevo account has those two and an
attribute the account does not have is refused or dropped depending on the
day. `updateEnabled` means a sender who is already a contact is updated and
added to the list rather than duplicated. Brevo answers 201 (new) or 204
(updated); both are success.

## Where the pieces are

- `lib/settings/schema.ts`: `FormActionsSettings`, `cleanWebhookUrl`, the
  parser. The key and the secret are the client's own, stored with the
  client-editable settings like the analytics id, read on the server only.
- `lib/forms/actions.ts`: the payload, the signature, the two senders and
  `runFormActions`. Pure, with the fetch as a parameter, so it is tested
  against a fake and against a real local receiver.
- `app/site/[host]/_form/route.ts`: runs them after the store, only when the
  form asked, reading the settings through the public role only then.
- `lib/content/blocks.ts`: the two switches on the Form block;
  `lib/forms/submit.ts` reads them strictly.
- `components/settings/SettingsEditor.tsx`: the Forms tab.
- `tests/form-actions.test.ts`, and the local-receiver check in the session
  scratchpad (`form-actions-smoke/run.mjs`), which verifies the signature
  recipe above on real HTTP bytes.

## Not built, on purpose

- No retry queue. An enquiry is sent once; a dead hook is a false in the log
  and a row in Enquiries.
- No delivery status on the Enquiries screen yet. `runFormActions` returns one,
  so the screen can learn it later without touching the senders.
- No second named integration. Brevo is the list the agencies we work with
  use; anything else takes the webhook.
