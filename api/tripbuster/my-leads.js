/**
 * Tripbuster agency leads inbox
 *
 *   GET   /api/tripbuster/my-leads             → this agency's callback requests
 *   PATCH /api/tripbuster/my-leads?id=<uuid>   → mark what came of one
 *
 * The other side of the callback form. An agency sees who asked to be rung, on
 * which deal, and marks the outcome: contacted, booked, not interested, or junk.
 *
 * That outcome is not decoration. It is what turns a pile of enquiries into
 * quality data, and it is what settles a disagreement about a bill: "you owe us
 * for 40 enquiries" is arguable, "here are 40 names and numbers, 31 of which you
 * marked contacted" is not.
 *
 * Scoped to the agency in the bearer token. Every read and write filters on
 * agent_id as well as id, so a valid session plus a guessed lead id returns 404,
 * exactly as a lead that does not exist would.
 *
 * No CORS headers deliberately: authenticated surface, same-origin only.
 */
import { requireAgent } from '../_lib/tripbuster/auth.js';
import { tbConfigured, tbSelect, tbUpdate, tbRpc } from '../_lib/tripbuster/db.js';
import { LEAD_STATUSES } from '../_lib/tripbuster/lead-schema.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Explicit, so a column added later cannot leak by accident. The visitor
// columns (ip_hash, ua_family, referrer_host) are deliberately absent: they
// exist for de-duplication and abuse detection, and are none of the agency's
// business.
const LEAD_COLUMNS = [
  'id', 'deal_id', 'deal_title', 'name', 'phone', 'email', 'message',
  'preferred_time', 'status', 'agent_note', 'contacted_at', 'created_at',
].join(',');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const gate = requireAgent(req);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
  if (!tbConfigured()) return res.status(503).json({ error: 'Deals service is not configured yet' });

  const agentId = gate.agent.agentId;
  const id = typeof req.query?.id === 'string' ? req.query.id : '';

  try {
    if (req.method === 'GET') {
      const status = typeof req.query?.status === 'string' ? req.query.status : '';
      const params = {
        select: LEAD_COLUMNS,
        agent_id: `eq.${agentId}`,
        order: 'created_at.desc',
        limit: 200,
      };
      // Only a real status may filter. An unrecognised one is ignored rather
      // than passed through, so it cannot become a filter we did not intend.
      if (LEAD_STATUSES.includes(status)) params.status = `eq.${status}`;

      const [leads, counts] = await Promise.all([
        tbSelect('leads', params),
        tbRpc('tb_agent_lead_counts', { p_agent_id: agentId }).catch((e) => {
          console.warn('[tripbuster/my-leads] counts unavailable', e && (e.code || e.message));
          return null;
        }),
      ]);

      return res.status(200).json({
        leads: Array.isArray(leads) ? leads : [],
        counts,
        statuses: LEAD_STATUSES,
      });
    }

    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, PATCH');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Which enquiry? A valid id is required' });

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const patch = {};

    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      if (!LEAD_STATUSES.includes(body.status)) {
        return res.status(422).json({
          error: 'Some details need fixing',
          errors: [{ field: 'status', message: `Choose one of: ${LEAD_STATUSES.join(', ')}` }],
        });
      }
      patch.status = body.status;
      // Stamped the first time it leaves 'new', so "how quickly did they get
      // back to me" is answerable later without a separate audit trail.
      if (body.status !== 'new') patch.contacted_at = new Date().toISOString();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'note')) {
      const note = typeof body.note === 'string'
        ? body.note.replace(/\s+/g, ' ').trim().slice(0, 1000)
        : '';
      patch.agent_note = note || null;
    }

    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });

    // agent_id in the filter is what stops one agency reading or editing
    // another's enquiries, which matter more than most rows here because they
    // contain someone's phone number.
    const updated = await tbUpdate('leads', { id: `eq.${id}`, agent_id: `eq.${agentId}` }, patch);
    const row = Array.isArray(updated) && updated[0] ? updated[0] : null;
    // Same answer whether it is missing or someone else's. Nothing to probe.
    if (!row) return res.status(404).json({ error: 'Enquiry not found' });

    return res.status(200).json({ id: row.id, status: row.status, agentNote: row.agent_note || '' });
  } catch (e) {
    console.error('[tripbuster/my-leads] failed', req.method, e && e.code, e && e.message);
    return res.status(502).json({ error: 'Could not load your enquiries just now. Try again.' });
  }
}
