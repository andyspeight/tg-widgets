/**
 * The networks a Social links block can point at.
 *
 * A CLOSED LIST, AND THAT IS THE SECURITY OF IT. A client picks a network from
 * here and gives an address; they never supply the icon. If the icon were
 * anything a client could set, this block would be a way to put arbitrary SVG on
 * a page, and SVG can carry script. Choosing from our own list means the markup
 * for the picture is entirely ours and the only client input is a URL, which
 * goes through safeUrl like every other.
 *
 * WHY THE LIST IS HERE AND THE SHAPES ARE NEXT DOOR. The drawings live in
 * components/render/social-icons.tsx because they are JSX. This file is plain
 * data so the block definition, the sanitiser and the tests can all read it
 * without a JSX transform, which is the same split the rest of lib/content uses.
 * tests/social.test.ts checks that the two agree, so a network added here and
 * forgotten there fails rather than rendering a hole.
 *
 * MAILTO AND TEL ARE IN THE LIST ON PURPOSE. "Follow us" rows in a footer almost
 * always end with an email address or a phone number, and a client should not
 * have to reach for a second block to add them. safeUrl refuses both schemes by
 * default, so the renderer asks for them explicitly and only for this block.
 */

export interface SocialNetwork {
  id: string;
  /** What it is called, and the accessible name of an icon-only link. */
  label: string;
}

export const SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'x', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'pinterest', label: 'Pinterest' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'tripadvisor', label: 'Tripadvisor' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
];

/** The network with this id, or undefined. The only way an id is resolved. */
export function socialNetwork(id: unknown): SocialNetwork | undefined {
  return typeof id === 'string' ? SOCIAL_NETWORKS.find((network) => network.id === id) : undefined;
}

/** The options for the network picker, in the order above. */
export const SOCIAL_OPTIONS = SOCIAL_NETWORKS.map((network) => ({
  value: network.id,
  label: network.label,
}));
