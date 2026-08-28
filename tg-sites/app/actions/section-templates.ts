'use server';

/**
 * Server actions for a client's saved section templates.
 *
 * List is a read any member can do; saving and deleting a template is a
 * content change, gated on the 'content' capability the same way editing a
 * page is. The section is sanitised in the db layer before it is stored, so
 * nothing here trusts the incoming shape.
 */

import { revalidatePath } from 'next/cache';

import { currentUserId, requireSite } from '../../lib/auth/session';
import { isPermissionError, requireCapability } from '../../lib/auth/capabilities';
import {
  deleteSectionTemplate,
  listSectionTemplates,
  saveSectionTemplate,
  type SectionTemplate,
} from '../../lib/db/section-templates';

export type TemplateListResult =
  | { ok: true; data: SectionTemplate[] }
  | { ok: false; error: string };

export type TemplateSaveResult =
  | { ok: true; data: SectionTemplate }
  | { ok: false; error: string };

const MAX_NAME = 80;

function explain(error: unknown, fallback: string): string {
  if (isPermissionError(error)) return (error as Error).message;
  console.error('[tg-sites] section template action failed', error);
  return fallback;
}

export async function listSectionTemplatesAction(): Promise<TemplateListResult> {
  try {
    const site = await requireSite();
    return { ok: true, data: await listSectionTemplates(site.tenantId) };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not load your saved sections.') };
  }
}

export async function saveSectionTemplateAction(input: unknown): Promise<TemplateSaveResult> {
  try {
    const tenantId = await requireCapability('content');
    const userId = await currentUserId();

    const fields = (input ?? {}) as Record<string, unknown>;
    const name = typeof fields.name === 'string' ? fields.name.trim().slice(0, MAX_NAME) : '';
    if (!name) return { ok: false, error: 'Give the section a name so you can find it again.' };

    const saved = await saveSectionTemplate(tenantId, name, fields.section, userId ?? undefined);
    if (!saved) {
      return {
        ok: false,
        error: 'That section could not be saved. You may have reached the limit of saved sections.',
      };
    }
    revalidatePath('/editor');
    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not save that section.') };
  }
}

export async function deleteSectionTemplateAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const tenantId = await requireCapability('content');
    const id = typeof (input as Record<string, unknown>)?.id === 'string' ? String((input as Record<string, unknown>).id) : '';
    if (!id) return { ok: false, error: 'No template to delete.' };
    await deleteSectionTemplate(tenantId, id);
    revalidatePath('/editor');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error, 'Could not delete that saved section.') };
  }
}
