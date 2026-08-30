/**
 * The site-wide floating widgets' containers and scripts, one per enabled widget.
 *
 * CONDITIONAL, the rule the rest of this tree keeps: a page that enables nothing
 * ships nothing. For each widget a client turned on it emits an empty container
 * carrying the config INLINE (data-tg-config) plus the one external widget
 * script. The widget finds its container, reads the inline JSON and draws its own
 * fixed-position UI, with no widget id and no cross-origin config fetch.
 *
 * THE SAME PATTERN AS WidgetScripts, not a new one: the script is loaded from
 * WIDGET_ORIGIN exactly as a placed widget's is (floatingWidgetScriptUrl builds
 * the src from a CLOSED tag list, so nothing a client typed becomes a url). The
 * difference is only that this is emitted once per page from settings rather than
 * from a block in a column, and that the config travels in the attribute.
 *
 * NO CLIENT REACT and NO SITE_ASSETS entry: these scripts are cross-origin
 * (WIDGET_ORIGIN), not local public/ files, so unlike CookieConsent they are not
 * in the middleware allowlist. The config attribute is a JSX attribute, so React
 * escapes it; the schema has already reduced the config to sanitised primitives.
 *
 * NEVER IN THE EDITOR. Like WidgetScripts and CookieConsent this is only in the
 * published tree, so a client cannot preview a floating widget on the canvas. The
 * settings panel says so.
 */

import { Fragment, type ReactElement } from 'react';

import type { SiteSettings } from '../../lib/settings/schema';
import { enabledFloatingWidgets } from '../../lib/settings/floating-widgets';
import { floatingWidgetScriptUrl } from '../../lib/content/widgets';

export function FloatingWidgets({ settings }: { settings: SiteSettings }): ReactElement | null {
  const widgets = enabledFloatingWidgets(settings.floatingWidgets);
  if (widgets.length === 0) return null;

  return (
    <>
      {widgets.map((widget) => (
        <Fragment key={widget.tag}>
          {/* An empty container: the widget draws its own fixed-position UI. Not
              hidden, because a display:none container would hide the widget's
              own shadow content with it. The config is inline, so no data-tg-id. */}
          <div data-tg-widget={widget.tag} data-tg-config={JSON.stringify(widget.config)} />
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <script src={floatingWidgetScriptUrl(widget.tag)} defer />
        </Fragment>
      ))}
    </>
  );
}
