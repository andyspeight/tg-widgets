// =============================================================================
//  /api/enquiry/_lib/routing/_templates/auto-reply-email.js — import shim
// =============================================================================
//
//  The renderer itself lives in public/_enquiry-autoreply-email.js so the
//  Enquiry editor can import the SAME module for its live email preview (the
//  pattern established by _reminder-email-template.js and
//  _cancellation-email-template.js). What a client previews while writing their
//  confirmation wording is what their customer receives.
//
//  This shim keeps the server-side import path stable. Add new exports in the
//  public module, not here.
// =============================================================================

export * from '../../../../../public/_enquiry-autoreply-email.js';
