/**
 * Making a size set on the WORDS scale with the screen.
 *
 * THE BUG THIS EXISTS FOR (Andy, 25 Aug 2026). Auto-resize is a rule on
 * `.tgs-heading` / `.tgs-text` that swaps the element's font-size for a clamp.
 * A size set on a phrase is an INLINE font-size on a span inside that element,
 * and an inline style beats any selector, so the clamp never reached it: a
 * heading sized through the toolbar sat at one size on every screen while the
 * toggle said it was resizing. Measured in Chromium against the shipped
 * stylesheet: 100px at 1618, 1100, 834 and 390 alike, where a block-level size
 * went 100 / 99 / 75 / 62.
 *
 * It was not a small corner. The block-level Text size control offers the theme
 * sizes and a fixed scale topping out at 2.5rem, so anything larger than 40px
 * COULD ONLY be set on the words. The one control that could express a hero
 * headline was the one that silently switched auto-resize off.
 *
 * WHY A CUSTOM PROPERTY RATHER THAN WRITING THE CLAMP HERE. The clamp's shape
 * (the 0.62 floor, the 9cqi middle) belongs in globals.css beside the rule it
 * mirrors, or the two drift the first time either is tuned. So this only
 * RESTATES the size as `--tgs-fs-w` and leaves the arithmetic to the stylesheet.
 *
 * The original `font-size` is deliberately KEPT alongside it. The stylesheet
 * rule carries `!important`, which is how a stylesheet beats an inline style, so
 * the clamp wins whenever the CSS is there; and if it ever is not, the words
 * keep the size they were given rather than collapsing to the block's. Belt and
 * braces on a display-only rewrite.
 *
 * DISPLAY ONLY, and that is load-bearing. The editable copy of a block is seeded
 * straight from `block.props` (Canvas.tsx, `host.innerHTML = seedForHost(...)`),
 * never from this output, so nothing here can be typed over and saved back. That
 * matters because `--tgs-fs-w` is not in the sanitiser's allowlist: were it ever
 * to reach a save it would be dropped, and dropping it is the safe direction.
 */

/**
 * Restate every inline font-size in `html` as `--tgs-fs-w` as well.
 *
 * Runs on ALREADY SANITISED html, which is what makes a regex honest here: by
 * this point a style attribute holds nothing but `property: value` pairs drawn
 * from the allowlist in styles.ts, double quoted, so there is no quoting or
 * nesting left to get wrong. Anything it does not recognise it leaves alone.
 *
 * Idempotent: a style attribute that already carries the custom property is
 * returned untouched, so a second pass cannot double up.
 */
export function fluidiseInlineSizes(html: string): string {
  if (typeof html !== 'string' || !html.includes('font-size')) return html;

  return html.replace(/style="([^"]*)"/g, (whole, declarations: string) => {
    if (declarations.includes('--tgs-fs-w')) return whole;
    if (!/font-size\s*:/i.test(declarations)) return whole;

    const next = declarations.replace(
      /font-size\s*:\s*([^;]+)/gi,
      (_match, value: string) => {
        const size = value.trim();
        return `--tgs-fs-w: ${size}; font-size: ${size}`;
      },
    );

    return `style="${next}"`;
  });
}
