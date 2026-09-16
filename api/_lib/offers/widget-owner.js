/**
 * WHOSE TRAVELIFY ACCOUNT DOES THIS WIDGET SEARCH UNDER?
 *
 * A widget belongs to a CLIENT, not to whoever is signed in looking at it.
 * Andy, 16 Sep 2026: "When acting as it needs to use the owner of the App — in
 * this case MT Holidays."
 *
 * That is not a preference, it is the only answer that works. Every other part
 * of this product already resolves the owner from the widget's own
 * ClientRecordId:
 *
 *   - api/widget-config.js injects config.appId from it when serving a widget
 *   - api/cron/refresh-tti-offers.js sweeps under it, nightly
 *   - the cache key is offers:tti:{appId}:{code}
 *
 * So a Test button that searched under the SESSION's account instead would
 * write to a key the live widget never reads: the agent sees a price, the site
 * shows nothing, and the panel says the cache write did not land. It would also
 * quietly price the offer at the wrong client's contracted rates, which is a
 * commercial error rather than a cosmetic one.
 *
 * PERMISSION IS CHECKED, NOT ASSUMED. Resolving by widget id means the widget
 * id decides which credentials get used, so the caller must be entitled to that
 * widget or anyone could spend another client's Travelify capacity and read
 * their rates. canModifyWidget is the same rule the save path enforces, reused
 * rather than reimplemented — two ownership rules is one ownership rule and a
 * bug waiting to be found.
 */

import { sanitiseForFormula, lookupClientCredentialsByRecordId, lookupClientCredentialsByEmail } from '../../_auth.js';
import { canModifyWidget } from '../../widget-config.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
// The same base, table and credentials api/widget-config.js uses — this reads
// the record that endpoint writes, so a different spelling would read a
// different world. AIRTABLE_PAT is the cron's name for the same key.
const TABLE_NAME = 'Widgets';

/** The widget record behind a public tgw_ id.
 *
 *  Returns the record, or null when there is genuinely no such widget. THROWS
 *  when the lookup could not be made at all: "we could not ask" and "the answer
 *  is no" must not collapse into one value here, because the caller's fallback
 *  for "no widget" is the session's own account — and silently searching under
 *  the wrong client is precisely the bug this module exists to prevent. */
async function findWidget(widgetId) {
  const key = process.env.AIRTABLE_KEY || process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!key || !baseId) throw new Error('Airtable not configured');
  const formula = encodeURIComponent(`{WidgetID} = '${sanitiseForFormula(String(widgetId))}'`);
  const url = `${AIRTABLE_API}/${baseId}/${TABLE_NAME}?filterByFormula=${formula}&maxRecords=1`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Airtable HTTP ${r.status}`);
  const data = await r.json();
  return (data.records && data.records[0]) || null;
}

/**
 * Credentials to search with, and who they belong to.
 *
 *   { creds, owner, source }        searched under a real account
 *   { error }                       the caller may not act for this widget
 *
 * `source` is 'widget' when the widget named its owner and 'session' when there
 * is no widget yet — a brand-new one being set up before its first save, which
 * can only belong to the account creating it. The caller reports which, because
 * "this searched as somebody else" is exactly the thing an agent needs told.
 */
export async function credentialsForWidget({ widgetId, user }) {
  const id = String(widgetId || '').trim();
  if (/^tgw_[A-Za-z0-9_-]{4,64}$/.test(id)) {
    let record;
    try {
      record = await findWidget(id);
    } catch (e) {
      // Could not ask. Refuse rather than fall through to the session, which
      // would search under the wrong client and cache to a key this widget
      // never reads.
      console.error('[offers/widget-owner] lookup failed:', e && e.message);
      return { error: 'We could not check which account this widget belongs to. Try again in a moment.' };
    }
    if (record) {
      const allowed = canModifyWidget(record, {
        sessionClientId: user.clientId || null,
        userEmail: user.email || '',
      });
      if (allowed !== true) {
        return { error: typeof allowed === 'string' ? allowed : 'You do not have access to this widget.' };
      }
      const f = record.fields || {};
      const clientRecordId = String(f.ClientRecordId || '').trim();
      const clientEmail = String(f.ClientEmail || '').toLowerCase().trim();
      const creds = (clientRecordId ? await lookupClientCredentialsByRecordId(clientRecordId) : null)
                 || (clientEmail ? await lookupClientCredentialsByEmail(clientEmail) : null);
      if (creds) {
        return {
          creds,
          source: 'widget',
          owner: String(f.ClientName || f['Client Name'] || clientEmail || '').trim() || null,
        };
      }
      // The widget names an owner whose account has no Travelify application.
      // Falling back to the SESSION here would search under the wrong client
      // and cache to a key this widget cannot read, so it is refused instead.
      return { error: 'That widget\'s account has no Travelify application connected, '
                    + 'so there is nothing to search against.' };
    }
  }

  // No saved widget yet: a new one being set up belongs to whoever is making it.
  const creds = (user.clientId ? await lookupClientCredentialsByRecordId(user.clientId) : null)
             || (user.email ? await lookupClientCredentialsByEmail(user.email) : null);
  return creds ? { creds, source: 'session', owner: null } : { error: null, creds: null };
}
