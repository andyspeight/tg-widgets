'use client';

/**
 * The site-wide floating widgets, shown inside the editor's Preview.
 *
 * WHY THIS EXISTS. On a published page the widgets are emitted as plain HTML by
 * FloatingWidgets, so the browser parses the <script> and runs it. The editor
 * canvas is client React, and a <script> element React renders is never executed
 * by the browser. So Preview loads them the one way that does run: it creates the
 * container and the script with the DOM API and appends them, exactly once, when
 * Preview is entered, and removes them when it is left.
 *
 * IN THE CANVAS FRAME, NOT THE DOCUMENT. The host sits inside the canvas frame,
 * which Preview turns into a containing block (a transform, see editor.css), so a
 * widget's position:fixed is relative to the previewed page rather than the whole
 * editor window. A deal bar then sits at the top of the page, not over the
 * editor's own top bar.
 *
 * CLEAN TEARDOWN. Every floating widget draws into a shadow root on its own
 * container, so removing the container on exit takes its UI with it. The scripts
 * stay loaded but inert; re-entering Preview appends fresh containers and scripts
 * and they draw again.
 *
 * A NOTE ON FIDELITY. This is a real, if slightly imperfect, preview: widgets
 * that wait on the page's own scroll (back to top, a scroll-triggered popup) may
 * not fire against the canvas's inner scroll. The published site and the /preview
 * route are the pixel-faithful render; this is the at-a-glance one in the editor.
 */

import { useEffect, useRef } from 'react';

import type { FloatingWidgetsSettings } from '../../lib/settings/schema';
import { enabledFloatingWidgets } from '../../lib/settings/floating-widgets';
import { floatingWidgetScriptUrl } from '../../lib/content/widgets';

export function PreviewWidgets({
  settings,
  active,
}: {
  settings: FloatingWidgetsSettings;
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!active || !host) return undefined;

    const widgets = enabledFloatingWidgets(settings);
    const added: Element[] = [];

    for (const widget of widgets) {
      const container = document.createElement('div');
      container.setAttribute('data-tg-widget', widget.tag);
      // setAttribute takes a raw string; no HTML escaping is needed or wanted,
      // and the schema has already reduced the config to sanitised primitives.
      container.setAttribute('data-tg-config', JSON.stringify(widget.config));
      host.appendChild(container);
      added.push(container);

      const script = document.createElement('script');
      script.src = floatingWidgetScriptUrl(widget.tag);
      // A script created and appended this way runs on load, and re-runs its
      // init over whatever containers are present, so a fresh Preview redraws.
      host.appendChild(script);
      added.push(script);
    }

    return () => {
      for (const element of added) element.remove();
    };
    // Re-run when Preview is toggled or the widget settings change.
  }, [active, settings]);

  // The host is inert; the widgets draw their own fixed UI into it.
  return <div ref={hostRef} className="ed-preview-widgets" aria-hidden />;
}
