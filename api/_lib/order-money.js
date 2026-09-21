// =============================================================================
//  /api/_lib/order-money.js — import shim
// =============================================================================
//
//  The calculation itself lives in public/_order-money.js so the booking PDF
//  and email templates, and the My Booking editor's previews, read the SAME
//  module the server does. This shim keeps the server-side import path stable
//  and adds the one server-only concern: the switch for discount vouchers.
//
//  Discount vouchers (isGift false) are deducted from the balance, like gift
//  vouchers. TG_DEDUCT_NON_GIFT_VOUCHERS=0 holds them back again — a kill
//  switch that needs no deploy, not a setting anyone should reach for.
//
//  It used to be the other way round, off until a real order proved the
//  discount was not already inside the item prices. ET122149 (Exclusively
//  Travel, 21 Sep 2026) is that order: it carries SUNSHINE30, a 30 GBP
//  discount on the accommodation, reads as a zero balance in Travelify and
//  read as 30 GBP still to pay on the customer's My Booking page. Our total is
//  the item prices summed, so the discount is plainly not in them — and the
//  same sums drive the Pay balance button, so we were about to take 30 GBP
//  Travelify does not think it is owed.
// =============================================================================

export * from '../../public/_order-money.js';

export function moneyOptsFromEnv() {
  return { deductNonGift: process.env.TG_DEDUCT_NON_GIFT_VOUCHERS !== '0' };
}
