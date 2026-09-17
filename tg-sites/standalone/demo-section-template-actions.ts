/**
 * The per-tenant section template library, for the standalone review copy.
 *
 * Postgres again: the real actions read and write the tenant's saved sections.
 * An empty library rather than a fixture, because the Designed panel's own
 * empty state is then what a reviewer sees, which is the truth about a review
 * copy that has no tenant behind it.
 */

import type * as real from '../app/actions/section-templates';

export async function listSectionTemplatesAction(): Promise<real.TemplateListResult> {
  return { ok: true, data: [] };
}

export async function saveSectionTemplateAction(input: unknown): Promise<real.TemplateSaveResult> {
  void input;
  return { ok: false, error: 'There is no library behind this preview, so nothing was saved.' };
}

export async function deleteSectionTemplateAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  void input;
  return { ok: false, error: 'There is no library behind this preview.' };
}

const _templates = [
  listSectionTemplatesAction satisfies typeof real.listSectionTemplatesAction,
  saveSectionTemplateAction satisfies typeof real.saveSectionTemplateAction,
  deleteSectionTemplateAction satisfies typeof real.deleteSectionTemplateAction,
];
void _templates;
