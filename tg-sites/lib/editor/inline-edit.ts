/**
 * Which blocks can be typed into on the canvas, and how.
 *
 * The one place that answers "is this block edited in place, and in what field".
 * The editor shell reads it to raise the right block into edit mode and to decide
 * whether the rich formatting toolbar belongs; each editable block's own render
 * marks its editable element with the matching field, and Canvas reads that
 * marker back off the DOM when it commits. A block not listed here is edited only
 * in the properties pane.
 *
 * `rich` is the divide that matters. A rich field stores HTML and gets the
 * formatting toolbar: a paragraph, a heading. A plain field stores text and does
 * not: a quote, whose words were always a plain string and stay one. Making a
 * plain field rich would be a schema change and a sanitiser change; making the
 * words editable where they sit is neither, which is the whole point of doing the
 * plain fields this way.
 */
export interface InlineEditField {
  /** The block prop the on-canvas edit reads and writes. */
  field: string;
  /** Rich stores HTML and raises the toolbar; plain stores text and does not. */
  rich: boolean;
  /** A single line that refuses Enter, because the element cannot nest a block. */
  oneLine: boolean;
}

export function inlineEditableField(blockType: string): InlineEditField | null {
  switch (blockType) {
    case 'text':
      return { field: 'html', rich: true, oneLine: false };
    case 'heading':
      return { field: 'html', rich: true, oneLine: true };
    case 'quote':
      return { field: 'text', rich: false, oneLine: false };
    default:
      return null;
  }
}
