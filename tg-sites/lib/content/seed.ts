/**
 * A demo page, so the editor and the server renderer both have something
 * real to show on first load. Deleted once pages come out of Postgres.
 *
 * Written as a plain object rather than through the factories so it is
 * readable as an example of the content model, which is half its job.
 */

import type { Page } from './schema';

export const SEED_PAGE: Page = {
  version: 1,
  id: 'pg_demo',
  title: 'Greece, planned properly',
  slug: '',
  seo: {
    title: 'Tailor-made Greece holidays',
    description: 'Talk to someone who has actually been. Tailor-made trips to Greece.',
    noindex: false,
  },
  sections: [
    {
      id: 'sec_hero',
      name: 'Hero',
      tone: 'dark',
      width: 'contained',
      paddingY: 'xl',
      rows: [
        {
          id: 'row_hero',
          gap: 'xl',
          stackBelow: 'mobile',
          reverseOnStack: true,
          columns: [
            {
              id: 'col_hero_text',
              width: 55,
              align: 'centre',
              blocks: [
                {
                  id: 'blk_hero_eyebrow',
                  type: 'heading',
                  props: { text: 'Tailor-made travel', level: 'h3', size: 's', align: 'left' },
                },
                {
                  id: 'blk_hero_title',
                  type: 'heading',
                  props: { text: 'Greece, planned properly', level: 'h2', size: 'xl', align: 'left' },
                },
                {
                  id: 'blk_hero_body',
                  type: 'text',
                  props: {
                    html: '<p>Talk to someone who has actually been. We build the trip around how you like to travel, then we are on the end of the phone while you are away.</p>',
                    size: 'l',
                    align: 'left',
                  },
                },
                {
                  id: 'blk_hero_actions',
                  type: 'button-group',
                  props: {
                    align: 'left',
                    buttons: [
                      { label: 'Start an enquiry', href: '/contact', variant: 'primary', newTab: false },
                      { label: 'See the islands', href: '/greece', variant: 'ghost', newTab: false },
                    ],
                  },
                },
              ],
            },
            {
              id: 'col_hero_media',
              width: 45,
              align: 'top',
              blocks: [
                {
                  id: 'blk_hero_image',
                  type: 'image',
                  props: {
                    src: '',
                    alt: 'A whitewashed village above the sea',
                    ratio: '4/3',
                    fit: 'cover',
                    radius: 'lg',
                    caption: '',
                    href: '',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'sec_why',
      name: 'Why us',
      tone: 'light',
      width: 'contained',
      paddingY: 'xl',
      rows: [
        {
          id: 'row_why_head',
          gap: 'm',
          stackBelow: 'mobile',
          reverseOnStack: false,
          columns: [
            {
              id: 'col_why_head',
              width: 100,
              align: 'top',
              blocks: [
                {
                  id: 'blk_why_title',
                  type: 'heading',
                  props: { text: 'What you get', level: 'h2', size: 'l', align: 'left' },
                },
              ],
            },
          ],
        },
        {
          id: 'row_why_items',
          gap: 'l',
          stackBelow: 'tablet',
          reverseOnStack: false,
          columns: [
            {
              id: 'col_why_1',
              width: 33.33,
              align: 'top',
              blocks: [
                {
                  id: 'blk_why_1',
                  type: 'icon-item',
                  props: {
                    icon: '✈',
                    title: 'Everything in one booking',
                    body: 'Flights, transfers and the hotel, protected together.',
                  },
                },
              ],
            },
            {
              id: 'col_why_2',
              width: 33.33,
              align: 'top',
              blocks: [
                {
                  id: 'blk_why_2',
                  type: 'icon-item',
                  props: {
                    icon: '☎',
                    title: 'A person, not a portal',
                    body: 'The same consultant from first call to coming home.',
                  },
                },
              ],
            },
            {
              id: 'col_why_3',
              width: 33.34,
              align: 'top',
              blocks: [
                {
                  id: 'blk_why_3',
                  type: 'icon-item',
                  props: {
                    icon: '★',
                    title: 'Been there ourselves',
                    body: 'We only sell places someone in the office has stayed.',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'sec_cta',
      name: 'Closing call to action',
      tone: 'accent',
      width: 'narrow',
      paddingY: 'xl',
      rows: [
        {
          id: 'row_cta',
          gap: 'm',
          stackBelow: 'mobile',
          reverseOnStack: false,
          columns: [
            {
              id: 'col_cta',
              width: 100,
              align: 'top',
              blocks: [
                {
                  id: 'blk_cta_title',
                  type: 'heading',
                  props: { text: 'Tell us where you fancy', level: 'h2', size: 'l', align: 'centre' },
                },
                {
                  id: 'blk_cta_body',
                  type: 'text',
                  props: {
                    html: '<p>No obligation and no hard sell. We will come back with a couple of honest options.</p>',
                    size: 'm',
                    align: 'centre',
                  },
                },
                {
                  id: 'blk_cta_button',
                  type: 'button',
                  props: {
                    label: 'Start an enquiry',
                    href: '/contact',
                    variant: 'primary',
                    size: 'l',
                    align: 'centre',
                    newTab: false,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
