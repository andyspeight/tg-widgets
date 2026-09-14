/**
 * Turning a registry widget into the shape Travelify's directory expects.
 *
 * One place for the mapping so the directory and My Widgets can never describe
 * the same widget differently, which is the acceptance criterion that all three
 * touchpoints (directory, my widgets, SSO) use the identical widgetId.
 */
import { WIDGET_REGISTRY, WIDGETS_BY_ID } from '../widget-registry.js';
import { publicCategoryFor } from '../widget-public-categories.js';

/** Where the pre-rendered preview images live. */
export const PREVIEW_PATH = '/previews';

/**
 * The contract object for one widget.
 *
 * imageUrl is absolute by construction: Travelify renders it straight into an
 * <img>, so a relative path would resolve against their origin, not ours.
 */
export function toDirectoryEntry(widget, origin) {
  return {
    widgetId: widget.id,
    name: widget.name,
    category: publicCategoryFor(widget.id),
    description: widget.description,
    imageUrl: `${origin}${PREVIEW_PATH}/${widget.id}.png`,
  };
}

/**
 * Is this widget included in the given plan?
 *
 * The registry's access map uses -1 for unlimited and 0 for not included, and
 * a widget available on a plan is always unlimited there. An unrecognised plan
 * resolves to nothing rather than everything, so a client whose plan we cannot
 * read sees an empty directory instead of widgets they cannot save.
 */
export function isInPlan(widget, plan) {
  if (!plan) return false;
  const limit = widget.access?.[plan];
  return typeof limit === 'number' && limit !== 0;
}

/**
 * The widgets an application may actually use: in their plan, and released.
 *
 * Andy's call (14 Sep 2026): the directory shows only what the client is
 * entitled to. Sending everything and letting them click into a widget the
 * save API then refuses is a dead end inside our editor, and the contract has
 * no field to mark a locked widget. Coming-soon widgets are excluded for the
 * same reason: they cannot be created yet.
 */
export function entitledWidgets(plan, statuses = {}) {
  return WIDGET_REGISTRY.filter((w) => {
    if (!isInPlan(w, plan)) return false;
    const status = statuses[w.id] || w.status;
    return status !== 'coming-soon';
  });
}

/**
 * Map an Airtable WidgetType back to its registry widget.
 *
 * My Widgets counts rows on the Widgets table, which stores the Title Case
 * WidgetType ("Google Reviews"), not the slug ("reviews"). Matching is
 * case-insensitive because the singleSelect has been edited by hand over time.
 */
const BY_AIRTABLE_TYPE = new Map(
  WIDGET_REGISTRY.map((w) => [w.airtableType.toLowerCase(), w]),
);

export function widgetForAirtableType(type) {
  if (typeof type !== 'string') return null;
  return BY_AIRTABLE_TYPE.get(type.trim().toLowerCase()) || null;
}

export { WIDGET_REGISTRY, WIDGETS_BY_ID };
