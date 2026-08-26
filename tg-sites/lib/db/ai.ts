/**
 * How much the writing assistant has been used, and by whom.
 *
 * THE ONLY REASON THIS FILE EXISTS IS THE BILL. Every call to the assistant is a
 * call to a metered API on Travelgenix's account, and anybody with a login to any
 * site can make one. See db/migrations/0015_ai_usage.sql for why the count is in
 * Postgres rather than a Map: on serverless, a per-instance limit is multiplied by
 * however many instances the load created, which is the wrong direction.
 *
 * THE ORDER OF THE TWO WRITES IS THE DESIGN
 *
 * claimRequest inserts the row and returns whether it was allowed, BEFORE the model
 * is called. recordTokens fills in what it cost afterwards. Doing it the other way
 * round, a request that hangs or errors costs money and leaves nothing behind, so a
 * loop of failing requests would be free of the limit and not free of the charge.
 *
 * Scoped by withTenant like everything else, so the policy does the isolation and
 * there is no WHERE tenant_id in here to get wrong.
 */

import 'server-only';

import { withTenant, type Tx } from './withTenant';

/**
 * What a site may ask for in a day.
 *
 * A DAY rather than an hour, because the shape of real use is bursty: somebody
 * builds a page on Tuesday afternoon and asks for fifteen paragraphs in twenty
 * minutes, then nothing for a week. An hourly cap tuned to stop abuse would stop
 * that afternoon, and an hourly cap that allowed it would allow abuse all day.
 *
 * Two hundred is deliberately generous. It is not a fair-use policy, it is a
 * ceiling on how bad a bad day can get: at Haiku prices and the length these
 * prompts run to, two hundred calls is small change, and two hundred thousand is
 * not. If a client ever legitimately reaches it, that is a conversation worth
 * having and the number is one constant.
 */
export const DAILY_LIMIT = 200;

/** The window the limit is counted over. */
const WINDOW = '24 hours';

export interface Claim {
  /** Whether the request may proceed. */
  allowed: boolean;
  /** The id of the usage row, for recordTokens. Null when it was refused. */
  id: string | null;
  /** How many have already been used in the window, including this one. */
  used: number;
}

/**
 * Take a slot, or refuse.
 *
 * COUNTED AND INSERTED IN ONE STATEMENT, and it is worth being precise about what
 * that does and does not buy.
 *
 * What it removes is the gap inside one request: read the count, think about it,
 * then insert. That gap is milliseconds of network plus however long the process
 * is descheduled for, and every one of them is a window where the number is
 * already wrong. A CTE that counts and inserts conditionally has no such window.
 *
 * What it does NOT do is serialise against other transactions. At READ COMMITTED,
 * which is Postgres's default and what this uses, two requests genuinely in
 * flight together both take the count from a snapshot that does not include the
 * other, so both can pass on the 200th. The overshoot is bounded by how many
 * requests are actually concurrent, which for one site is a handful.
 *
 * That is accepted rather than overlooked. Making it exact needs SERIALIZABLE and
 * a retry loop, or a lock on the tenant row, and this is a spend guard rather
 * than a billing ledger: the difference between stopping at 200 and stopping at
 * 203 is pennies, and the difference between stopping and not stopping is the
 * whole point. If this ever becomes a number somebody is charged against, it
 * needs the lock.
 *
 * On refusal nothing is written. A refused request costs nothing, so recording it
 * would make the limit tighten itself every time somebody retried.
 */
export async function claimRequest(
  tenantId: string,
  input: { userId: string | null; intent: string },
): Promise<Claim> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      with used as (
        select count(*)::int as n
          from public.ai_usage
         where created_at > now() - ${WINDOW}::interval
      ),
      taken as (
        insert into public.ai_usage (tenant_id, user_id, intent)
        -- user_id is text, not a uuid: it holds whatever subject the active
        -- identity provider issued. See the migration.
        select ${tenantId}::uuid, ${input.userId}::text, ${input.intent}
          from used
         where used.n < ${DAILY_LIMIT}
        returning id
      )
      select used.n as used, taken.id as id
        from used left join taken on true
    `;

    const row = rows[0];
    const id = (row?.id as string | null) ?? null;
    const before = Number(row?.used ?? 0);

    return { allowed: id !== null, id, used: before + (id ? 1 : 0) };
  });
}

/**
 * What the answer actually cost, once there is one.
 *
 * Best effort by design: the caller has an answer for the person waiting, and
 * failing that request because a bookkeeping update did not land would be trading
 * something that matters for something that does not. The row already exists and
 * already counts against the limit, so the worst case is a row with null tokens,
 * which the table treats as "we paid for nothing" and is only slightly wrong.
 */
/**
 * ADDITIVE, NOT ABSOLUTE. A page build records twice against one claimed slot:
 * the plan call, then the fill. An absolute write meant the second call erased
 * the first — usually the larger — so the ledger silently under-counted what
 * every AI page really cost. Adding is also correct for the single-call
 * actions, whose row starts at zero.
 */
export async function recordTokens(
  tenantId: string,
  id: string,
  tokens: { input: number; output: number },
): Promise<void> {
  try {
    await withTenant(tenantId, async (tx: Tx) => {
      await tx`
        update public.ai_usage
           set input_tokens  = coalesce(input_tokens, 0) + ${tokens.input},
               output_tokens = coalesce(output_tokens, 0) + ${tokens.output}
         where id = ${id}::uuid
      `;
    });
  } catch (error) {
    console.error('[tg-sites] could not record AI token usage', error);
  }
}

/** How many requests a site has made in the window. For a settings screen later. */
export async function usageToday(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select count(*)::int as n
        from public.ai_usage
       where created_at > now() - ${WINDOW}::interval
    `;
    return Number(rows[0]?.n ?? 0);
  });
}
