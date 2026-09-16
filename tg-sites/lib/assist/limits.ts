/**
 * How much the assistant may be used, and by whom.
 *
 * THREE FLOORS, IN THE ORDER THEY ARE CHECKED. A person may take so many turns
 * an hour; a site may take so many a day; and a site may spend so much a month.
 * The first two are guards against a runaway (a script, a stuck retry, a
 * disgruntled member) and are not pricing. The third is the allowance Andy
 * asked for in the brief and answered on 16 Sep 2026 with "unlimited to
 * start": so it is unset (null) for every site today, and the code path that
 * enforces it exists, is tested, and is waiting for a number.
 *
 * The counting is done in Postgres (lib/db/assist.ts) so it is true across
 * every serverless instance; this file holds the numbers and the arithmetic,
 * which is the part worth testing without a database.
 */

/** Turns one person may take in a rolling hour, across their sites. */
export const PER_USER_HOURLY = 40;

/** Turns one site may take in a rolling day, across its members. */
export const PER_TENANT_DAILY = 300;

/**
 * What one turn might cost at worst, reserved before the model is called so
 * an allowance cannot be crossed by a turn that started under it. Ten pence
 * is several times a real Sonnet turn with a long answer.
 */
export const RESERVE_PENCE = 10;

export type RefusalReason = 'user' | 'tenant' | 'allowance';

/**
 * Whether a site with `spentPence` spent this month may start a turn against
 * an allowance. Null means no allowance has been set, which is unlimited.
 */
export function withinAllowance(input: {
  allowancePence: number | null;
  spentPence: number;
  reservePence?: number;
}): boolean {
  if (input.allowancePence === null) return true;
  const allowance = Number.isFinite(input.allowancePence) ? Math.max(0, input.allowancePence) : 0;
  const spent = Number.isFinite(input.spentPence) ? Math.max(0, input.spentPence) : 0;
  const reserve = input.reservePence ?? RESERVE_PENCE;
  return spent + reserve <= allowance;
}

/** What a refusal says. Plain, and it names what to do. */
export function refusalMessage(reason: RefusalReason): string {
  switch (reason) {
    case 'user':
      return 'You have used the assistant a lot in the last hour. Give it a little while and try again.';
    case 'tenant':
      return 'This site has used its assistant turns for today. It resets over the next day.';
    case 'allowance':
      return "This site has used this month's assistant allowance. Ask Travelgenix if you need more.";
  }
}
