/**
 * How many widgets of each type a client actually has.
 *
 * Extracted from /api/v1/.../my-widgets.js on 17 Sep 2026 because the SSO deep
 * link needed the same answer: a client who already has widgets of the type
 * Travelify linked to should be offered the ones they have, not dropped into a
 * blank editor (Andy, from user feedback).
 *
 * The scope rule is the one the client's own dashboard uses
 * (buildScopeFormula, exported from /api/widget-list.js), including their
 * LEGACY widgets, which predate the ClientRecordId owner field and are matched
 * on email instead. Roughly a quarter of all widgets are legacy, so a count
 * that skipped them would disagree with what the client sees on their own
 * dashboard — which is the whole reason this is shared rather than restated.
 */
import { widgetForAirtableType } from './widget-view.js';
import { buildScopeFormula } from '../../widget-list.js';
import { isStaffEmail } from '../auth/staff.js';
import { listRecords } from '../auth/airtable.js';
import { CLIENTS } from '../auth/schema.js';
import { sanitiseForFormula } from '../../_auth.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const TABLE_NAME = 'Widgets';
const baseId = () => process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';

// Safety ceiling, matching /api/widget-list. Our largest account is nowhere
// near this; it only stops a pathological row count paging forever.
export const MAX_WIDGETS = 1000;

/**
 * Would this client's login email pull in another account's legacy widgets?
 *
 * The legacy fallback (blank ClientRecordId, matched on email) is only safe
 * when the email identifies exactly one client. A staff address never does,
 * and neither does one reused across two accounts.
 */
export async function emailIsAmbiguous(clientId, email, label = 'client-widget-counts') {
  if (!email) return true;
  if (isStaffEmail(email)) return true;
  try {
    const rows = await listRecords(CLIENTS.tableId, {
      formula: `LOWER({Email})='${sanitiseForFormula(email)}'`,
      maxRecords: 5,
    });
    return (rows || []).some((r) => r.id !== clientId);
  } catch (err) {
    // Fail closed: drop the legacy fallback rather than risk counting another
    // client's widgets into this one's total.
    console.warn(`[v1] ${label} shared-email check failed:`, err && err.message);
    return true;
  }
}

/** Every widget row in scope, reading just the type column. */
export async function fetchWidgetTypes(formula) {
  const types = [];
  let offset;
  do {
    const params = new URLSearchParams();
    params.set('filterByFormula', formula);
    params.set('pageSize', '100');
    params.append('fields[]', 'WidgetType');
    if (offset) params.set('offset', offset);

    const resp = await fetch(`${AIRTABLE_API}/${baseId()}/${TABLE_NAME}?${params}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_KEY}` },
    });
    if (!resp.ok) throw new Error(`Airtable read failed (${resp.status})`);

    const data = await resp.json();
    for (const rec of data.records || []) types.push(rec.fields?.WidgetType || '');
    offset = data.offset;
  } while (offset && types.length < MAX_WIDGETS);
  return types;
}

/**
 * Map of registry widget id → how many the client has.
 *
 * A row whose Airtable type is not in the registry (retired, or renamed in
 * Airtable) is left out rather than counted under a guess.
 */
export async function countWidgetsByType(client, label) {
  const email = String(client?.fields?.[CLIENTS.fields.email] || '').trim().toLowerCase();
  const emailShared = await emailIsAmbiguous(client.id, email, label);

  const formula = buildScopeFormula({
    activeClientId: client.id,
    activeClientEmail: email,
    emailShared,
    userEmailLower: '',
    selfScope: false,
  });

  const counts = new Map();
  for (const type of await fetchWidgetTypes(formula)) {
    const widget = widgetForAirtableType(type);
    if (!widget) continue;
    counts.set(widget.id, (counts.get(widget.id) || 0) + 1);
  }
  return counts;
}
