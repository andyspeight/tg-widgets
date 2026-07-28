/**
 * Tripbuster agency settings
 *
 *   GET   /api/tripbuster/account  → the settings this agency can change
 *   PATCH /api/tripbuster/account  → change them
 *
 * Deliberately narrow. This is not a general profile editor: it covers how an
 * agency gets charged, the numbers a call-first deal rings, and when they are
 * open to answer them. Nothing here is cosmetic — each field changes what a
 * traveller is offered or what the agency is billed for.
 *
 * Everything else on the agents row (plan, status, ATOL, slug, the Travelgenix
 * link) is deliberately NOT editable here. Those are commercial or identity
 * facts that belong to us, not to the agency, and a settings screen is exactly
 * where a plan would otherwise get quietly upgraded.
 *
 * The agency is taken from the bearer token and never from the body.
 *
 * WRITES GO THROUGH ONE RPC. Hours, special days and extra numbers are whole
 * collections, and replacing them from here would mean a delete and an insert
 * with a gap in between — during which an agency on scheduled hours has none,
 * which reads as permanently closed. tb_save_agent_settings does the lot in one
 * transaction.
 *
 * No CORS headers deliberately: authenticated surface, same-origin only.
 */

import { requireAgent } from '../_lib/tripbuster/auth.js';
import { tbConfigured, tbSelect, tbUpdate, tbRpc } from '../_lib/tripbuster/db.js';
import { AGENT_WRITE_COLUMNS, LIVE_DEAL_LIMITS } from '../_lib/tripbuster/deal-write.js';
import { validateSchedule } from '../_lib/tripbuster/hours.js';
import { isValidEmail } from '../_lib/sendgrid.js';

const BILLING_MODES = ['click', 'call', 'both'];

/**
 * Tidy a phone number without being precious about the format.
 *
 * Spacing is DELIBERATELY preserved: "0141 555 907" reads far better on a deal
 * card than "0141555907", and this number is shown to travellers.
 *
 * Returns null to clear the number, undefined when the input is not usable.
 */
