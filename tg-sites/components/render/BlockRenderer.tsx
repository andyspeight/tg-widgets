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
import type { PreparedMap } from '../../lib/content/prepared';
import type { ImageSizes } from '../../lib/content/image-sizes';
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
  SearchBlock,

  ExpandingCardsBlock,
  FlipCardsBlock,
  HalfOverlayBlock,
  ScreenCarouselBlock,
  RatingBlock,
  ShiftingImagesBlock,
  TagsBlock,
  TooltipBlock,
  StackedCardsBlock,
  SliderBlock,
  SocialBlock,
  BreadcrumbsBlock,
  CopyrightBlock,
  CouponBlock,
  WhatsAppBlock,
  IconBlock,
  LocationsBlock,
  ShapeBlock,
  FileBlock,
  FormBlock,
  ReadMoreBlock,
  SpacerBlock,
  StatsBlock,
  StepsBlock,
  TableBlock,
  TabsBlock,
  TestimonialsBlock,
  TextBlock,
  ThemeToggleBlock,
  VideoBlock,
  WidgetBlock,
} from './blocks';

export function BlockRenderer({
  block,
  editable = false,
  editingHost = false,
  editorCanvas = false,
  prepared,
  sizes,
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
  /**
   * Markup the server has already cleaned, by block id. The embed and the
   * imported design read their own entry from here; every other block ignores
   * it. See lib/content/prepared.ts for why it arrives beside the tree rather
   * than on the block's own props.
   */
  prepared?: PreparedMap;
  /** Stored sizes by url, for an srcset. See lib/content/image-sizes.ts. */
  sizes?: ImageSizes;
}): ReactElement | null {
  const props = block.props ?? {};

  const body = (() => {
    switch (block.type) {
      case 'heading':
        return <HeadingBlock props={props} editingHost={editingHost} />;
      case 'text':
        return <TextBlock props={props} editingHost={editingHost} />;
      case 'quote':
        return <QuoteBlock props={props} editingHost={editingHost} />;
      case 'list':
        return <ListBlock props={props} editingHost={editingHost} />;
      case 'icon-item':
        return <IconItemBlock props={props} editingHost={editingHost} />;
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
        return <ImageBlock props={props} editing={editable} sizes={sizes} />;
      case 'video':
        return <VideoBlock props={props} />;
      case 'gallery':
        return <GalleryBlock props={props} blockId={block.id} />;
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
      case 'half-overlay':
        return <HalfOverlayBlock props={props} />;
      case 'expanding-cards':
        return <ExpandingCardsBlock props={props} blockId={block.id} />;
      case 'screen-carousel':
        return <ScreenCarouselBlock props={props} />;
      case 'flip-cards':
        return <FlipCardsBlock props={props} blockId={block.id} />;
      case 'stacked-cards':
        return <StackedCardsBlock props={props} />;
      case 'shifting-images':
        return <ShiftingImagesBlock props={props} editing={editable} />;
      case 'rating':
        return <RatingBlock props={props} />;
      case 'tooltip':
        return <TooltipBlock props={props} blockId={block.id} />;
      case 'tags':
        return <TagsBlock props={props} />;
      case 'button':
        return <ButtonBlock props={props} />;
      case 'button-group':
        return <ButtonGroupBlock props={props} />;
      case 'nav':
        return <NavBlock props={props} />;
      /*
       * `editable` tells the search box to render as a div with a read-only
       * field rather than a live form, so typing a query on the canvas cannot
       * navigate the editor away. Same reason the map and the logos take it.
       */
      case 'search':
        return <SearchBlock props={props} editing={editable} />;
      case 'theme-toggle':
        return <ThemeToggleBlock props={props} editing={editable} />;
      case 'social':
        return <SocialBlock props={props} />;
      case 'table':
        return <TableBlock props={props} />;
      case 'divider':
        return <DividerBlock props={props} />;
      case 'spacer':
        return <SpacerBlock props={props} />;
      /*
       * `editable` because the canvas has no address to build a trail from: the
       * editor is drawing a page nobody has requested at a URL, so the block
       * shows a worked example there rather than drawing nothing while a client
       * tries to position it.
       */
      /*
       * Takes the block's own id, the same as accordion and tabs, because the
       * label has to name a checkbox and the two must agree between the server
       * and the client. `editable` makes that checkbox inert, so clicking a
       * preview to select the block does not fold the text under the pointer.
       */
      /* `editable` keeps an expired coupon on the canvas, so a client can see
         and fix the thing they are editing. On a live page it goes. */
      case 'whatsapp':
        return <WhatsAppBlock props={props} />;
      /*
       * The form takes the block id (its :target ids and control ids hang off
       * it) and whether this tree is the editor, where it must be a picture of
       * a form rather than a working one: no action, submit disabled.
       */
      case 'form':
        return <FormBlock props={props} blockId={block.id} editing={editorCanvas} />;
      case 'coupon':
        return <CouponBlock props={props} editing={editable} />;
      case 'locations':
        return <LocationsBlock props={props} />;
      case 'icon':
        return <IconBlock props={props} />;
      case 'shape':
        return <ShapeBlock props={props} />;
      case 'copyright':
        return <CopyrightBlock props={props} />;
      case 'read-more':
        return <ReadMoreBlock props={props} blockId={block.id} editing={editable} />;
      case 'file':
        return <FileBlock props={props} />;
      case 'breadcrumbs':
        return <BreadcrumbsBlock props={props} editing={editable} />;
      case 'embed':
        return <EmbedBlock props={props} prepared={prepared} blockId={block.id} />;
      /*
       * Takes the block's own id, which becomes the class its stylesheet is
       * scoped to. Same reason accordion and tabs take it: nothing else in this
       * file needs an id, so it is passed here rather than threaded through
       * every block.
       */
      case 'imported':
        return <ImportedBlock props={props} blockId={block.id} prepared={prepared} sizes={sizes} />;
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
