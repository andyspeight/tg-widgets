// =============================================================================
//  /api/_lib/cancellation-email-template.js — import shim
// =============================================================================
//
//  The renderer itself lives in public/_cancellation-email-template.js so the
//  My Booking editor can import the SAME module for its popup email preview
//  (identical pattern to _reminder-email-template.js and _pdf-template.js).
//  What a client sees while writing their cancellation wording is therefore
//  rendered by the exact code api/cancel-product.js sends.
//
//  This shim keeps the server-side import path stable. Add new exports in the
//  public module, not here.
// =============================================================================

export * from '../../public/_cancellation-email-template.js';
