// =============================================================================
//  lib/money.ts
// =============================================================================
//
//  Money is integer pence everywhere. Never a float, never a string, never a
//  number that came off the browser.
//
//  Locked 10 Aug 2026: a zero price means "not priced yet" and is HIDDEN, never
//  rendered as £0 or as free. format() returns null for anything <= 0 so a
//  caller has to decide what an unpriced trip looks like rather than
//  accidentally advertising a free safari.
//
// =============================================================================

const SYMBOLS: Record<string, string> = { gbp: '£', eur: '€', usd: '$' };

/** True when a price has actually been set. Zero has not. */
export function isPriced(pence: number | null | undefined): boolean {
  return typeof pence === 'number' && Number.isFinite(pence) && pence > 0;
}

/**
 * Render pence as money, or null when it is not priced. Callers render the
 * null case as "Price on request" rather than a zero.
 */
export function format(pence: number | null | undefined, currency = 'gbp'): string | null {
  if (!isPriced(pence)) return null;

  const code = String(currency || 'gbp').toLowerCase();
  const amount = (pence as number) / 100;
  const whole = Number.isInteger(amount);

  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code.toUpperCase(),
      // narrowSymbol, or an en-GB locale disambiguates USD to "US$100". An
      // operator selling in dollars wants "$100" on their own trip page, and a
      // British reader is not confused by it in context.
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    // Unknown currency code: fall back rather than throwing mid-render.
    const symbol = SYMBOLS[code] ?? '';
    return `${symbol}${amount.toFixed(whole ? 0 : 2)}`;
  }
}

/**
 * Parse a user-entered amount into pence. Returns null when it is not a real
 * number, so a bad input is rejected rather than silently becoming zero.
 */
export function toPence(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const cleaned = String(input).replace(/[^0-9.\-]/g, '');
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Split a total into a deposit and a balance. Server side only: the amount
 * charged is always resolved from the departure, never trusted from the client.
 */
export function splitDeposit(
  totalPence: number,
  depositPence: number | null,
  depositPercent: number | null,
): { deposit: number; balance: number } {
  const total = Math.max(0, Math.round(totalPence));

  let deposit: number;
  if (isPriced(depositPence)) {
    deposit = Math.min(depositPence as number, total);
  } else if (depositPercent && depositPercent > 0) {
    deposit = Math.min(Math.round((total * depositPercent) / 100), total);
  } else {
    deposit = total;
  }

  return { deposit, balance: Math.max(0, total - deposit) };
}
