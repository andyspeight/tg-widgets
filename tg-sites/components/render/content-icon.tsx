/**
 * One icon from the library, drawn.
 *
 * NO innerHTML, ANYWHERE. The package stores each icon as a string of SVG, and
 * the obvious component is four lines with dangerouslySetInnerHTML in the
 * middle of them. This is not that, on purpose: lib/content/icons.ts parses the
 * string into a list of elements and attributes checked against a whitelist,
 * and this builds real React elements from that list. The difference is not
 * theoretical. With innerHTML, the safety of every client's page rests on the
 * contents of a file in node_modules staying what it was on the day we looked;
 * this way the only thing that can ever reach the DOM is one of five shapes
 * with seventeen possible attributes, whatever the file says tomorrow.
 *
 * A CHARACTER STILL WORKS. Every icon on every page built before 1 Aug 2026 is
 * a typed emoji or symbol, and those pages must keep drawing what they drew.
 * So the value is looked up first and drawn as an icon if it is one, and
 * printed as text if it is not. That is also what makes the field forgiving:
 * somebody who types a flag emoji gets a flag emoji.
 *
 * DECORATIVE, ALWAYS. An icon in this product sits beside a title that says
 * the same thing in words, so announcing it would read the point twice. There
 * is no arrangement here where the icon is the only carrier of meaning: the
 * Icon and text block has a title, and a bare icon with no words is not
 * something the block library offers.
 */
import type { ReactElement } from 'react';

import { iconShapes, REACT_ATTRIBUTE_NAMES } from '../../lib/content/icons';

/**
 * True when this value names an icon, so a caller can choose its own markup
 * for the two cases. The Icon and text block uses it to decide whether it is
 * drawing a picture or setting a character.
 */
export { isIconName } from '../../lib/content/icons';

export function ContentIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}): ReactElement | null {
  const shapes = iconShapes(name);
  if (!shapes) return null;

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      // The set is drawn as outlines on a 24 by 24 grid, so the colour comes
      // from the text around it and the weight is fixed by the drawing. Both
      // are already in the data; naming them here would only be a second place
      // for them to disagree.
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map((shape, index) => {
        const Element = shape.element;
        const props: Record<string, string> = {};

        for (const [key, value] of Object.entries(shape.attributes)) {
          const reactName = REACT_ATTRIBUTE_NAMES[key];
          // Unmapped means unwhitelisted, since the two lists are checked
          // against each other by test. Dropped rather than guessed at.
          if (reactName) props[reactName] = value;
        }

        return <Element key={index} {...props} />;
      })}
    </svg>
  );
}
