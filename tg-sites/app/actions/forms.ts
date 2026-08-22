'use server';

/**
 * Marking an enquiry read.
 *
 * The one mutation the Enquiries screen has, kept as small as it sounds. The
 * gate is site membership via requireTenantId, the same as every other
 * action; the id is checked for shape here and scoped by RLS below, so a
 * guessed id from another site marks nothing.
 */

import { revalidatePath } from 'next/cache';

import { requireTenantId } from '../../lib/auth/session';
import { markSubmissionRead } from '../../lib/db/forms';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function markSubmissionReadAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return;

  const tenantId = await requireTenantId();
  await markSubmissionRead(tenantId, id);
  revalidatePath('/enquiries');
}
