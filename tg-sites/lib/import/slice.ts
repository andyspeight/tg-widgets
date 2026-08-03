/**
 * Reading a section captured by the TG Slicer.
 *
 * WHAT THIS LINKS. The Slicer (tg-slicer/, a Chrome extension) captures any
 * section off any live site as { html, css }: faithful markup and a scoped
 * stylesheet. This editor already imports { html, css } and cuts it into
 * editable sections. The only gap between the two was the shape of the handoff:
 * the Slicer copies ONE bundle, and the import screen wants the markup and the
 * stylesheet in two fields. This closes that gap, so a section copied from
 * another site pastes straight in.
 *
 * IT TAKES EITHER THING THE SLICER COPIES:
 *  - "Copy for Travelgenix Sites" / "Copy slice JSON": a JSON object with `html`
 *    and `css`. Read the two straight off it.
 *  - "Copy HTML+CSS": one self-contained document with the styles in <style>
 *    tags. The import cleaner strips <style> for safety, so the CSS would arrive
 *    lost unless it is lifted out here first.
 *
 * ANYTHING ELSE IS NOT A SLICE, and returns null so the plain paste path is left
 * exactly as it was: a person typing HTML into the box is not pasting a bundle.
 */

export interface Slice {
  html: string;
  css: string;
}

export function readSlice(text: string): Slice | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // A JSON bundle, as the Slicer's copy-for-sites gives. meta and anything else
  // on the object is ignored; only the two fields the import needs are read.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.html === 'string' && parsed.html.trim()) {
        return {
          html: parsed.html,
          css: typeof parsed.css === 'string' ? parsed.css : '',
        };
      }
    } catch {
      // Not JSON after all. Fall through: it may be a self-contained document.
    }
  }

  // A self-contained document: pull every <style> block into the stylesheet and
  // take it out of the markup, because cleanImportHtml refuses <style> and the
  // design would otherwise arrive with nothing to style it.
  if (/<style[\s>]/i.test(trimmed)) {
    const styles: string[] = [];
    const html = trimmed.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_match, body) => {
      styles.push(String(body));
      return '';
    });
    if (styles.length) {
      return { html: html.trim(), css: styles.join('\n\n').trim() };
    }
  }

  return null;
}
