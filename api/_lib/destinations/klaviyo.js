// =============================================================================
//  /api/_lib/destinations/klaviyo.js
// =============================================================================
//
//  Subscribes a profile to a Klaviyo list with explicit email-marketing consent.
//
//  Klaviyo's modern API uses a JSON-API style payload. We use the bulk
//  Subscribe Profiles endpoint with a single profile — this is the right
//  endpoint when the user has just given consent (e.g. ticked a marketing
//  checkbox on a newsletter form).
//
//  Auth: header `Authorization: Klaviyo-API-Key <pk>`
//        + `revision: 2025-01-15` (Klaviyo's date-based versioning)
//
//  Credentials shape:
//    { apiKey: "pk_..." }
//
//  Config shape:
//    {
//      listId: "Y6nRLr",                     // required, Klaviyo list ID
//      properties: { Source: "{{source.widget}}" }  // optional custom properties
//    }
//
//  Docs: https://developers.klaviyo.com/en/reference/bulk_subscribe_profiles
// =============================================================================

const KLAVIYO_API_REVISION = '2025-01-15';

export async function dispatchKlaviyo(lead, job) {
  const { credentials = {}, config = {} } = job;

  if (!credentials.apiKey) throw new Error('Klaviyo credentials missing apiKey');
  if (!config.listId) throw new Error('Klaviyo config missing listId');

  // Build profile attributes
  const profileAttributes = {
    email: lead.contact.email,
    subscriptions: {
      email: { marketing: { consent: 'SUBSCRIBED' } },
    },
  };

  // Custom properties (resolved via templating)
  const properties = {};
  if (config.properties && typeof config.properties === 'object') {
    for (const [k, v] of Object.entries(config.properties)) {
      if (typeof v === 'string' && v.startsWith('{{') && v.endsWith('}}')) {
        const val = resolveLeadPath(lead, v.slice(2, -2).trim());
        if (val != null) properties[k] = val;
      } else if (v != null) {
        properties[k] = v;
      }
    }
  }
  if (Object.keys(properties).length > 0) profileAttributes.properties = properties;

  // The JSON-API payload Klaviyo expects
  const body = {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        profiles: {
          data: [
            {
              type: 'profile',
              attributes: {
                ...profileAttributes,
                ...(lead.contact.firstName ? { first_name: lead.contact.firstName } : {}),
                ...(lead.contact.lastName ? { last_name: lead.contact.lastName } : {}),
                ...(lead.contact.phone ? { phone_number: lead.contact.phone } : {}),
              },
            },
          ],
        },
        custom_source: 'Travelgenix Widget',
      },
      relationships: {
        list: {
          data: { type: 'list', id: config.listId },
        },
      },
    },
  };

  const url = 'https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Klaviyo-API-Key ${credentials.apiKey}`,
      'revision': KLAVIYO_API_REVISION,
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
    },
    body: JSON.stringify(body),
  });

  const responseBody = await resp.text();

  // Klaviyo returns 202 Accepted on success (job queued)
  if (!resp.ok) {
    const err = new Error(`Klaviyo ${resp.status}: ${responseBody.slice(0, 300)}`);
    err.statusCode = resp.status;
    throw err;
  }

  return {
    statusCode: resp.status,
    requestPayload: { url, method: 'POST', body: redactBody(body) },
    responseBody: (responseBody || '(empty)').slice(0, 2000),
  };
}

function redactBody(body) {
  // Deep redact emails inside the JSON-API structure
  try {
    const cloned = JSON.parse(JSON.stringify(body));
    const profiles = cloned?.data?.attributes?.profiles?.data;
    if (Array.isArray(profiles)) {
      for (const p of profiles) {
        if (p?.attributes?.email) {
          p.attributes.email = p.attributes.email.replace(/^(.).*(@.*)$/, '$1***$2');
        }
      }
    }
    return cloned;
  } catch {
    return body;
  }
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
