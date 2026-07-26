/**
 * Tripbuster spreadsheet import (ingestion route 2 of 3).
 *
 *   GET  /api/tripbuster/import               → columns, guidance and limits for the UI
 *   GET  /api/tripbuster/import?format=csv    → the template, as a download
 *   POST /api/tripbuster/import  mode=preview → what WOULD happen. Writes nothing.
 *   POST /api/tripbuster/import  mode=commit  → do it
 *
 * The preview exists because a spreadsheet is a blunt instrument: an agent should
 * see the dates we read, the prices we found and the rows we could not use BEFORE
 * anything reaches the database.
 *
 * COMMIT RE-PARSES THE RAW TEXT and re-validates every row. It never accepts the
 * normalised rows the preview returned, so nothing a client edits in between can
 * widen what gets written. The only things the client influences are the raw
 * text, the column mapping (checked against a whitelist) and the publish switch.
 *
 * Provenance is set here, never taken from the body: source is always
 * 'spreadsheet' and agent_id always comes from the bearer token.
 *
 * No CORS headers deliberately: authenticated surface, same-origin only.
 */

import { requireAgent } from '../_lib/tripbuster/auth.js';
import { validateDeal } from '../_lib/tripbuster/deal-schema.js';
import { tbConfigured, tbSelect, tbInsert, tbUpdate, tbRpc } from '../_lib/tripbuster/db.js';
import {
  loadAgent, dealCounts, applyAgentDefaults, publishBlockers, publishHeadroom, allowanceFor,
} from '../_lib/tripbuster/deal-write.js';
import {
  parseDelimited, mapHeaders, rowToDeal, rowShapeProblem, isImportableColumn,
  templateCsv, templateGuide, SHEET_COLUMNS, MAX_TEXT_BYTES, MAX_ROWS,
} from '../_lib/tripbuster/sheet.js';

/** How many rows to show back in a preview. The rest are summarised. */
const PREVIEW_ROWS = 60;
/** Row problems stored on the import_runs record. */
const STORED_PROBLEMS = 20;
/** Concurrent PATCHes when updating existing deals. */
const UPDATE_CONCURRENCY = 6;

const REF_PREFIX = 'sheet:';

/** Namespaced so a spreadsheet reference can never collide with a cache offer id. */
function sheetRef(reference) {
  return `${REF_PREFIX}${String(reference).trim()}`.slice(0, 200);
}

