// =============================================================================
//  /api/_lib/order-money.js — import shim
// =============================================================================
//
//  The calculation itself lives in public/_order-money.js so the booking PDF
//  and email templates, and the My Booking editor's previews, read the SAME
//  module the server does. This shim keeps the server-side import path stable
//  and adds the one server-only concern: the switch for discount vouchers.
//
//  TG_DEDUCT_NON_GIFT_VOUCHERS=1 treats discount vouchers (isGift false) as
//  credit against the balance, like gift vouchers. Off until a real order with
//  a discount voucher proves the discount is not already inside the item
//  prices (see the note at the top of the public module).
// =============================================================================

export * from '../../public/_order-money.js';

export function moneyOptsFromEnv() {
  return { deductNonGift: process.env.TG_DEDUCT_NON_GIFT_VOUCHERS === '1' };
}