function cleanPhone(value) {
  if (typeof value !== 'string') return undefined;
  const s = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  if (!s) return null; // clearing the number is allowed
  // Starts with a digit, a plus or an opening bracket, then the digits and
  // punctuation real numbers use. Nothing else.
  return /^[+(\d][\d\s()+.-]{5,}$/.test(s) ? s : undefined;
}

/** Echo back what the notification settings became, for the screen to redraw from. */
function describeNotify(notify) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(notify, 'notify_leads')) out.notifyLeads = notify.notify_leads;
  if (Object.prototype.hasOwnProperty.call(notify, 'notify_email')) out.notifyEmail = notify.notify_email || '';
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const gate = requireAgent(req);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
  if (!tbConfigured()) return res.status(503).json({ error: 'Deals service is not configured yet' });

  const agentId = gate.agent.agentId;

  try {
    if (req.method === 'GET') {
      const [rows, byMode, contact] = await Promise.all([
        tbSelect('agents', {
          select: `${AGENT_WRITE_COLUMNS},email,notify_leads,notify_email,`
            + 'about,town,region,website,founded_year',
          id: `eq.${agentId}`,
          limit: 1,
        }),
        tbRpc('tb_agent_billing_counts', { p_agent_id: agentId }).catch(() => null),
        tbRpc('tb_agent_contact', { p_agent_id: agentId }).catch(() => null),
      ]);
      const agent = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!agent) return res.status(401).json({ error: 'Sign in again to continue' });

      return res.status(200).json({
        // The schedule and every number, in exactly the shape the consumer site
        // receives, so the editor previews what a traveller will actually see
        // rather than a second interpretation of it.
        contact,
        name: agent.name,
        slug: agent.slug,
        plan: agent.plan,
        liveAllowance: Object.prototype.hasOwnProperty.call(LIVE_DEAL_LIMITS, agent.plan)
          ? LIVE_DEAL_LIMITS[agent.plan] : 0,
        billingMode: agent.billing_mode || 'click',
        callMinSeconds: agent.call_min_seconds ?? 60,
        phone: agent.phone || '',
        defaultClickoutUrl: agent.default_clickout_url || '',
        protectionType: agent.protection_type || '',
        atolNumber: agent.atol_number || '',
        travelgenixClient: !!agent.tg_client_email,
        // Their own public profile. Editable because it is theirs to say;
        // protection numbers and plan stay out, because those are ours to verify.
        about: agent.about || '',
        town: agent.town || '',
        region: agent.region || '',
        website: agent.website || '',
        foundedYear: agent.founded_year || '',
        // Where an enquiry lands. notifyEmail empty means "use the sign-in
        // address", which is why the sign-in address is sent alongside it —
        // the screen can show what will actually be used rather than a blank box.
        notifyLeads: agent.notify_leads !== false,
        notifyEmail: agent.notify_email || '',
        signInEmail: agent.email || '',
        // How the agency's deals actually resolve, so the screen can say
        // "8 of your deals override this" rather than leaving it a mystery.
        dealsByMode: byMode,
      });
    }

    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, PATCH');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const patch = {};
    // Kept apart from `patch` because these two are plain scalar columns with no
    // collection semantics, so they do not need — and are not worth widening —
    // the all-or-nothing RPC that exists to protect the weekly schedule.
    const notify = {};
    // Same treatment as the notification settings: plain columns with no
    // collection semantics, so they do not need the all-or-nothing RPC.
    const profile = {};
    const errors = [];

    // Read the row FIRST. Two rules need to know what is already stored rather
    // than only what was submitted: charging for calls needs a number from
    // somewhere, and an empty week needs refusing for an agency that is already
    // on scheduled hours and did not resend the mode.
    const currentRows = await tbSelect('agents', {
      select: 'phone,hours_mode', id: `eq.${agentId}`, limit: 1,
    });
    const current = Array.isArray(currentRows) && currentRows[0] ? currentRows[0] : null;
    if (!current) return res.status(401).json({ error: 'Sign in again to continue' });

    if (Object.prototype.hasOwnProperty.call(body, 'billingMode')) {
      if (!BILLING_MODES.includes(body.billingMode)) {
        errors.push({ field: 'billingMode', message: 'Choose click, call, or both' });
      } else {
        patch.billing_mode = body.billingMode;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'callMinSeconds')) {
      const n = Number(body.callMinSeconds);
      if (!Number.isFinite(n) || n < 0 || n > 600) {
        errors.push({ field: 'callMinSeconds', message: 'Set between 0 and 600 seconds' });
      } else {
        patch.call_min_seconds = Math.round(n);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
      const phone = cleanPhone(body.phone);
      if (phone === undefined) {
        errors.push({ field: 'phone', message: 'That does not look like a phone number' });
      } else {
        patch.phone = phone;
      }
    }

    // ── the public profile ──────────────────────────────────────────────
    // Widened deliberately and narrowly. An agency may say who it is, where it
    // is and how long it has been trading. It still may NOT touch its plan, its
    // status, its ATOL number or its rate tier — those are facts we verify or
    // sell, not claims an agency gets to make about itself on a settings screen.
    if (Object.prototype.hasOwnProperty.call(body, 'about')) {
      const about = typeof body.about === 'string' ? body.about.trim().slice(0, 1200) : '';
      // Plain text on purpose. It is rendered by a page that escapes everything,
      // and offering markup would mean either trusting it or writing a sanitiser
      // for the sake of one paragraph.
      profile.about = about || null;
    }
    ['town', 'region'].forEach((f) => {
      if (Object.prototype.hasOwnProperty.call(body, f)) {
        const v = typeof body[f] === 'string' ? body[f].trim().slice(0, 80) : '';
        profile[f] = v || null;
      }
    });
    if (Object.prototype.hasOwnProperty.call(body, 'website')) {
      const raw = typeof body.website === 'string' ? body.website.trim().slice(0, 200) : '';
      if (!raw) {
        profile.website = null;
      } else {
        const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        try {
          const u = new URL(withScheme);
          if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.')) {
            throw new Error('bad');
          }
          profile.website = u.toString();
        } catch {
          errors.push({ field: 'website', message: 'That website address does not look right' });
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'foundedYear')) {
      const raw = body.foundedYear;
      if (raw === '' || raw === null) {
        profile.founded_year = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1800 || n > new Date().getFullYear()) {
          errors.push({ field: 'foundedYear', message: 'Use a year like 1998' });
        } else {
          profile.founded_year = n;
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'notifyLeads')) {
      if (typeof body.notifyLeads !== 'boolean') {
        errors.push({ field: 'notifyLeads', message: 'Choose whether to be emailed about enquiries' });
      } else {
        notify.notify_leads = body.notifyLeads;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'notifyEmail')) {
      const raw = typeof body.notifyEmail === 'string' ? body.notifyEmail.trim().slice(0, 200) : '';
      if (!raw) {
        // Cleared, which means fall back to the sign-in address rather than stop
        // sending. Turning notifications off is a separate, deliberate switch.
        notify.notify_email = null;
      } else if (!isValidEmail(raw)) {
        errors.push({ field: 'notifyEmail', message: 'That email address does not look right' });
      } else {
        notify.notify_email = raw.toLowerCase();
      }
    }

    // Hours, special days and extra numbers. The validator is told the mode the
    // agency will END UP on — the submitted one if they changed it, otherwise the
    // stored one — so clearing every day is refused whether or not the mode came
    // along for the ride.
    const schedule = validateSchedule({
      ...body,
      currentHoursMode: Object.prototype.hasOwnProperty.call(body, 'hoursMode')
        ? body.hoursMode : current.hours_mode,
    });
    errors.push(...schedule.errors);
    Object.assign(patch, schedule.clean);

    if (errors.length) return res.status(422).json({ error: 'Some details need fixing', errors });
    Object.assign(notify, profile);
    if (!Object.keys(patch).length && !Object.keys(notify).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    // Switching to call without a number to ring would take every call-first deal
    // off the site the moment it was saved. Caught here with a sentence the agency
    // can act on, rather than leaving them to work out why their deals vanished.
    const wantsCalls = patch.billing_mode === 'call' || patch.billing_mode === 'both';
    const phoneAfter = patch.phone !== undefined ? patch.phone : current.phone;
    if (wantsCalls && !phoneAfter) {
      return res.status(422).json({
        error: 'Some details need fixing',
        errors: [{ field: 'phone', message: 'Add a phone number before charging for calls' }],
      });
    }

    if (!Object.keys(patch).length) {
      // Only the notification settings changed. Nothing needs the transaction.
      await tbUpdate('agents', { id: `eq.${agentId}` }, notify, { returning: false });
      return res.status(200).json({ saved: true, ...describeNotify(notify) });
    }

    // One transaction, so a failed save can never leave an agency on scheduled
    // hours with no hours — which would read as closed and swap every call
    // button for a callback form until somebody noticed.
    const saved = await tbRpc('tb_save_agent_settings', {
      p_agent_id: agentId,
      p_billing_mode: patch.billing_mode ?? null,
      p_call_min_seconds: patch.call_min_seconds ?? null,
      // null already means "leave alone", so clearing needs its own flag.
      p_phone: patch.phone ?? null,
      p_clear_phone: patch.phone === null,
      p_time_zone: patch.timeZone ?? null,
      p_hours_mode: patch.hoursMode ?? null,
      p_closed_behaviour: patch.closedBehaviour ?? null,
      p_hours: patch.hours ?? null,
      p_special_days: patch.specialDays ?? null,
      p_phones: patch.phones ?? null,
    });
    if (!saved) return res.status(404).json({ error: 'Account not found' });

    // After the schedule, and only if it succeeded. The ordering matters: a
    // failed schedule save must not leave the agency's notification settings
    // changed behind an error message saying nothing was saved.
    if (Object.keys(notify).length) {
      await tbUpdate('agents', { id: `eq.${agentId}` }, notify, { returning: false });
    }

    return res.status(200).json({ ...saved, ...describeNotify(notify) });
  } catch (e) {
    console.error('[tripbuster/account] failed', req.method, e && e.code, e && e.message);
    return res.status(502).json({ error: 'Could not save that just now. Try again.' });
  }
}
