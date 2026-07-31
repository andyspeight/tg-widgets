/**
 * Maps a block's `type` to its component.
 *
 * An unknown type renders nothing and warns, rather than throwing. That is
 * what makes the content model forward compatible: a page saved by a newer
 * build that knows about a block this build does not still renders, minus
 * the one block. The editor shows a clear placeholder for the same case so
 * an agent is never silently missing content.
 */

import type { ReactElement } from 'react';
import type { Block } from '../../lib/content/schema';
import { isKnownBlock } from '../../lib/content/blocks';
import {
  ButtonBlock,
  ButtonGroupBlock,
  DividerBlock,
  EmbedBlock,
  EmbedWidgetBlock,
  GalleryBlock,
  HeadingBlock,
  IconItemBlock,
  ImageBlock,
  ListBlock,
  QuoteBlock,
  SpacerBlock,
  TextBlock,
  VideoBlock,
  WidgetBlock,
} from './blocks';

export function BlockRenderer({
  block,
  editable = false,
  editingHost = false,
}: {
  block: Block;
  editable?: boolean;
  /** This block is being typed into on the canvas. See TextBlock. */
  editingHost?: boolean;
}): ReactElement | null {
  const props = block.props ?? {};

  const body = (() => {
    switch (block.type) {
      case 'heading':
        return <HeadingBlock props={props} editingHost={editingHost} />;
      case 'text':
        return <TextBlock props={props} editingHost={editingHost} />;
      case 'quote':
        return <QuoteBlock props={props} />;
      case 'list':
        return <ListBlock props={props} />;
      case 'icon-item':
        return <IconItemBlock props={props} />;
      case 'image':
        return <ImageBlock props={props} />;
      case 'video':
        return <VideoBlock props={props} />;
      case 'gallery':
        return <GalleryBlock props={props} />;
      case 'button':
        return <ButtonBlock props={props} />;
      case 'button-group':
        return <ButtonGroupBlock props={props} />;
      case 'divider':
        return <DividerBlock props={props} />;
      case 'spacer':
        return <SpacerBlock props={props} />;
      case 'embed':
        return <EmbedBlock props={props} />;
      /*
       * `editable` is what tells these two to draw a placeholder rather than the
       * real thing. It is already true exactly when this tree is the editor's
       * canvas, so nothing new had to be threaded down for it: see the note on
       * WidgetBlock for why the canvas must not run widget scripts.
       */
      case 'widget':
        return <WidgetBlock props={props} editing={editable} />;
      case 'embed-widget':
        return <EmbedWidgetBlock props={props} editing={editable} />;
      default:
        return null;
    }
  })();

  if (body === null) {
    if (!isKnownBlock(block.type)) {
      // eslint-disable-next-line no-console
      console.warn(`[tg-sites] unknown block type "${block.type}", skipping`);
    }
    if (!editable) return null;
    return (
      <div className="tgs-placeholder">
        This block ({block.type}) needs a newer version of the editor
      </div>
    );
  }

  return body;
}
