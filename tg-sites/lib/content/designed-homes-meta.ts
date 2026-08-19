/**
 * The ten designed homepages, as metadata only (Andy, 19 Aug 2026).
 *
 * WHY THIS IS SPLIT FROM designed-homes.ts. The add-a-page picker is a client
 * component, and it needs the id, label and one line for each template, nothing
 * more. The frozen designs themselves are hundreds of kilobytes of imported
 * markup that only the server ever builds. Keeping the metadata here, free of any
 * import of the heavy module, is what keeps that markup out of the editor's
 * browser bundle. The list of fonts lives here too, because the site-creation
 * path reads it to load each design's own typefaces.
 */

export interface DesignedHomeMeta {
  /** The stable id, used as `design-<id>` by a PageTemplate and a Starter. */
  id: string;
  /** The name shown in a picker. */
  label: string;
  /** One line: the kind of agency it suits. */
  description: string;
  /**
   * The home page's search description, written as a real one and carrying no
   * token, so it reads on a brand new site with an empty profile.
   */
  blurb: string;
  /**
   * The Google font families this design names in its CSS. A site built from it
   * imports these into its own library so the type is exact rather than a
   * fallback. The first is the display face, the rest are body and long-read.
   */
  fonts: readonly string[];
}

export const DESIGNED_HOME_META: readonly DesignedHomeMeta[] = [
  {
    id: 'windward-west',
    label: 'Island Time',
    description: 'Warm and sunlit, for a Caribbean or beach specialist.',
    blurb: 'Caribbean and beach holidays from a specialist who has stayed on the islands. Start from this homepage and make it your own.',
    fonts: ['Young Serif', 'Hanken Grotesk'],
  },
  {
    id: 'bucket-and-spade',
    label: 'Family Favourites',
    description: 'Bright and practical, for a family holiday specialist.',
    blurb: 'Family holidays with free child places, kids clubs checked by age and no dawn flights. Start from this homepage and make it your own.',
    fonts: ['Baloo 2', 'Nunito Sans'],
  },
  {
    id: 'sandpiper',
    label: 'School-Holiday Ready',
    description: 'A leaner family site, built around the priced school holidays.',
    blurb: 'Family holidays built around the school-holiday dates, priced for the whole party. Start from this homepage and make it your own.',
    fonts: ['Lora', 'DM Sans'],
  },
  {
    id: 'harbourline',
    label: 'No-Fly Cruise',
    description: 'Deep and nautical, for a cruise specialist.',
    blurb: 'No-fly cruises from Southampton, planned by itinerary with a specialist on the phone. Start from this homepage and make it your own.',
    fonts: ['Source Serif 4', 'PT Sans'],
  },
  {
    id: 'fenwick-hale',
    label: 'The Grand Tour',
    description: 'Considered and scholarly, for cultural and escorted touring.',
    blurb: 'Small-group cultural tours led by scholars, planned in full before you book. Start from this homepage and make it your own.',
    fonts: ['Albert Sans', 'Literata'],
  },
  {
    id: 'peak-and-pass',
    label: 'Earn the View',
    description: 'Bold and outdoorsy, for adventure, trekking and small-group expeditions.',
    blurb: 'Small-group treks, climbs and expeditions with qualified leaders and honest grades. Start from this homepage and make it your own.',
    fonts: ['Oswald', 'Source Sans 3'],
  },
  {
    id: 'awaydays',
    label: 'Cheap and Cheerful',
    description: 'Loud and fast, for budget city breaks and party trips.',
    blurb: 'Cheap city breaks, beach trips and festivals, bookable with a small deposit. Start from this homepage and make it your own.',
    fonts: ['Bricolage Grotesque', 'Figtree'],
  },
  {
    id: 'harland-vane',
    label: 'The Travel Studio',
    description: 'A studio of designers, for bespoke private travel arranged one to one.',
    blurb: 'A studio of travel designers arranging bespoke private trips, one client at a time. Start from this homepage and make it your own.',
    fonts: ['Fraunces', 'Archivo'],
  },
  {
    id: 'aurelia',
    label: 'By Invitation',
    description: 'A small luxury studio, for a limited book of high-end escapes.',
    blurb: 'A small studio arranging a limited book of luxury escapes each year. Start from this homepage and make it your own.',
    fonts: ['Playfair Display', 'Manrope'],
  },
  {
    id: 'harlow-wren',
    label: 'Quiet Couture',
    description: 'Spare and editorial, for a private-travel house that takes a few clients a year.',
    blurb: 'Private travel composed by hand, one designer to one traveller. Start from this homepage and make it your own.',
    fonts: ['Bodoni Moda', 'Jost', 'Newsreader'],
  },
];

export function designedHomeMeta(id: string): DesignedHomeMeta | undefined {
  return DESIGNED_HOME_META.find((home) => home.id === id);
}
