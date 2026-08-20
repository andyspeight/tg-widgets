/*
 * Documents in the media library, so a client can put a file on a page.
 *
 * WHY THIS MIGRATION EXISTS. public.media has held images and only images since
 * 0011_media.sql, enforced by a check constraint. Andy asked for a File element
 * on 20 Aug 2026, from the Duda list, and a File element with nothing to point
 * at is not an element. A travel agency's brochure, its booking conditions, its
 * ATOL certificate and its price list are PDFs, and today the only way to put one
 * on a page is to host it somewhere else and paste a link.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ON THE LIST, AND WHAT IS NOT, AND WHY
 * ---------------------------------------------------------------------------
 *
 * The list below is documents somebody reads or opens in another program. It is
 * NOT "anything that is not an image", and the difference is the whole security
 * argument for this change.
 *
 * SVG IS STILL REFUSED, and this migration must not be read as softening that.
 * 0011's note stands word for word: an SVG is an XML document that can carry
 * script and fetch external references, so serving one is handing anybody who can
 * upload a file a way to run code. The same goes for text/html, for anything
 * ending in javascript, and for every executable and archive-that-is-really-an-
 * executable format. None of them is here and none of them should be added
 * without a sanitising path of its own.
 *
 * The one entry worth arguing about is application/zip. It is here because a
 * client sending a bundle of documents is an ordinary thing and refusing it
 * sends them to Dropbox, which is worse for everybody. A zip is inert to the
 * browser: it downloads, and whatever is inside it is the visitor's own
 * operating system's problem in exactly the way an email attachment is. What it
 * is NOT is a way to get a script to execute from our origin, which is the
 * property this list is protecting.
 *
 * PDF deserves its own line. A PDF can contain JavaScript, and browsers run it
 * in the PDF viewer's own sandbox, which is not our page's context and cannot
 * read our cookies or our DOM. Refusing PDFs would mean refusing the single
 * most-requested file type in the product to guard against something the browser
 * already isolates.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE BYTES ACTUALLY LIVE
 * ---------------------------------------------------------------------------
 *
 * On Vercel Blob, on blob.vercel-storage.com, which is a DIFFERENT ORIGIN from
 * both the editor and every client site. So even a file that somehow got past
 * this list could not reach a signed-in session's cookies. That is a second line
 * behind this one, not a reason to relax it.
 */

alter table public.media
  drop constraint if exists media_mime_allowed;

alter table public.media
  add constraint media_mime_allowed check (
    mime in (
      -- Images, exactly as 0011 had them. Unchanged, and still no SVG.
      'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif',

      -- Documents. Read or opened, never executed.
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv',
      'text/plain',
      'application/zip'
    )
  );

/*
 * The dimension constraint stays exactly as it was, and it already allows null.
 *
 * A document has no pixels, so width and height are null for every row this
 * migration makes possible. 0011 left them nullable because a Pexels import
 * might not report them; that same nullability is what lets a PDF sit in this
 * table without a column of its own.
 *
 * The 15MB ceiling stays too. It was chosen as "generous, because the browser
 * downscales images first", and it happens to be about right for a brochure. A
 * document does NOT get downscaled on its way past, so for these rows it is the
 * real limit rather than a backstop, and lib/media/limits.ts says so.
 */
