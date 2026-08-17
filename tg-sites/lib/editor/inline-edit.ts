/**
 * Which blocks can be typed into on the canvas, and how.
 *
 * The one place that answers "is this block edited in place, and in what field
 * or fields". The editor shell reads it to raise the right block into edit mode
 * and to decide whether the rich formatting toolbar belongs; each editable
 * block's own render marks its editable element with the matching field, and
 * Canvas reads that marker back off the DOM when it commits. A block not listed
 * here is edited only in the properties pane.
 *
 * A block can have MORE THAN ONE editable field: an icon item is its title and
 * its body, each typed into where it sits. When it does, they are all plain,
 * because `rich` is the one thing that only a single-field block ever is.
 *
 * `rich` is the divide that matters. A rich field stores HTML and gets the
 * formatting toolbar: a paragraph, a heading. A plain field stores text and does
 * not: a quote, an icon item's title or body, whose words were always a plain
 * string and stay one. Making a plain field rich would be a schema change and a
 * sanitiser change; making the words editable where they sit is neither, which
 * is the whole point of doing the plain fields this way.
 */
export interface InlineEditField {
  /** The block prop the on-canvas edit reads and writes. */
  field: string;
  /** Rich stores HTML and raises the toolbar; plain stores text and does not. */
  rich: boolean;
  /** A single line that refuses Enter, because a hard break would not survive. */
  oneLine: boolean;
}

/**
 * Every field of a block that is typed into on the canvas, in the order they
 * are read. Empty means the block is edited only in the properties pane.
 *
 * Only a single-field block is ever rich (a paragraph, a heading). The
 * multi-field blocks are plain: an icon item's title and body each render into
 * one paragraph, so a line break typed into either would collapse away on the
 * published page, and refusing it (oneLine) is honest about that.
 */
export function inlineEditableFields(blockType: string): InlineEditField[] {
  switch (blockType) {
    case 'text':
      return [{ field: 'html', rich: true, oneLine: false }];
    case 'heading':
      return [{ field: 'html', rich: true, oneLine: true }];
    case 'quote':
      return [{ field: 'text', rich: false, oneLine: false }];
    case 'icon-item':
      return [
        { field: 'title', rich: false, oneLine: true },
        { field: 'body', rich: false, oneLine: true },
      ];
    case 'list':
      // A list is the one variable-length case: its editable fields are its
      // items, not a fixed set of props. This single plain oneLine entry is what
      // the shell reads to know the block is typed into in place and raises no
      // toolbar; the per-item hosts the render draws carry the real target,
      // data-rt-field="items.N.text", which Canvas seeds and commits by index.
      return [{ field: 'items', rich: false, oneLine: true }];
    default:
      return [];
  }
}

/**
 * The one rich field a block has, if any: what the formatting toolbar keys on.
 *
 * A rich field is only ever a block's sole field, so a block with several
 * fields (all plain) never raises the toolbar. This is the single question the
 * shell asks to decide whether to mount it.
 */
export function richInlineField(blockType: string): InlineEditField | null {
  const fields = inlineEditableFields(blockType);
  return fields.length === 1 && fields[0].rich ? fields[0] : null;
}
