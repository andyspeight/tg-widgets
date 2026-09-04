/**
 * Payment reminder email — renderer (import shim).
 *
 * The renderer itself lives in public/_reminder-email-template.js so the My
 * Booking editor can import the SAME module for its popup email preview
 * (identical pattern to api/booking-pdf.js ↔ public/_pdf-template.js). What a
 * client sees in the editor is therefore rendered by the exact code the send
 * worker runs — the preview cannot drift from the real email.
 *
 * This shim keeps the server-side import path stable for the cron worker and
 * the test suites. Add new exports in the public module, not here.
 */
export * from '../../public/_reminder-email-template.js';
