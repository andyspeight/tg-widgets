/**
 * Luna Assist's ledger and log: the tables 0035 creates, read and written
 * through the tenant transaction like everything else in this directory.
 *
 * THE CLAIM IS THE LIMIT. claimAssistTurn counts what a person and a site have
 * used and inserts the row for this turn in one statement, the same shape as
 * lib/db/ai.ts's claimRequest and for the same reasons (a count in memory is
 * per instance; a count then an insert has a gap; a refused claim writes
 * nothing). Three floors are checked in one place: the person's turns this
 * hour, the site's turns today, and the site's spend this month against its
 * allowance when it has one. See lib/assist/limits.ts for the numbers.
 *
 * The per-person count is per person PER SITE, because the policy scopes this
 * table to one tenant and a count across a person's sites would need a door
 * this module deliberately does not have.
 *
 * THE ALLOWANCE LIVES ON THE TENANT, in staff_settings as assistAllowancePence,
 * read here and nowhere else. Unset is unlimited, which is every site today
 * (Andy, 16 Sep 2026). A staff screen can set it later without a migration.
 */

import 'server-only';

import type { RefusalReason } from '../assist/limits';
import { PER_TENANT_DAILY, PER_USER_HOURLY, RESERVE_PENCE } from '../assist/limits';
import type { TokenUsage } from '../assist/pricing';
import type { Mode } from '../assist/tools';
import { withTenant, type Tx } from './withTenant';

export interface AssistClaim {
  allowed: boolean;
  /** The ledger row for this turn, or null when refused. */
  id: string | null;
  reason: RefusalReason | null;
  /** Pence spent this calendar month (UTC) before this turn. */
  monthPence: number;
}

function json(tx: Tx, value: unknown) {
  return tx.json(value as never);
}

/** The site's monthly allowance in pence, or null for unlimited. */
export async function readAssistAllowance(tenantId: string): Promise<number | null> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select staff_settings ->> 'assistAllowancePence' as pence from public.tenants limit 1
    `;
    const raw = rows[0]?.pence;
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  });
}

export async function claimAssistTurn(
  tenantId: string,
  input: { userId: string; mode: Mode; model: string; allowancePence: number | null },
): Promise<AssistClaim> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      with by_user as (
        select count(*)::int as n
          from public.assist_usage
         where user_id = ${input.userId}
           and created_at > now() - interval '1 hour'
      ),
      by_site as (
        select count(*)::int as n
          from public.assist_usage
         where created_at > now() - interval '24 hours'
      ),
      month as (
        select coalesce(sum(cost_pence), 0)::float8 as pence
          from public.assist_usage
         where created_at >= date_trunc('month', now() at time zone 'utc')
      ),
      taken as (
        insert into public.assist_usage (tenant_id, user_id, mode, model)
        select ${tenantId}::uuid, ${input.userId}::text, ${input.mode}, ${input.model}
          from by_user, by_site, month
         where by_user.n < ${PER_USER_HOURLY}
           and by_site.n < ${PER_TENANT_DAILY}
           and (
             ${input.allowancePence}::numeric is null
             or month.pence + ${RESERVE_PENCE} <= ${input.allowancePence}::numeric
           )
        returning id
      )
      select by_user.n as by_user, by_site.n as by_site, month.pence as month_pence, taken.id as id
        from by_user
       cross join by_site
       cross join month
        left join taken on true
    `;

    const row = (rows[0] ?? {}) as Record<string, unknown>;
    const id = (row.id as string | null) ?? null;
    const byUser = Number(row.by_user ?? 0);
    const bySite = Number(row.by_site ?? 0);
    const monthPence = Number(row.month_pence ?? 0);

    let reason: RefusalReason | null = null;
    if (id === null) {
      if (byUser >= PER_USER_HOURLY) reason = 'user';
      else if (bySite >= PER_TENANT_DAILY) reason = 'tenant';
      else reason = 'allowance';
    }
    return { allowed: id !== null, id, reason, monthPence };
  });
}

/**
 * What the turn cost, once it is over. Additive, like recordTokens: a turn is
 * several calls in a loop and each may be recorded as it lands.
 */
export async function recordAssistUsage(
  tenantId: string,
  id: string,
  usage: TokenUsage,
  costPence: number,
): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
      await tx`
        update public.assist_usage
           set input_tokens       = coalesce(input_tokens, 0) + ${usage.inputTokens},
               output_tokens      = coalesce(output_tokens, 0) + ${usage.outputTokens},
               cache_read_tokens  = coalesce(cache_read_tokens, 0) + ${usage.cacheReadTokens},
               cache_write_tokens = coalesce(cache_write_tokens, 0) + ${usage.cacheWriteTokens},
               cost_pence         = coalesce(cost_pence, 0) + ${costPence}
         where id = ${id}::uuid
      `;
    });
  } catch (error) {
    console.error('[tg-sites] could not record assistant usage', error);
  }
}

export type AssistLogKind =
  | 'asked'
  | 'tool'
  | 'answered'
  | 'question'
  | 'refused'
  | 'failed'
  | 'proposed'
  | 'applied'
  | 'undone';

export interface AssistLogEvent {
  userId: string | null;
  usageId: string | null;
  pageId: string | null;
  mode: Mode;
  kind: AssistLogKind;
  /** Names, ids and counts. Never prompts, answers or enquiry content. */
  detail: Record<string, unknown>;
}

/** Best effort: a log line that fails to land must not fail the turn. */
export async function logAssist(tenantId: string, event: AssistLogEvent): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
      await tx`
        insert into public.assist_log (tenant_id, user_id, usage_id, page_id, mode, kind, detail)
        values (
          ${tenantId}::uuid,
          ${event.userId}::text,
          ${event.usageId}::uuid,
          ${event.pageId}::uuid,
          ${event.mode},
          ${event.kind},
          ${json(tx, event.detail)}
        )
      `;
    });
  } catch (error) {
    console.error('[tg-sites] could not write the assistant log', error);
  }
}

/** Pence spent this calendar month, for a screen. */
export async function assistMonthPence(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select coalesce(sum(cost_pence), 0)::float8 as pence
        from public.assist_usage
       where created_at >= date_trunc('month', now() at time zone 'utc')
    `;
    return Number(rows[0]?.pence ?? 0);
  });
}
