// Onboarding must tell Luna Chat about a client who is entitled to Luna Chat.
//
// 25 Aug 2026. A client was set up in Client Control, given Luna Chat, and got
// "No Luna Chat client linked to your account" at the dashboard. They were not
// alone: 28 clients had luna_chat enabled in Client Control and Luna Chat held
// 6 client records. Twenty-two people were one login away from that screen.
//
// The cause was one condition in api/admin/clients/create.js:
//
//     if (lunaChatPayload) { await provisionLunaChat(clientRec, true); }
//
// lunaChatPayload is set only when the OPTIONAL Luna Chat section of the
// onboarding form was filled in. That is a different question from whether the
// client has Luna Chat. The entitlement is the one that matters, and a package
// grants luna_chat automatically as a Package Default without anyone touching
// that form section. So the ordinary path created a client who was entitled to
// Luna Chat and did not exist in it.
//
// It now keys off the entitlement. The config block still counts too, so this
// can only ever provision MORE clients than before, never fewer.
//
// Run: node --test test/luna-chat-onboarding-provision.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { entitlementsGrantLunaChat } = await import('../api/_lib/luna-chat-provision.js');
const { CATALOGUE, PRODUCTS } = await import('../api/_lib/auth/schema.js');

const SLUG = CATALOGUE.fields.productSlug;

// A catalogue shaped like the real one: Luna Chat sits among many widgets.
const CAT_LUNA    = { id: 'recHou3GMnZYlrq3a', fields: { [SLUG]: PRODUCTS.slugs.LUNA_CHAT } };
const CAT_WIDGETS = { id: 'recyMgnygDmhyR4kG', fields: { [SLUG]: PRODUCTS.slugs.WIDGET_SUITE } };
const CAT_UNI     = { id: 'recyQyqmNbkeBHxJ1', fields: { [SLUG]: 'luna_university' } };
const CATALOGUE_RECORDS = [CAT_WIDGETS, CAT_LUNA, CAT_UNI];

const ent = (id) => ({ catalogueItemId: id });

// ── the case that broke ──

test('a Package Default luna_chat entitlement counts, with no form section filled in', () => {
  // Tailor Events, 25 Aug: 56 entitlements from the package, luna-chat among
  // them, and nobody touched the optional Luna Chat section.
  const entitlements = [ent(CAT_WIDGETS.id), ent(CAT_UNI.id), ent(CAT_LUNA.id)];
  assert.equal(entitlementsGrantLunaChat(entitlements, CATALOGUE_RECORDS), true);
});

test('luna_chat is found wherever it sits in a long entitlement list', () => {
  // Real clients arrive with 50+ entitlements. Position must not matter.
  const many = Array.from({ length: 55 }, () => ent(CAT_WIDGETS.id));
  assert.equal(entitlementsGrantLunaChat([...many, ent(CAT_LUNA.id)], CATALOGUE_RECORDS), true);
  assert.equal(entitlementsGrantLunaChat([ent(CAT_LUNA.id), ...many], CATALOGUE_RECORDS), true);
});

// ── and the cases that must NOT provision ──

test('a client with no luna_chat entitlement is not sent to Luna Chat', () => {
  const entitlements = [ent(CAT_WIDGETS.id), ent(CAT_UNI.id)];
  assert.equal(entitlementsGrantLunaChat(entitlements, CATALOGUE_RECORDS), false);
});

test('luna_university is not luna_chat', () => {
  // Both are "luna-" prefixed in the catalogue. Matching on the slug, not on
  // the display name, is what keeps them apart.
  assert.equal(entitlementsGrantLunaChat([ent(CAT_UNI.id)], CATALOGUE_RECORDS), false);
});

test('an entitlement pointing at a catalogue item we cannot see is ignored', () => {
  // Fails closed. Guessing "probably Luna Chat" would create records for
  // clients who are not entitled and surface them under Act as.
  assert.equal(entitlementsGrantLunaChat([ent('recUNKNOWN1234567')], CATALOGUE_RECORDS), false);
});

test('empty or malformed input never claims an entitlement', () => {
  [[], null, undefined, 'nope', [null], [{}], [ent(undefined)]].forEach((v) => {
    assert.equal(entitlementsGrantLunaChat(v, CATALOGUE_RECORDS), false,
      'expected false for ' + JSON.stringify(v));
  });
  assert.equal(entitlementsGrantLunaChat([ent(CAT_LUNA.id)], null), false,
    'no catalogue means we cannot know, so do not assume');
  assert.equal(entitlementsGrantLunaChat([ent(CAT_LUNA.id)], [{ id: CAT_LUNA.id }]), false,
    'a catalogue record with no fields must not throw or match');
});

// ── the wiring in the onboarding handler ──

test('onboarding provisions on the ENTITLEMENT, not the optional form section', () => {
  const SRC = read('api/admin/clients/create.js');
  assert.match(SRC, /const grantsLunaChat = entitlementsGrantLunaChat\(activeEntitlements, allCatalogue\)/);
  assert.match(SRC, /if \(grantsLunaChat \|\| lunaChatPayload\) \{/);
  assert.doesNotMatch(SRC, /let lunaChat;\s*\n\s*if \(lunaChatPayload\) \{/,
    'gating on the optional config block alone is the whole defect');
});

test('the decision uses the entitlements actually created, not the ones requested', () => {
  // activeEntitlements is the list after inactive catalogue items are dropped.
  // Using the raw request would provision for a product that was switched off.
  const SRC = read('api/admin/clients/create.js');
  assert.match(SRC, /entitlementsGrantLunaChat\(activeEntitlements,/);
  assert.doesNotMatch(SRC, /entitlementsGrantLunaChat\(entitlements,/);
});

test('supplying the config block still provisions, so nothing regresses', () => {
  // Global Travel Solution came through correctly on 10 Aug via that path.
  // This change must only ever provision more clients, never fewer.
  const SRC = read('api/admin/clients/create.js');
  const cond = SRC.match(/if \((grantsLunaChat \|\| lunaChatPayload)\)/);
  assert.ok(cond, 'expected the OR condition');
});

test('a Luna Chat failure still cannot fail onboarding', () => {
  // The client and their entitlements are already saved by this point. An
  // outage over there must not roll any of that back.
  const SRC = read('api/admin/clients/create.js');
  assert.doesNotMatch(SRC, /await provisionLunaChat\([^)]*\)\s*;\s*\n\s*if \(!lunaChat[\s\S]{0,80}return jsonError/,
    'provisioning must not gate the onboarding response');
  assert.match(SRC, /lunaChatRecordCreated: !!\(lunaChat && lunaChat\.ok\)/);
});

test('the reason for provisioning is logged, so a silent miss is findable', () => {
  const SRC = read('api/admin/clients/create.js');
  assert.match(SRC, /provisioning Luna Chat for/);
  assert.match(SRC, /entitled via catalogue/);
});
