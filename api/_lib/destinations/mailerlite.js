// =============================================================================
//  /api/_lib/destinations/mailerlite.js
// =============================================================================
//
//  Adds (or updates) a subscriber in MailerLite and assigns them to groups.
//
//  POST /api/subscribers is upsert by default — if the subscriber already
//  exists, their fields and groups are updated non-destructively.
//
//  Auth: header `Authorization: Bearer <apiKey>`
//
//  Credentials shape:
//    { apiKey: "ml_..." }
//
//  Config shape:
//    {
//      groups: ["123456789"],            // optional; group IDs as strings
//      fields: { CITY: "{{custom.city}}" } // optional; lowercase MailerLite field keys
//    }
//
//  Docs: https://developers.mailerlite.com/docs/subscribers#create-or-update-a-subscriber
// =============================================================================

export async function dispatchMailerlite(lead, job) {
  const { credentials = {}, config = {} } = job;

  if (!credentials.apiKey) throw new Error('MailerLite credentials missing apiKey');

  // MailerLite uses lowercase field keys (name, last_name, phone, etc)
  const fields = {};
  if (lead.contact.firstName) fields.name = lead.contact.firstName;
  if (lead.contact.lastName)  fields.last_name = lead.contact.lastName;
  if (lead.contact.phone)     fields.phone = lead.contact.phone;
  if (config.fields && typeof config.fields === 'object') {
    for (const [k, v] of Object.entries(config.fields)) {
      if (typeof v === 'string' && v.startsWith('{{') && v.endsWith('}}')) {
        const val = resolveLeadPath(lead, v.slice(2, -2).trim());
        if (val != null) fields[k.toLowerCase()] = stringify(val);
      } else if (v != null) {
        fields[k.toLowerCase()] = stringify(v);
      }
    }
  }

  // Group IDs must be strings
  let groups = [];
  if (Array.isArray(config.groups)) {
    groups = config.groups.map(g => String(g)).filter(Boolean);
  }

  const body = {
    email: lead.contact.email,
  };
  if (Object.keys(fields).length > 0) body.fields = fields;
  if (groups.length > 0) body.groups = groups;

  const url = 'https://connect.mailerlite.com/api/subscribers';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${credentials.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseBody = await resp.text();
  if (!resp.ok) {
    const err = new Error(`MailerLite ${resp.status}: ${responseBody.slice(0, 300)}`);
    err.statusCode = resp.status;
    throw err;
  }

  return {
    statusCode: resp.status,
    requestPayload: { url, method: 'POST', body: redactBody(body) },
    responseBody: responseBody.slice(0, 2000),
  };
}

function stringify(v) {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  return String(v);
}

function redactBody(body) {
  if (!body || !body.email) return body;
  const e = body.email;
  return { ...body, email: e.replace(/^(.).*(@.*)$/, '$1***$2') };
}

function resolveLeadPath(lead, path) {
  const parts = path.split('.');
  let cur = lead;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}
