/**
 * The prepare action, for the standalone build only.
 *
 * The real one calls currentUserId, which reaches Postgres, and imports a module
 * marked `server-only`. Neither can exist in a file served from a static host.
 *
 * IT KEEPS THE REAL CLEANING and drops only the auth, the same bargain
 * demo-import-actions makes. That matters more here than anywhere else: this is
 * the answer the canvas draws imported designs and embeds FROM, so a double that
 * handed back the input unchanged would let the harness pass while the live
 * editor showed something different. parse5 and postcss end up in this bundle as
 * a result, which is fine: it is a test artifact, and keeping them out of the
 * PRODUCT's editor bundle is the whole point of the arrangement it is testing.
 */

import { cleanImportHtml } from '../lib/import/html';
import { importScopeClass, scopeImportCss } from '../lib/import/css';
import { sanitiseEmbedHtml } from '../lib/content/sanitise-embed';
import { needsPreparing, type PreparedMap } from '../lib/content/prepared';
import type { ActionResult } from '../app/actions/pages';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function prepareBlocksAction(blocks: unknown): Promise<ActionResult<PreparedMap>> {
  if (!Array.isArray(blocks)) return { ok: true, data: {} };

  const out: PreparedMap = {};
  for (const entry of blocks.slice(0, 60)) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const id = str(raw.id).slice(0, 64);
    const type = str(raw.type);
    if (!id || !needsPreparing(type)) continue;

    if (type === 'embed') {
      const html = sanitiseEmbedHtml(str(raw.html));
      if (html) out[id] = { html, css: '' };
      continue;
    }

    const { html } = cleanImportHtml(str(raw.html));
    const { css } = scopeImportCss(str(raw.css), { scope: `.${importScopeClass(id)}` });
    if (html.trim() || css) out[id] = { html, css };
  }

  return { ok: true, data: out };
}

// Compile-time proof that the double still matches the real thing.
import type * as real from '../app/actions/prepare';

const _prepare = prepareBlocksAction satisfies typeof real.prepareBlocksAction;
void _prepare;
