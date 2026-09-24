/**
 * The record of every ATOL certificate issued, and where its date of issue
 * comes from (24 Sep 2026).
 *
 * A certificate is produced fresh each time it is opened, emailed or attached,
 * from the booking as it stands. What it says is fingerprinted into its
 * reference (api/_lib/atol-certificate.js), so the same details always give the
 * same reference and changed details a new one: that is the CAA's rule, a new
 * certificate "each time any of the details on the booking changes".
 *
 * What a fresh render cannot know is WHEN that certificate was first issued.
 * Printing today's date on every download would date a certificate the
 * customer was given in June as if it were issued this morning. So the first
 * time a reference is issued it is written here with the day it was issued,
 * and every later copy reads that day back.
 *
 * It is also the client's register. An agent can be asked by the CAA for "the
 * unique reference number of each ATOL Certificate supplied by it along with
 * the corresponding Principal's reference number"; this table is that list.
 * No passenger names are stored: the reference, the booking reference, the
 * type, the count and the protected cost.
 *
 * Never fatal. If Airtable cannot be reached the certificate is still issued,
 * dated today, and the miss is logged: a customer who needs their certificate
 * gets it.
 *
 * Table: ATOL Certificates (tblnoLpQhP9G1cHDG) in the widgets base.
 */
import { sanitiseForFormula } from '../_auth.js';

const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID || 'appAYzWZxvK6qlwXK';
export const ATOL_LOG_TABLE = 'tblnoLpQhP9G1cHDG';
export const ATOL_LOG_FIELDS = {
  reference: 'fldLec5aI5DHuN6Oi',
  orderRef: 'fldh35sKZsQWrHBCd',
  widgetId: 'fldMQjDBTUojrO62y',
  clientRecordId: 'fldhr2IBH68RcdbWW',
  type: 'fld7wLE1789SBAFkd',
  issuedOn: 'fldOs6YD8lsoPGio7',
  passengers: 'fldIqVplp4fj2SSjk',
  protectedCost: 'fldEFJYKxoSjF0FLS',
  currency: 'fldrHPuzEoQyjV0VW',
  atolNumber: 'fldhqdll5iOCaTexT',
};

/** Today's calendar date in the UK, as YYYY-MM-DD. */
export function ukToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const asDate = (ymd) => new Date(ymd + 'T00:00:00Z');   // a calendar date: read its UTC fields

/**
 * The date of issue for this certificate: the day it was first issued if it
 * has been before, otherwise today (and it is recorded as issued today).
 *   returns { issuedOn: Date, logged: 'found' | 'created' | 'unavailable' }
 */
export async function atolIssueDate(model, { widgetId, clientRecordId = '', orderRef = '', now = new Date(), fetchImpl = fetch } = {}) {
  const today = ukToday(now);
  const key = process.env.AIRTABLE_KEY;
  if (!key || !model || !model.reference || !widgetId) return { issuedOn: asDate(today), logged: 'unavailable' };
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${ATOL_LOG_TABLE}`;
  const F = ATOL_LOG_FIELDS;
  try {
    const formula = `AND({Reference}='${sanitiseForFormula(model.reference)}',{WidgetId}='${sanitiseForFormula(widgetId)}')`;
    const q = `${url}?maxRecords=1&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(formula)}`
      + `&sort%5B0%5D%5Bfield%5D=${F.issuedOn}&sort%5B0%5D%5Bdirection%5D=asc`;
    const r = await fetchImpl(q, { headers, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('lookup ' + r.status);
    const found = ((await r.json()).records || [])[0];
    const day = found && found.fields && found.fields[F.issuedOn];
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return { issuedOn: asDate(day), logged: 'found' };

    const fields = {
      [F.reference]: model.reference,
      [F.orderRef]: String(orderRef || '').slice(0, 60),
      [F.widgetId]: widgetId,
      [F.clientRecordId]: String(clientRecordId || '').slice(0, 40),
      [F.type]: model.typeLabel,
      [F.issuedOn]: today,
      [F.passengers]: model.passengers,
      [F.atolNumber]: model.atolNumber,
    };
    if (typeof model.costAmount === 'number') { fields[F.protectedCost] = model.costAmount; fields[F.currency] = model.currency; }
    const c = await fetchImpl(url, {
      method: 'POST', headers, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });
    if (!c.ok) throw new Error('create ' + c.status);
    return { issuedOn: asDate(today), logged: 'created' };
  } catch (err) {
    console.warn('[atol-issue-log] could not read or write the register, certificate dated today:', err && err.message);
    return { issuedOn: asDate(today), logged: 'unavailable' };
  }
}
