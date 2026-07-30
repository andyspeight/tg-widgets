/**
 * In-memory stand-ins for the settings actions, harness only.
 *
 * The satisfies clauses are what make "the doubles still match" a checked claim.
 * Note loadCustomCodeAction SUCCEEDS here regardless of who is asking: the real one
 * refuses anybody but the owner or us, and the harness is testing the SCREEN, not
 * the gate. The gate is asserted by tests/settings.test.ts and by reading the
 * action, and pretending to enforce it here would test the double rather than the
 * product.
 */

import { parseSettings, parseStaffSettings } from '../lib/settings/schema';

let settings = parseSettings({ gtmId: 'GTM-ABC1234', faviconUrl: '/f.png' });
let code = parseStaffSettings({
  headHtml: '<meta name="verify" content="abc123">',
  bodyHtml: '<script src="https://chat.example/w.js" async></script>',
});

export async function saveSettingsAction(input: unknown) {
  settings = parseSettings(input);
  return { ok: true as const, data: settings };
}

export async function loadSettingsAction() {
  return { ok: true as const, data: { settings, canEditCode: true } };
}

export async function loadCustomCodeAction() {
  return { ok: true as const, data: code };
}

export async function saveCustomCodeAction(input: unknown) {
  code = parseStaffSettings(input);
  return { ok: true as const, data: code };
}

import type * as real from '../app/actions/settings';

const _save = saveSettingsAction satisfies typeof real.saveSettingsAction;
const _load = loadSettingsAction satisfies typeof real.loadSettingsAction;
const _loadCode = loadCustomCodeAction satisfies typeof real.loadCustomCodeAction;
const _saveCode = saveCustomCodeAction satisfies typeof real.saveCustomCodeAction;
void _save; void _load; void _loadCode; void _saveCode;
