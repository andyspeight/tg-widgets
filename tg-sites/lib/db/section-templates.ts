/**
 * A client's saved section templates: per-tenant, reusable in the editor.
 *
 * A section the client has got right, kept to drop onto the next page rather
 * than rebuild. One sanitised Section per row (db/migrations/0032). Everything
 * goes through withTenant so the row policy does the isolation, the same shape
 * as fonts.ts and pages.ts. App only: a template is an editor convenience and
 * is never rendered on a published page, so there is no renderer path here.
 */

import 'server-only';

import type { Section } from '../content/schema';
import { parsePage } from '../content/schema';
import { sanitisePage } from '../content/sanitise-page';
import { withTenant, type Tx } from './withTenant';

function json(tx: Tx, value: unknown) {
  return tx.json(value as Parameters<Tx['json']>[0]);
}

export interface SectionTemplate {
  id: string;
  name: string;
  section: Section;
}

/** The longest a template name may be. */
const MAX_NAME = 80;
/** The most templates a tenant can keep, so the picker stays a list not a heap. */
const MAX_TEMPLATES = 60;

/**
 * Validate and sanitise a section the same way a page save does, so a template
 * can never carry markup a stored page could not. Null when it is not usable.
 */
function cleanSection(raw: unknown): Section | null {
  const parsed = parsePage({
    version: 1,
    id: 'pg_tmpl',
    title: 'Template',
    slug: '',
    seo: { noindex: false },
    sections: [raw],
  });
  if (!parsed.ok) return null;
  return sanitisePage(parsed.page).sections[0] ?? null;
}

function toTemplate(row: Record<string, unknown>): SectionTemplate | null {
  const section = cleanSection(
    typeof row.content === 'string' ? safeJson(row.content) : row.content,
  );
  if (!section) return null;
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    section,
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** This tenant's saved templates, newest first. */
export async function listSectionTemplates(tenantId: string): Promise<SectionTemplate[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx`
      select id, name, content
      from public.section_templates
      order by created_at desc
      limit ${MAX_TEMPLATES}
    `;
    return (rows as Record<string, unknown>[]).map(toTemplate).filter((t): t is SectionTemplate => t !== null);
  });
}

/**
 * Save a section as a template, sanitised. Returns the stored template, or null
 * when the section could not be used or the tenant is already at the cap.
 */
export async function saveSectionTemplate(
  tenantId: string,
  name: string,
  rawSection: unknown,
  userId?: string,
): Promise<SectionTemplate | null> {
  const section = cleanSection(rawSection);
  if (!section) return null;
  const cleanName = name.trim().slice(0, MAX_NAME);

  return withTenant(tenantId, async (tx) => {
    const [count] = await tx`select count(*)::int as n from public.section_templates`;
    if (Number((count as { n: number }).n) >= MAX_TEMPLATES) return null;

    const [row] = await tx`
      insert into public.section_templates (tenant_id, name, content, created_by)
      values (${tenantId}::uuid, ${cleanName}, ${json(tx, section)}, ${userId ?? null}::text)
      returning id, name, content
    `;
    return toTemplate(row as Record<string, unknown>);
  });
}

/** Delete one template. Missing is a no-op. */
export async function deleteSectionTemplate(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx`delete from public.section_templates where id = ${id}::uuid`;
  });
}
