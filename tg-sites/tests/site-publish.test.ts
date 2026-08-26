/**
 * "Publish site": which pages and regions the sweep touches, and which it leaves.
 *
 * The selection is the one decision the whole feature rests on, so it is pinned
 * here from plain rows in and a plain plan out. The rule that must never drift:
 * a page goes live from a site publish ONLY if it is already live and edited
 * since. A draft, whether never launched or deliberately taken down, is left
 * exactly as it is, so Draft is the switch for "not yet". See
 * lib/publish/site-plan.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  planIsEmpty,
  selectSitePublishTargets,
  type SitePublishPageInput,
  type SitePublishRegionInput,
} from '../lib/publish/site-plan';

function page(over: Partial<SitePublishPageInput>): SitePublishPageInput {
  return {
    id: over.id ?? 'p1',
    title: over.title ?? 'A page',
    slug: over.slug ?? 'a-page',
    status: over.status ?? 'published',
    hasUnpublishedChanges: over.hasUnpublishedChanges ?? false,
  };
}

const noRegions: SitePublishRegionInput[] = [
  { name: 'header', hasUnpublishedChanges: false },
  { name: 'footer', hasUnpublishedChanges: false },
];

describe('selectSitePublishTargets', () => {
  it('publishes a live page that has been edited since', () => {
    const targets = selectSitePublishTargets(
      [page({ id: 'home', status: 'published', hasUnpublishedChanges: true })],
      noRegions,
    );
    expect(targets.pages.map((p) => p.id)).toEqual(['home']);
  });

  it('leaves a live page with no changes alone', () => {
    const targets = selectSitePublishTargets(
      [page({ id: 'home', status: 'published', hasUnpublishedChanges: false })],
      noRegions,
    );
    expect(targets.pages).toHaveLength(0);
  });

  it('NEVER publishes a draft, even one with changes waiting', () => {
    // A brand-new page, or one taken down on purpose: both are drafts, both are
    // held back. This is the whole reason Draft is the "not yet" switch.
    const targets = selectSitePublishTargets(
      [
        page({ id: 'new', status: 'draft', hasUnpublishedChanges: true }),
        page({ id: 'hidden', status: 'draft', hasUnpublishedChanges: false }),
      ],
      noRegions,
    );
    expect(targets.pages).toHaveLength(0);
    expect(targets.draftsHeldBack).toBe(2);
  });

  it('keeps the site list order, so the home page publishes before its children', () => {
    const targets = selectSitePublishTargets(
      [
        page({ id: 'home', slug: '', status: 'published', hasUnpublishedChanges: true }),
        page({ id: 'about', slug: 'about', status: 'published', hasUnpublishedChanges: true }),
        page({ id: 'team', slug: 'about/team', status: 'published', hasUnpublishedChanges: true }),
      ],
      noRegions,
    );
    expect(targets.pages.map((p) => p.id)).toEqual(['home', 'about', 'team']);
  });

  it('carries only the fields the overlay shows', () => {
    const targets = selectSitePublishTargets(
      [page({ id: 'home', title: 'Home', slug: '', status: 'published', hasUnpublishedChanges: true })],
      noRegions,
    );
    expect(targets.pages[0]).toEqual({ id: 'home', title: 'Home', slug: '' });
  });

  it('publishes the header and footer only when they have changes', () => {
    const targets = selectSitePublishTargets([], [
      { name: 'header', hasUnpublishedChanges: true },
      { name: 'footer', hasUnpublishedChanges: false },
    ]);
    expect(targets.regions).toEqual(['header']);
  });

  it('counts every held-back draft, whatever its own change state', () => {
    const targets = selectSitePublishTargets(
      [
        page({ id: 'live', status: 'published', hasUnpublishedChanges: true }),
        page({ id: 'd1', status: 'draft' }),
        page({ id: 'd2', status: 'draft', hasUnpublishedChanges: true }),
      ],
      noRegions,
    );
    expect(targets.draftsHeldBack).toBe(2);
  });
});

describe('planIsEmpty', () => {
  it('is empty when nothing is live-with-edits and no region changed', () => {
    const targets = selectSitePublishTargets(
      [page({ status: 'published', hasUnpublishedChanges: false }), page({ id: 'd', status: 'draft', hasUnpublishedChanges: true })],
      noRegions,
    );
    expect(planIsEmpty(targets)).toBe(true);
  });

  it('is not empty when a page or a region needs publishing', () => {
    expect(
      planIsEmpty(selectSitePublishTargets([page({ status: 'published', hasUnpublishedChanges: true })], noRegions)),
    ).toBe(false);
    expect(
      planIsEmpty(selectSitePublishTargets([], [{ name: 'footer', hasUnpublishedChanges: true }, { name: 'header', hasUnpublishedChanges: false }])),
    ).toBe(false);
  });
});