/** Run `worker` over `items` with a bounded number in flight. */
async function pooled(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Group rows that share exactly the same set of columns.
 *
 * PostgREST takes the UNION of keys across a bulk insert and sends NULL for any
 * object missing one. On a column like holiday_type — NOT NULL with a default —
 * an explicit NULL is a constraint violation, so a mixed batch would fail even
 * though every row is individually fine. Rows from one sheet almost always share
 * a signature, so this stays one or two round trips while being safe.
 */
function groupBySignature(rows) {
  const groups = new Map();
  for (const r of rows) {
    const sig = Object.keys(r.deal).sort().join('|');
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(r);
  }
  return Array.from(groups.values());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const gate = requireAgent(req);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

  // Declared before the GET branch below, which reads it for the history query.
  const agentId = gate.agent.agentId;

  // ── the template and the column list ────────────────────────────────────
  // Served to signed-in agents only, so the importer's shape is not a public
  // description of the database.
  if (req.method === 'GET') {
    if (String(req.query?.format || '') === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="tripbuster-deals-template.csv"');
      return res.status(200).send(templateCsv());
    }
    // What previous imports did, and how the agent's deals were added. Andy
    // relies on the dashboard as an external record, so an import has to be
    // readable back later rather than living only in a toast that has gone.
    if (String(req.query?.history || '') === '1') {
      if (!tbConfigured()) return res.status(503).json({ error: 'Deals service is not configured yet' });
      try {
        const [runs, bySource] = await Promise.all([
          tbSelect('import_runs', {
            select: 'id,source,filename,rows_total,created_count,updated_count,skipped_count,failed_count,problems,created_at',
            agent_id: `eq.${agentId}`,
            order: 'created_at.desc',
            limit: 10,
          }),
          tbRpc('tb_agent_source_counts', { p_agent_id: agentId }).catch(() => null),
        ]);
        return res.status(200).json({ runs: Array.isArray(runs) ? runs : [], bySource });
      } catch (e) {
        // Log the message, not just the code: a programming error carries no
        // code, and this fallback previously turned one into a silent empty list.
        console.warn('[tripbuster/import] history unavailable', e && (e.code || e.message));
        return res.status(200).json({ runs: [], bySource: null });
      }
    }
    return res.status(200).json({
      columns: SHEET_COLUMNS.map((c) => ({
        col: c.col, kind: c.kind, required: !!c.required, alsoAccepts: c.syn || [],
      })),
      guide: templateGuide(),
      limits: { maxRows: MAX_ROWS, maxBytes: MAX_TEXT_BYTES },
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!tbConfigured()) return res.status(503).json({ error: 'Deals service is not configured yet' });

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const mode = body.mode === 'commit' ? 'commit' : 'preview';
  const publish = body.publish === true;
  const text = typeof body.text === 'string' ? body.text : '';
  const filename = typeof body.filename === 'string' ? body.filename.slice(0, 200) : null;

  if (!text.trim()) return res.status(400).json({ error: 'Paste or upload a spreadsheet first' });
  // Byte length, not character count — a sheet full of accented resort names is
  // bigger than it looks.
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    return res.status(413).json({
      error: `That file is too big. Please split it into parts of under ${Math.floor(MAX_TEXT_BYTES / 1024)} KB.`,
    });
  }

  // Only a whitelisted column may be mapped, so a hand-edited request cannot
  // point a spreadsheet cell at agent_id, source or status-by-another-name.
  const override = {};
  if (body.mapping && typeof body.mapping === 'object' && !Array.isArray(body.mapping)) {
    for (const [header, col] of Object.entries(body.mapping)) {
      if (typeof header !== 'string') continue;
      if (col === '' || col === null) { override[header] = ''; continue; }
      if (typeof col === 'string' && isImportableColumn(col)) override[header] = col;
    }
  }

  const delimiterHint = ['\t', ',', ';'].includes(body.delimiter) ? body.delimiter : undefined;

  try {
    const parsed = parseDelimited(text, { delimiter: delimiterHint });
    if (!parsed.rows.length) {
      return res.status(422).json({ error: 'That file has no rows we could read' });
    }
    const [headerRow, ...dataRows] = parsed.rows;
    const headers = mapHeaders(headerRow, override);

    if (!headers.mapped.length) {
      return res.status(422).json({
        error: 'None of those column headings matched a deal field. Check the first row is your headings, then map them below.',
        headers: headers.mapping,
        unmapped: headers.unmapped,
      });
    }
    if (!dataRows.length) {
      return res.status(422).json({ error: 'We found your headings but no deal rows underneath them' });
    }

    const hasStatusColumn = headers.mapped.includes('status');
    const hasReferenceColumn = headers.mapped.includes('reference');

    const [agent, counts] = await Promise.all([loadAgent(agentId), dealCounts(agentId)]);
    if (!agent) return res.status(401).json({ error: 'Sign in again to continue' });
    if (mode === 'commit' && agent.status !== 'active') {
      return res.status(403).json({ error: 'This account is not active' });
    }

    // Existing refs for this agent, fetched in one go and matched in JS. Deal
    // references are agent-authored text that can contain commas and brackets,
    // so they are never interpolated into a PostgREST `in.(...)` filter.
    const existingRows = await tbSelect('deals', {
      select: 'id,status,external_ref,price_from,clickout_url,title',
      agent_id: `eq.${agentId}`,
      external_ref: 'not.is.null',
      limit: 1000,
    });
    const existingByRef = new Map();
    for (const r of (Array.isArray(existingRows) ? existingRows : [])) {
      if (r.external_ref) existingByRef.set(r.external_ref, r);
    }

    let headroom = publishHeadroom(agent.plan, counts.live);
    const planLimit = allowanceFor(agent.plan);

    const seenRefsThisSheet = new Map(); // ref → the row number that claimed it
    const rows = [];

    dataRows.forEach((raw, i) => {
      const rowNumber = i + 2; // header is row 1, so this matches the agent's spreadsheet
      const entry = {
        row: rowNumber, action: null, ref: null, title: null,
        errors: [], problems: [], deal: null, existingId: null,
      };

      const shape = rowShapeProblem(raw, headerRow.length);
      if (shape) entry.problems.push(shape);

      const deal = rowToDeal(raw, headers.mapping, { delimiter: parsed.delimiter });

      // Which existing deal, if any, this row is about.
      const reference = typeof deal.reference === 'string' ? deal.reference.trim() : '';
      const ref = reference ? sheetRef(reference) : null;
      entry.ref = ref;

      if (ref && seenRefsThisSheet.has(ref)) {
        entry.action = 'error';
        entry.errors.push({
          field: 'reference',
          message: `Reference "${reference}" is also on row ${seenRefsThisSheet.get(ref)}. `
            + 'Each deal needs its own reference, so this row was left out.',
        });
        rows.push(entry);
        return;
      }
      if (ref) seenRefsThisSheet.set(ref, rowNumber);

      const existing = ref ? existingByRef.get(ref) : null;
      const isUpdate = !!existing;
      entry.existingId = existing ? existing.id : null;

      // An update validates as a patch, so a price-only refresh sheet does not
      // have to repeat the title. A new deal must stand on its own.
      const { ok, deal: clean, errors } = validateDeal(deal, { partial: isUpdate });
      if (!ok) {
        entry.action = 'error';
        entry.errors = errors;
        entry.title = deal.title || (existing && existing.title) || null;
        rows.push(entry);
        return;
      }

      entry.title = clean.title || (existing && existing.title) || null;

      // Status. Nothing goes live unless the agent asked for it on this upload.
      // With the switch on, a row goes live if its status column says so, or if
      // the sheet has no status column at all.
      let wantsLive = false;
      if (publish) wantsLive = hasStatusColumn ? clean.status === 'live' : true;

      /**
       * Do not publish this row, without disturbing a deal that is already live.
       * A new deal becomes a draft; an existing one keeps whatever status it has,
       * because the publish switch being off means "do not promote anything", not
       * "take my live deals down".
       */
      const doNotPublish = () => {
        if (isUpdate) delete clean.status;
        else clean.status = 'draft';
      };

      if (!publish && clean.status === 'live') {
        doNotPublish();
        entry.problems.push(isUpdate
          ? 'Left at its current status. Turn on publishing to make it live.'
          : 'Imported as a draft. Turn on publishing to make it live.');
      }

      if (isUpdate) {
        entry.action = 'update';
      } else {
        entry.action = 'create';
        applyAgentDefaults(clean, agent);
        // The dedupe key has to be WRITTEN, not just computed, or the next upload
        // of the same sheet would find nothing to match and add a second copy of
        // every deal. Set before grouping so it counts towards the column
        // signature and ref/no-ref rows are never batched together.
        if (ref) clean.external_ref = ref;
      }

      if (wantsLive) {
        // Merge against what the deal will actually be, so an update that only
        // carries a price is judged on the row it is updating.
        const merged = applyAgentDefaults({
          price_from: clean.price_from !== undefined ? clean.price_from
            : (existing ? existing.price_from : null),
          clickout_url: clean.clickout_url !== undefined ? clean.clickout_url
            : (existing ? existing.clickout_url : null),
        }, agent);
        const blockers = publishBlockers(merged);
        if (blockers.length) {
          doNotPublish();
          entry.problems.push(`Not published: ${blockers.map((b) => b.message).join('; ')}`);
        } else if (planLimit === 0) {
          doNotPublish();
          entry.problems.push(`Your ${agent.plan} plan does not include live deals yet, so this stayed a draft.`);
        } else {
          // An already-live deal keeps its slot; anything else needs headroom.
          const needsSlot = !(existing && existing.status === 'live');
          if (needsSlot && headroom <= 0) {
            doNotPublish();
            entry.problems.push(
              `You are using all ${planLimit} live deals on ${agent.plan}, so this stayed a draft.`,
            );
          } else {
            if (needsSlot) {
              headroom -= 1;
              // Only stamp this on the transition, so resyncing a live deal does
              // not keep resetting when it was first published.
              clean.published_at = new Date().toISOString();
            }
            clean.status = 'live';
            if (clean.clickout_url === undefined && merged.clickout_url) {
              clean.clickout_url = merged.clickout_url;
            }
          }
        }
      }

      // An update with nothing left to change is a no-op worth reporting as
      // such, rather than counting it as work done.
      if (isUpdate && !Object.keys(clean).length) {
        entry.action = 'skip';
        entry.problems.push('Nothing in this row differs from what we already hold.');
      }

      entry.deal = clean;
      rows.push(entry);
    });

    const summary = {
      total: rows.length,
      create: rows.filter((r) => r.action === 'create').length,
      update: rows.filter((r) => r.action === 'update').length,
      skip: rows.filter((r) => r.action === 'skip').length,
      errors: rows.filter((r) => r.action === 'error').length,
      willPublish: rows.filter((r) => r.deal && r.deal.status === 'live').length,
    };

    const notes = [];
    if (parsed.truncated) {
      notes.push(`Only the first ${MAX_ROWS} rows were read. Split the file to import the rest.`);
    }
    if (!hasReferenceColumn) {
      notes.push('No reference column, so every row will be added as a new deal. '
        + 'Add a reference column if you want future uploads to update these instead of duplicating them.');
    }
    if (headers.unmapped.length) {
      notes.push(`Ignored ${headers.unmapped.length} column${headers.unmapped.length === 1 ? '' : 's'} `
        + `we did not recognise: ${headers.unmapped.slice(0, 6).join(', ')}.`);
    }
    if (headers.duplicates.length) {
      notes.push(`These headings repeat a field already mapped, so they were ignored: ${headers.duplicates.join(', ')}.`);
    }

    // ── preview: say what would happen, write nothing ───────────────────────
    if (mode === 'preview') {
      return res.status(200).json({
        mode: 'preview',
        delimiter: parsed.delimiter,
        headers: headers.mapping,
        unmapped: headers.unmapped,
        mapped: headers.mapped,
        summary,
        notes,
        plan: agent.plan,
        liveAllowance: planLimit,
        liveNow: Number(counts.live || 0),
        // The deal itself is echoed back so the agent can see the dates and
        // prices we read, which is the whole point of a preview.
        rows: rows.slice(0, PREVIEW_ROWS),
        rowsShown: Math.min(rows.length, PREVIEW_ROWS),
      });
    }

    // ── commit ─────────────────────────────────────────────────────────────
    const toCreate = rows.filter((r) => r.action === 'create');
    const toUpdate = rows.filter((r) => r.action === 'update');
    const problems = [];
    let created = 0;
    let updated = 0;
    let failed = rows.filter((r) => r.action === 'error').length;

    for (const r of rows) {
      if (r.action === 'error') {
        problems.push({ row: r.row, message: r.errors.map((e) => e.message).join('; ') });
      } else if (r.problems.length) {
        problems.push({ row: r.row, message: r.problems.join(' ') });
      }
    }

    // Creates: one insert per column-signature group, falling back to row by row
    // so a single bad row cannot cost the whole group.
    for (const group of groupBySignature(toCreate)) {
      const payload = group.map((r) => ({ ...r.deal, agent_id: agentId, source: 'spreadsheet' }));
      try {
        await tbInsert('deals', payload, { returning: false });
        created += group.length;
      } catch (groupErr) {
        console.warn('[tripbuster/import] group insert failed, retrying per row', groupErr && groupErr.code);
        const results = await pooled(group, UPDATE_CONCURRENCY, async (r) => {
          try {
            await tbInsert('deals', [{ ...r.deal, agent_id: agentId, source: 'spreadsheet' }], { returning: false });
            return true;
          } catch (rowErr) {
            problems.push({
              row: r.row,
              message: rowErr && rowErr.status === 409
                ? 'A deal with this reference already exists. Try the import again.'
                : 'We could not save this row.',
            });
            return false;
          }
        });
        created += results.filter(Boolean).length;
        failed += results.filter((ok) => !ok).length;
      }
    }

    // Updates: always filtered on agent_id as well as id, so a guessed id
    // cannot reach another agent's deal.
    const updateResults = await pooled(toUpdate, UPDATE_CONCURRENCY, async (r) => {
      try {
        const out = await tbUpdate('deals',
          { id: `eq.${r.existingId}`, agent_id: `eq.${agentId}` }, r.deal);
        return Array.isArray(out) && out.length > 0;
      } catch (e) {
        problems.push({ row: r.row, message: 'We could not update this row.' });
        return false;
      }
    });
    updated = updateResults.filter(Boolean).length;
    failed += updateResults.filter((ok) => !ok).length;

    // Leave a record the agent can read back later. Best-effort: the deals are
    // already saved, and losing the history entry must not fail the import.
    let runId = null;
    try {
      const run = await tbInsert('import_runs', [{
        agent_id: agentId,
        source: 'spreadsheet',
        filename,
        rows_total: rows.length,
        created_count: created,
        updated_count: updated,
        skipped_count: summary.skip,
        failed_count: failed,
        problems: problems.slice(0, STORED_PROBLEMS),
      }], { returning: true });
      runId = Array.isArray(run) && run[0] ? run[0].id : null;
    } catch (e) {
      console.warn('[tripbuster/import] could not record the run', e && e.code);
    }

    return res.status(200).json({
      mode: 'commit',
      created,
      updated,
      skipped: summary.skip,
      failed,
      notes,
      problems: problems.slice(0, STORED_PROBLEMS),
      runId,
    });
  } catch (e) {
    console.error('[tripbuster/import] failed', e && e.code, e && e.message);
    return res.status(502).json({ error: 'Could not read that file just now. Try again.' });
  }
}
