/**
 * The rendered form of every built-in block.
 *
 * These are plain components with no server-only code, so the published page
 * renders them on the server and the editor preview renders the same ones on
 * the client. One implementation, so the preview cannot drift from the
 * published output.
 *
 * Every one of them treats props as hostile. Props arrive from stored JSON
 * that a client typed into, so each block reads what it needs with a typed
 * accessor and falls back to a default rather than trusting the shape.
 */

import type { CSSProperties, ReactElement } from 'react';
import { safeUrl, sanitiseHtml } from '../../lib/content/sanitise';
import { resolveVideo } from '../../lib/content/video';

type Props = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Prop accessors
// ---------------------------------------------------------------------------

function str(props: Props, key: string, fallback = ''): string {
  const value = props[key];
  return typeof value === 'string' ? value : fallback;
}

function bool(props: Props, key: string, fallback = false): boolean {
  const value = props[key];
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(props: Props, key: string, allowed: readonly T[], fallback: T): T {
  const value = props[key];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function list(props: Props, key: string): Props[] {
  const value = props[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Props => !!item && typeof item === 'object');
}

/** 'auto' means let the image size itself, anything else is an aspect ratio. */
function ratioStyle(ratio: string): CSSProperties {
  return ratio === 'auto' ? {} : { aspectRatio: ratio.replace('/', ' / ') };
}

const ALIGNS = ['left', 'centre', 'right'] as const;
const RADII = ['none', 'sm', 'md', 'lg', 'full'] as const;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * The four visual sizes this block used to have, mapped onto the seven styles.
 *
 * A heading saved before the styles existed carries size: 's' | 'm' | 'l' | 'xl'.
 * Dropping those would resize every heading on every existing page, so they are
 * read and translated. New headings store a style directly.
 */
const LEGACY_SIZE_TO_STYLE = { xl: 'h1', l: 'h2', m: 'h3', s: 'h4' } as const;

export function HeadingBlock({ props }: { props: Props }): ReactElement {
  // The TAG. Still h2 to h4 only: the page title owns the single h1, and a
  // client must not be able to make a second one or skip a level.
  const level = oneOf(props, 'level', ['h2', 'h3', 'h4'] as const, 'h2');

  /*
   * The STYLE, which is how it looks, and is not the tag.
   *
   * Reading `style` first and falling back to the old `size` means a page saved
   * either way renders, and a page saved the old way keeps the size it had.
   */
  const chosen = props.style;
  const style =
    typeof chosen === 'string' && /^h[1-6]$/.test(chosen)
      ? chosen
      : LEGACY_SIZE_TO_STYLE[oneOf(props, 'size', ['s', 'm', 'l', 'xl'] as const, 'm')];

  const text = str(props, 'text');
  const Tag = level;

  return (
    <Tag className="tgs-heading" data-style={style}>
      {text || 'Heading'}
    </Tag>
  );
}

export function TextBlock({ props }: { props: Props }): ReactElement {
  const size = oneOf(props, 'size', ['s', 'm', 'l'] as const, 'm');
  // Sanitised again here even though it was sanitised on save. Stored HTML
  // is never trusted, and this is the last gate before the browser.
  const html = sanitiseHtml(props.html, 'richtext');

  return (
    <div
      className="tgs-text"
      data-size={size}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function QuoteBlock({ props }: { props: Props }): ReactElement {
  const text = str(props, 'text');
  const attribution = str(props, 'attribution');
  const role = str(props, 'role');

  return (
    <figure className="tgs-quote">
      <blockquote className="tgs-quote__text">{text}</blockquote>
      {(attribution || role) && (
        <figcaption className="tgs-quote__by">
          {attribution && <strong>{attribution}</strong>}
          {attribution && role ? ', ' : ''}
          {role}
        </figcaption>
      )}
    </figure>
  );
}

export function ListBlock({ props }: { props: Props }): ReactElement {
  const style = oneOf(props, 'style', ['bullet', 'number', 'tick'] as const, 'bullet');
  const items = list(props, 'items');
  const Tag = style === 'number' ? 'ol' : 'ul';

  return (
    <Tag className="tgs-list" data-style={style}>
      {items.map((item, index) => (
        <li key={index}>{str(item, 'text')}</li>
      ))}
    </Tag>
  );
}

export function IconItemBlock({ props }: { props: Props }): ReactElement {
  const icon = str(props, 'icon', '★');
  const title = str(props, 'title');
  const body = str(props, 'body');

  return (
    <div className="tgs-icon-item">
      {/* Decorative: the title carries the meaning. */}
      <span className="tgs-icon-item__icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        {title && <p className="tgs-icon-item__title">{title}</p>}
        {body && <p className="tgs-icon-item__body">{body}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export function ImageBlock({ props }: { props: Props }): ReactElement {
  const src = safeUrl(str(props, 'src'));
  const alt = str(props, 'alt');
  const ratio = str(props, 'ratio', 'auto');
  const fit = oneOf(props, 'fit', ['cover', 'contain'] as const, 'cover');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const caption = str(props, 'caption');
  const href = safeUrl(str(props, 'href'));

  if (!src) {
    return <div className="tgs-placeholder">Choose an image</div>;
  }

  const picture = (
    <div className="tgs-image__frame" data-radius={radius} style={ratioStyle(ratio)}>
      {/* Plain img rather than next/image: sources are arbitrary client URLs
          and the media pipeline with its own variants lands in a later
          package. width/height come with the media record then, which is
          what removes the layout shift. */}
      <img src={src} alt={alt} loading="lazy" decoding="async" style={{ objectFit: fit }} />
    </div>
  );

  return (
    <div className="tgs-image">
      <figure>
        {href ? <a href={href}>{picture}</a> : picture}
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    </div>
  );
}

export function VideoBlock({ props }: { props: Props }): ReactElement {
  const ratio = str(props, 'ratio', '16/9');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const caption = str(props, 'caption');
  const video = resolveVideo(str(props, 'url'));

  if (!video) {
    return <div className="tgs-placeholder">Paste a YouTube, Vimeo or .mp4 link</div>;
  }

  return (
    <div className="tgs-video">
      <figure style={{ margin: 0 }}>
        <div className="tgs-video__frame" data-radius={radius} style={ratioStyle(ratio)}>
          {video.kind === 'iframe' ? (
            <iframe
              src={video.src}
              title={caption || 'Video'}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          ) : (
            <video src={video.src} controls preload="metadata" />
          )}
        </div>
        {caption && <figcaption className="tgs-image">{caption}</figcaption>}
      </figure>
    </div>
  );
}

export function GalleryBlock({ props }: { props: Props }): ReactElement {
  const columns = oneOf(props, 'columns', ['2', '3', '4'] as const, '3');
  const gap = str(props, 'gap', 'm');
  const radius = oneOf(props, 'radius', RADII, 'md');
  const images = list(props, 'images')
    .map((image) => ({ src: safeUrl(str(image, 'src')), alt: str(image, 'alt') }))
    .filter((image): image is { src: string; alt: string } => !!image.src);

  if (images.length === 0) {
    return <div className="tgs-placeholder">Add some images</div>;
  }

  return (
    <div className="tgs-gallery" data-columns={columns} data-gap={gap}>
      {images.map((image, index) => (
        <div key={index} className="tgs-image__frame" data-radius={radius}>
          <img src={image.src} alt={image.alt} loading="lazy" decoding="async" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function renderButton(button: Props, key: number): ReactElement | null {
  const label = str(button, 'label');
  if (!label) return null;

  const href = safeUrl(str(button, 'href')) || '#';
  const variant = oneOf(button, 'variant', ['primary', 'secondary', 'ghost'] as const, 'primary');
  const size = oneOf(button, 'size', ['s', 'm', 'l'] as const, 'm');
  const newTab = bool(button, 'newTab');

  return (
    <a
      key={key}
      className="tgs-button"
      data-variant={variant}
      data-size={size}
      href={href}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {label}
    </a>
  );
}

export function ButtonBlock({ props }: { props: Props }): ReactElement {
  return <div className="tgs-buttons">{renderButton(props, 0)}</div>;
}

export function ButtonGroupBlock({ props }: { props: Props }): ReactElement {
  const buttons = list(props, 'buttons');
  return <div className="tgs-buttons">{buttons.map(renderButton)}</div>;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function DividerBlock({ props }: { props: Props }): ReactElement {
  const style = oneOf(props, 'style', ['line', 'dashed', 'dots'] as const, 'line');
  const spacing = str(props, 'spacing', 'm');
  return <hr className="tgs-divider" data-style={style} data-spacing={spacing} />;
}

export function SpacerBlock({ props }: { props: Props }): ReactElement {
  const height = oneOf(props, 'height', ['xs', 's', 'm', 'l', 'xl'] as const, 'm');
  return <div className="tgs-spacer" data-height={height} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

export function EmbedBlock({ props }: { props: Props }): ReactElement {
  const html = sanitiseHtml(props.html, 'embed');
  if (!html) return <div className="tgs-placeholder">Paste embed code</div>;
  return <div className="tgs-embed" dangerouslySetInnerHTML={{ __html: html }} />;
}

export { ALIGNS };
