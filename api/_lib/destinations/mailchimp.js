// =============================================================================
//  /api/_lib/destinations/mailchimp.js
// =============================================================================
//
//  Adds (or updates) a subscriber to a Mailchimp audience.
//
//  Mailchimp identifies members by the lowercased MD5 hash of their email,
//  so a single PUT /lists/{listId}/members/{hash} request handles both
//  insert and update — exactly what we want for newsletter signups.
//
//  Auth: HTTP Basic, username "anystring", password = the API key.
//  Server prefix (e.g. "us21") is extracted from the suffix of the API key.
//
//  Credentials shape:
//    { apiKey: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-us21" }
//
//  Config shape:
//    {
//      audienceId: "abc123",                  // required, the list/audience ID
//      doubleOptIn: false,                     // default false (status_if_new = "subscribed")
//      tags: ["newsletter", "atlas-travel"],   // optional, applied on signup
//      mergeFields: { CUSTOM: "{{custom}}" }   // optional pass-through extras
//    }
//
//  Docs: https://mailchimp.com/developer/marketing/api/list-members/add-or-update-list-member/
// =============================================================================

import { createHash } from 'crypto';

export async function dispatchMailchimp(lead, job) {
  const { credentials = {}, config = {} } = job;

  if (!credentials.apiKey) throw new Error('Mailchimp credentials missing apiKey');
  if (!config.audienceId) throw new Error('Mailchimp config missing audienceId');

  // API key format: <hex>-<server>, e.g. abc123-us21
  const m = String(credentials.apiKey).match(/-([a-z]{2}\d+)$/);
  if (!m) throw new Error('Mailchimp apiKey is missing data center suffix (e.g. -us21)');
  const dc = m[1];

  const subscriberHash = createHash('md5')
    .update(String(lead.contact.email).toLowerCase().trim())
    .digest('hex');

  const url = `https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(config.audienceId)}/members/${subscriberHash}`;

  // Build merge_fields (canonical lead → Mailchimp's FNAME/LNAME convention)
  const merge_fields = {};
  if (lead.contact.firstName) merge_fields.FNAME = lead.contact.firstName;
  if (lead.contact.lastName)  merge_fields.LNAME = lead.contact.lastName;
  if (lead.contact.phone)     merge_fields.PHONE = lead.contact.phone;
  // Pass-through custom merge fields if the routing config specified any
  if (config.mergeFields && typeof config.mergeFields === 'object') {
    for (const [k, v] of Object.entries(config.mergeFields)) {
      // Allow simple lead-property templates: "{{firstName}}" → resolved value
      if (typeof v === 'string' && v.startsWith('{{') && v.endsWith('}}')) {
        const key = v.slice(2, -2).trim();
        const val = resolveLeadPath(lead, key);
        if (val != null) merge_fields[k.toUpperCase()] = String(val);
      } else if (v != null) {
        merge_fields[k.toUpperCase()] = String(v);
      }
    }
  }

  // Tags — combine lead tags with config tags, dedupe
  const tagSet = new Set();
  for (const t of (lead.tags || [])) if (t) tagSet.add(t);
  for (const t of (config.tags || [])) if (t) tagSet.add(t);
  const tags = Array.from(tagSet);

  const body = {
    email_address: lead.contact.email,
    status_if_new: config.doubleOptIn ? 'pending' : 'subscribed',
    merge_fields,
    tags,
  };

  // Strip empty merge_fields object so Mailchimp doesn't reject it
  if (Object.keys(merge_fields).length === 0) delete body.merge_fields;
  if (tags.length === 0) delete body.tags;

  const auth = 'Basic ' + Buffer.from(`anystring:${credentials.apiKey}`).toString('base64');

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseBody = await resp.text();
  if (!resp.ok) {
    const err = new Error(`Mailchimp ${resp.status}: ${responseBody.slice(0, 300)}`);
    err.statusCode = resp.status;
    throw err;
  }

  return {
    statusCode: resp.status,
    requestPayload: { url, method: 'PUT', body: redactBody(body) },
    responseBody: responseBody.slice(0, 2000),
  };
}

function redactBody(body) {
  if (!body || !body.email_address) return body;
  const e = body.email_address;
  return { ...body, email_address: e.replace(/^(.).*(@.*)$/, '$1***$2') };
}

function resolveLeadPath(lead, path) {
  // Supports e.g. "contact.firstName", "travel.destinations.0", "custom.foo"
  const parts = path.split('.');
  let cur = lead;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}
