/**
 * Turning a pasted video link into something embeddable.
 *
 * Lives in lib rather than beside the video component because it is pure URL
 * handling with a security boundary in it, and it needs to be testable
 * without dragging JSX into the test runner.
 */

import { safeUrl } from './sanitise';

export type ResolvedVideo =
  | { kind: 'iframe'; src: string }
  | { kind: 'file'; src: string };

/**
 * Returns an embeddable source, or null if the link is not one we support.
 *
 * Null is a real outcome, not a failure: the block renders a "paste a link"
 * placeholder for it. Anything not recognised is refused rather than passed
 * through, so a hostile URL cannot reach an iframe src.
 */
export function resolveVideo(rawUrl: string): ResolvedVideo | null {
  const url = safeUrl(rawUrl);
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url, 'https://tgsites.io');
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '');

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const id = parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).pop();
    // youtube-nocookie keeps a bare embed out of the visitor's ad profile,
    // which also keeps the cookie banner honest.
    if (id) {
      return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` };
    }
  }

  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    if (id) {
      return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` };
    }
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = parsed.pathname.split('/').filter(Boolean).find((part) => /^\d+$/.test(part));
    if (id) return { kind: 'iframe', src: `https://player.vimeo.com/video/${encodeURIComponent(id)}` };
  }

  if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) return { kind: 'file', src: url };

  return null;
}
