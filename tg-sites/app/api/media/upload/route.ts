/**
 * Mints a short-lived token so the browser can upload straight to the store.
 *
 * WHY THE BYTES DO NOT COME THROUGH HERE
 *
 * A serverless function has a 4.5MB request body limit. A photograph off a
 * current phone is bigger than that, so any upload path that carries the file
 * through the server refuses the most ordinary file a client will ever pick, and
 * refuses it with a platform error rather than a message. The widget suite hit
 * exactly this and solved it the same way, in api/upload-photo.js.
 *
 * So the browser asks this route for permission, this route decides, and then the
 * browser talks to the store directly. The file never touches our server, which
 * also means the upload is not paying for a function invocation while it streams.
 *
 * WHAT THIS ROUTE IS ACTUALLY DECIDING
 *
 * Four things, and all four matter:
 *
 *   who is asking          the session cookie, or nothing gets minted
 *   where it may write     one prefix, this tenant's, checked not assumed
 *   what it may write      five image types, so the store refuses the rest
 *   how much               15MB, enforced by the store, not by trust
 *
 * The pathname is chosen by the BROWSER, and the blob SDK gives no way to rewrite
 * it while minting. So the only defence is to refuse to mint at all for a pathname
 * outside the caller's own prefix, which is what assertPathnameForTenant does. Get
 * that wrong and any signed-in client can write into any other client's storage.
 */

import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

import { isSignInRequired, requireTenantId } from '../../../../lib/auth/session';
import { blobConfigured, blobToken } from '../../../../lib/media/blob';
import {
  ALLOWED_MIME,
  assertPathnameForTenant,
  MAX_UPLOAD_BYTES,
} from '../../../../lib/media/limits';

/** Reads cookies and the store token, so it cannot be an edge function. */
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  if (!blobConfigured()) {
    return NextResponse.json(
      {
        error:
          'Image storage is not connected yet. Add a Blob store to this project in Vercel ' +
          'and redeploy, and uploads will start working.',
      },
      { status: 503 },
    );
  }

  let tenantId: string;
  try {
    // Before the body is even read. An unauthenticated caller gets no token and
    // no information about what a valid request would look like.
    tenantId = await requireTenantId();
  } catch (error) {
    if (isSignInRequired(error)) {
      return NextResponse.json({ error: 'Your session has ended.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'No site selected.' }, { status: 403 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      /*
       * Passed explicitly, not left to the SDK's default.
       *
       * The SDK reads BLOB_READ_WRITE_TOKEN and nothing else. blobConfigured()
       * accepts the TG_Blob_ prefixed name too, because that is how a store shared
       * with the widget suite arrives. Without this line those two disagree: the
       * check above passes, this call fails, and the error names an environment
       * variable that is genuinely set.
       */
      token: blobToken(),
      onBeforeGenerateToken: async (pathname) => {
        // Throws for anything outside this tenant's prefix, which handleUpload
        // turns into a refusal rather than a token.
        assertPathnameForTenant(pathname, tenantId);

        return {
          /*
           * The store enforces this list, not us.
           *
           * That is the difference between a check and a wish: the browser could
           * simply not send the type it promised, and by then the server is not
           * in the conversation. Naming the types in the token means the store
           * rejects the upload itself.
           */
          allowedContentTypes: [...ALLOWED_MIME],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          /*
           * The store appends its own random suffix. Two uploads of hero.jpg then
           * become two objects rather than one silently overwriting the other,
           * which is what somebody uploading a second photograph expects. It also
           * means the pathname that comes back is not the one that went in, which
           * is why the recording step stores what the STORE reports.
           */
          addRandomSuffix: true,
          /*
           * Rides through the store and comes back on the completion callback,
           * signed. Nothing reads it today, because recording is done by the
           * browser calling recordUploadAction rather than by that callback (see
           * app/actions/media.ts for why). It is set anyway: if the callback is
           * ever switched on, the tenant has to come from something the browser
           * cannot edit, and this is that thing.
           */
          tokenPayload: JSON.stringify({ tenantId }),
        };
      },

      /*
       * Required by the SDK, deliberately empty.
       *
       * This is the store's signed server-to-server callback, and it cannot reach
       * a development machine because localhost is not on the internet. Recording
       * uploads here would make the recording step testable only in production,
       * for a feature whose entire job is recording things. So the browser calls
       * recordUploadAction instead and this stays a no-op.
       */
      onUploadCompleted: async () => {
        // Nothing. See above.
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    /*
     * 400, not 500. Every throw that reaches here is a refusal: a pathname
     * outside the tenant's prefix, a body that is not a token request, a
     * signature that does not verify. None of them is a fault on our side, and
     * returning 500 for them would put a client's mistyped upload into the error
     * logs alongside real failures.
     */
    const message = error instanceof Error ? error.message : 'That upload was refused.';
    if (!message.includes('does not belong to this site') && !message.includes('not usable')) {
      console.error('[tg-sites] upload token refused', error);
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
