/**
 * Renders designed sections as a real page, for looking at.
 *
 * The entry half of tools/preview-presets.mjs. It mounts the SAME renderer the
 * published site uses, so what comes out is what a client gets, not a drawing
 * of it.
 */
import { renderToStaticMarkup } from 'react-dom/server';

import { PageRenderer } from '../components/render/PageRenderer';
import { buildPresetSection, presetById, SECTION_PRESETS } from '../lib/content/presets';
import { parseTheme } from '../lib/theme/schema';
import { themeTokens } from '../lib/theme/tokens';

const asked: string[] = JSON.parse(process.env.PRESET_IDS || '[]');
const ids = asked.length ? asked : SECTION_PRESETS.map((preset) => preset.id);

const missing = ids.filter((id) => !presetById(id));
if (missing.length) {
  process.stderr.write(`No such preset: ${missing.join(', ')}\n`);
  process.exit(1);
}

const sections = ids.map((id) => buildPresetSection(presetById(id)!));
const html = renderToStaticMarkup(
  <PageRenderer page={{ id: 'preview', title: 'Presets', slug: '/', sections } as never} />,
);

// The theme's own tokens, the same ones the head emitter writes on a real page.
const vars: string[] = [];
const walk = (value: Record<string, unknown>) => {
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') vars.push(`${key.startsWith('--') ? key : `--${key}`}: ${entry};`);
    else if (entry && typeof entry === 'object') walk(entry as Record<string, unknown>);
  }
};
walk(themeTokens(parseTheme({})) as never);

process.stdout.write(JSON.stringify({ html, vars: vars.join('\n'), ids }));
