// =============================================================================
//  /api/_lib/destinations/brevo.js
// =============================================================================
//
//  Adds (or updates) a contact in Brevo (formerly Sendinblue) and assigns
//  them to one or more lists.
//
//  Brevo's POST /v3/contacts endpoint with updateEnabled=true is the upsert.
//  Single round-trip — the contact is created if missing, updated if present,
//  and added to listIds in the same call.
//
//  Auth: header `api-key: <key>`
//
//  Credentials shape:
//    { apiKey: "xkeysib-..." }
//
//  Config shape:
//    {
//      listIds: [4],                       // required, integers
//      attributes: { COUNTRY: "UK" }       // optional pass-through; UPPERCASE keys
//    }
//
//  Docs: https://developers.brevo.com/reference/createcontact
// =============================================================================

export async function dispatchBrevo(lead, job) {
  const { credentials = {}, config = {} } = job;

  if (!credentials.apiKey) throw new Error('Brevo credentials missing apiKey');
  if (!Array.isArray(config.listIds) || config.listIds.length === 0) {
    throw new Error('Brevo config missing listIds');
  }
  // Brevo list IDs are integers — cast and validate
  const listIds = config.listIds
    .map(n => Number(n))
    .filter(n => Number.isInteger(n) && n > 0);
  if (listIds.length === 0) throw new Error('Brevo listIds must be positive integers');

  // Brevo attribute names are UPPERCASE
  const attributes = {};
  if (lead.contact.firstName) attributes.FIRSTNAME = lead.contact.firstName;
  if (lead.contact.lastName)  attributes.LASTNAME = lead.contact.lastName;
  if (lead.contact.phone)     attributes.SMS = normalisePhoneForBrevo(lead.contact.phone);
  // Config-level attributes (templated or literal)
  if (config.attributes && typeof config.attributes === 'object') {
    for (const [k, v] of Object.entries(config.attributes)) {
      if (typeof v === 'string' && v.startsWith('{{') && v.endsWith('}}')) {
        const val = resolveLeadPath(lead, v.slice(2, -2).trim());
        if (val != null) attributes[k.toUpperCase()] = stringifyForBrevo(val);
      } else if (v != null) {
        attributes[k.toUpperCase()] = stringifyForBrevo(v);
      }
    }
  }

  const body = {
    email: lead.contact.email,
    listIds,
    updateEnabled: true,
  };
  if (Object.keys(attributes).length > 0) body.attributes = attributes;

  const url = 'https://api.brevo.com/v3/contacts';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': credentials.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseBody = await resp.text();

  // Brevo returns 204 No Content if the contact exists and is updated, or 201
  // with the new contact ID. Both are success.
  if (!resp.ok) {
    const err = new Error(`Brevo ${resp.status}: ${responseBody.slice(0, 300)}`);
    err.statusCode = resp.status;
    throw err;
  }

  return {
    statusCode: resp.status,
    requestPayload: { url, method: 'POST', body: redactBody(body) },
    responseBody: (responseBody || '(empty)').slice(0, 2000),
  };
}

// Brevo phone numbers go in attributes.SMS in international format with country code
function normalisePhoneForBrevo(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, '');
  // If it doesn't start with + or country code, leave as-is — let Brevo decide
  return cleaned;
}

function stringifyForBrevo(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v;
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
