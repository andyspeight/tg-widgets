// =============================================================================
//  /api/_lib/booking-email-template.js — import shim
// =============================================================================
//
//  The renderer itself lives in public/_booking-email-template.js so the My
//  Booking editor can import the SAME module for its email preview.
//
//  Why this moved (Sep 2026): the editor used to preview this email with a
//  SECOND, preview-only implementation — public/_email-template.js, 672 lines
//  against this file's 998 — and the two had drifted badly. The preview said
//  "Your Dubai booking is confirmed — 3 Feb 2027" while the real email said
//  "Your Dubai booking confirmation (DEMO81376)", and the bodies differed in
//  structure, headings and length (15.7KB vs 10.2KB). A client checking their
//  branding in the editor was being shown an email we do not send. That second
//  implementation is deleted; this one is the only booking confirmation
//  renderer, and it is what the editor previews.
//
//  This shim keeps the server-side import path stable. Add new exports in the
//  public module, not here.
// =============================================================================

export * from '../../public/_booking-email-template.js';
