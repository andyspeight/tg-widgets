/**
 * GET /api/tti-appid — the signed-in account's own Travelify App ID.
 *
 * The TTI Offers editor needs it before it can preview anything. The per
 * property cache is keyed `offers:tti:{appId}:{code}`, so an editor previewing
 * against the wrong App ID reads an empty pool and shows nothing — or worse,
 * reads a pool that is not this client's.
 *
 * It existed as a hardcoded '250' (the published demo application) copied from
 * the plain Offers editor, where it is harmless because that cache is keyed by
 * COUNTRY and the App ID is never part of the key. Here it is part of the key,
 * so the copy was silently pointing every client's preview at the demo pool.
 *
 * ONLY the App ID. The API key is a secret and never leaves the server; the App
 * ID is already public — it appears in every deeplink and in the embed config
 * on the client's own site — so returning it to its owner discloses nothing.
 */

import { requireAuth, setCors } from './_auth.js';
import { credentialsForWidget } from './_lib/offers/widget-owner.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }

  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user || {};

  // The widget's OWNER, matching api/tti-test.js and the live widget. If the
  // preview resolved a different App ID from the one the test wrote under, it
  // would read an empty pool and report that the cache write did not land —
  // about a write that landed perfectly.
  const resolved = await credentialsForWidget({
    widgetId: (req.query && req.query.widgetId) || '', user,
  });
  if (resolved.error) return res.status(403).json({ error: resolved.error });
  const creds = resolved.creds;

  // Never cached: an account's credentials can be connected mid-session, and a
  // stale miss here would leave the editor previewing the wrong pool until a
  // reload nobody knows to do.
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    appId: creds && creds.appId ? String(creds.appId) : '',
    connected: !!(creds && creds.appId),
  });
}
