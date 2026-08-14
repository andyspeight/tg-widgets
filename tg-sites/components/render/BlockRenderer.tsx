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
  AccordionBlock,
  AudioBlock,
  BeforeAfterBlock,
  ButtonBlock,
  ButtonGroupBlock,
  CardsBlock,
  DividerBlock,
  EmbedBlock,
  EmbedWidgetBlock,
  GalleryBlock,
  HeadingBlock,
  IconItemBlock,
  ImageBlock,
  ImportedBlock,
  ListBlock,
  LogosBlock,
  MapBlock,
  NavBlock,
  QuoteBlock,
  SliderBlock,
  SocialBlock,
  SpacerBlock,
  StatsBlock,
  StepsBlock,
  TableBlock,
  TabsBlock,
  TestimonialsBlock,
  TextBlock,
  VideoBlock,
  WidgetBlock,
} from './blocks';

export function BlockRenderer({
  block,
  editable = false,
  editingHost = false,
  editorCanvas = false,
}: {
  block: Block;
  editable?: boolean;
  /** This block is being typed into on the canvas. See TextBlock. */
  editingHost?: boolean;
  /**
   * This tree is the editor canvas, editing OR previewing. Only the widget block
   * reads it, to keep hosting itself in an iframe once Preview turns `editable`
   * off. See the Editable interface in PageRenderer and WidgetBlock.
   */
  editorCanvas?: boolean;
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
      case 'steps':
        return <StepsBlock props={props} />;
      case 'stats':
        return <StatsBlock props={props} />;
      /*
       * These two take the block's own id, which becomes the `name` grouping
       * their controls. Nothing else in this file needs it, so it is passed
       * here rather than threaded through every block.
       */
      case 'accordion':
        return <AccordionBlock props={props} blockId={block.id} />;
      case 'tabs':
        return <TabsBlock props={props} blockId={block.id} />;
      case 'image':
        return <ImageBlock props={props} />;
      case 'video':
        return <VideoBlock props={props} />;
      case 'gallery':
        return <GalleryBlock props={props} />;
      case 'before-after':
        return <BeforeAfterBlock props={props} />;
      case 'testimonials':
        return <TestimonialsBlock props={props} />;
      case 'audio':
        return <AudioBlock props={props} />;
      /*
       * `editing` is true exactly when this is the editor canvas, which is what
       * tells the map to draw a placeholder rather than load a frame that would
       * reload on every keystroke. Same as the widget and embed-widget blocks.
       */
      case 'map':
        return <MapBlock props={props} editing={editable} />;
      case 'logos':
        return <LogosBlock props={props} editing={editable} />;
      case 'cards':
        return <CardsBlock props={props} editing={editable} />;
      case 'slider':
        return <SliderBlock props={props} />;
      case 'button':
        return <ButtonBlock props={props} />;
      case 'button-group':
        return <ButtonGroupBlock props={props} />;
      case 'nav':
        return <NavBlock props={props} />;
      case 'social':
        return <SocialBlock props={props} />;
      case 'table':
        return <TableBlock props={props} />;
      case 'divider':
        return <DividerBlock props={props} />;
      case 'spacer':
        return <SpacerBlock props={props} />;
      case 'embed':
        return <EmbedBlock props={props} />;
      /*
       * Takes the block's own id, which becomes the class its stylesheet is
       * scoped to. Same reason accordion and tabs take it: nothing else in this
       * file needs an id, so it is passed here rather than threaded through
       * every block.
       */
      case 'imported':
        return <ImportedBlock props={props} blockId={block.id} />;
      /*
       * `editorCanvas`, NOT `editable`, tells the widget to host itself in an
       * iframe. The two agree while editing but split in preview: `editable` goes
       * false so the canvas renders the published DOM, yet the bare container the
       * published page uses needs components/render/WidgetScripts.tsx to fill it,
       * and the editor never renders that. `editorCanvas` stays true across the
       * whole canvas, so the widget keeps its own iframe through preview instead
       * of collapsing to an empty box. See the note on WidgetBlock. (The
       * embed-widget block no longer reads the flag: its sealed frame is the same
       * on the canvas and the page.)
       */
      case 'widget':
        return <WidgetBlock props={props} editing={editorCanvas} />;
      case 'embed-widget':
        return <EmbedWidgetBlock props={props} editing={editorCanvas} />;
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
