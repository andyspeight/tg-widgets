/**
 * In-memory stand-ins for the settings actions, harness only.
 *
 * The satisfies clauses are what make "the doubles still match" a checked claim.
 * Note loadStaffSettingsAction SUCCEEDS here regardless of the staff flag: the real
 * one refuses, and the harness is testing the SCREEN, not the gate. The gate is
 * asserted by tests/settings.test.ts and by reading the action, and pretending to
 * enforce it here would test the double rather than the product.
 */

import { parseSettings, parseStaffSettings } from '../lib/settings/schema';

let settings = parseSettings({ gtmId: 'GTM-ABC1234', faviconUrl: '/f.png' });
let staff = parseStaffSettings({
  headHtml: '<meta name="verify" content="abc123">',
  bodyHtml: '<script src="https://chat.example/w.js" async></script>',
});

export async function saveSettingsAction(input: unknown) {
  settings = parseSettings(input);
  return { ok: true as const, data: settings };
}

export async function loadSettingsAction() {
  return { ok: true as const, data: { settings, isStaff: true } };
}

export async function loadStaffSettingsAction() {
  return { ok: true as const, data: staff };
}

export async function saveStaffSettingsAction(input: unknown) {
  staff = parseStaffSettings(input);
  return { ok: true as const, data: staff };
}

import type * as real from '../app/actions/settings';

const _save = saveSettingsAction satisfies typeof real.saveSettingsAction;
const _load = loadSettingsAction satisfies typeof real.loadSettingsAction;
const _loadStaff = loadStaffSettingsAction satisfies typeof real.loadStaffSettingsAction;
const _saveStaff = saveStaffSettingsAction satisfies typeof real.saveStaffSettingsAction;
void _save; void _load; void _loadStaff; void _saveStaff;
