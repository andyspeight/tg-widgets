/**
 * The header and the footer.
 *
 * A region is sections, exactly as a page is, so this is a thin wrapper around
 * the SAME SectionRenderer the page uses. That is the whole design: every block
 * in the library works in a header because a header is not a special kind of
 * thing, and the editor can edit one without knowing it is doing anything
 * unusual.
 *
 * ITS OWN QUERY CONTAINER, NOT THE PAGE'S. `.tgs-page` declares
 * `container-type: inline-size`, which is what makes the breakpoints in
 * globals.css answer to the editor's phone and tablet previews rather than to
 * the real window. A header needs the same, so it carries the same class. It is
 * a SIBLING of the page rather than a wrapper around it, and that matters: a
 * `.tgs-page` around the lot would put `overflow-x: hidden` between a sticky
 * header and the document, and an overflow ancestor is exactly what stops
 * `position: sticky` sticking.
 *
 * NOTHING RENDERS FOR AN EMPTY REGION. A client who has never touched their
 * footer gets no empty `<footer>` on the page, rather than markup claiming a
 * landmark with nothing in it.
 *
 * THERE IS NO EDITABLE MODE HERE, and that is deliberate rather than missing.
 * The editor works on a Page and the region screen hands it the region's
 * sections wrapped as one, so the canvas draws `.tgs-page` and never this. Which
 * is just as well: `sticky` and `overlay` take the header out of the normal flow,
 * and a canvas whose content floats over itself would be unusable to edit.
 */

import { Fragment, type CSSProperties, type ReactElement } from 'react';
import type { Region } from '../../lib/content/schema';
import type { PreparedMap } from '../../lib/content/prepared';
import { SectionRenderer } from './PageRenderer';

export function RegionRenderer({
  region,
  theme,
  overlapped,
  prepared,
}: {
  region: Region | null;
  /** The tenant's theme as custom properties, as PageRenderer takes it. */
  theme?: CSSProperties;
  /**
   * The page's first section pulls up under this header, so the header goes
   * see-through and lets the picture show through. Decided by the caller, since
   * only it can see both the header and the page: the two are siblings with no
   * wrapper, so no CSS `:has()` can reach from one to the other. Header only.
   */
  overlapped?: boolean;
  /**
   * Markup the server has already cleaned, by block id. A header or a footer can
   * hold an imported design the same as a page can, so it needs the same channel.
   * See lib/content/prepared.ts.
   */
  prepared?: PreparedMap;
}): ReactElement | null {
  if (!region || region.sections.length === 0) return null;

  const Tag = region.region === 'header' ? 'header' : 'footer';

  return (
    <Tag
      className="tgs-page tgs-region"
      style={theme}
      data-region={region.region}
      /*
       * Only when true, so the attribute selectors in globals.css do the work
       * and an ordinary header stays plain markup. Both are header-only, which
       * the CSS enforces by naming the region rather than trusting nobody to set
       * them on a footer.
       */
      data-sticky={region.sticky ? 'true' : undefined}
      data-overlay={region.overlay ? 'true' : undefined}
      data-overlapped={overlapped && region.region === 'header' ? 'true' : undefined}
    >
      {region.sections.map((section, index) => (
        <Fragment key={section.id}>
          {/*
            A header's bottom divider HANGS below the bar in the bar's own
            colour: the MOKSHA wave. A region has no next section for the
            ordinary neighbour-reaching-up treatment, and the silhouette is
            what the design means here. See SectionRenderer.hangBottomDivider.
          */}
          <SectionRenderer
            section={section}
            index={index}
            prepared={prepared}
            hangBottomDivider={region.region === 'header' && index === region.sections.length - 1}
          />
        </Fragment>
      ))}
    </Tag>
  );
}
