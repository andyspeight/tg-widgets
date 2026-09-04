// =============================================================================
//  /api/enquiry/_lib/routing/_templates/agent-email.js — import shim
// =============================================================================
//
//  The renderer itself lives in public/_enquiry-agent-email.js so the Enquiry
//  editor can import the SAME module for its live email preview (the pattern
//  established by _reminder-email-template.js and _cancellation-email-template.js).
//  What a client previews is rendered by the exact code that sends.
//
//  This shim keeps the server-side import path stable. Add new exports in the
//  public module, not here.
// =============================================================================

export * from '../../../../../public/_enquiry-agent-email.js';
