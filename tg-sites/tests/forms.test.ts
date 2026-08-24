/**
 * The form element and its submit path.
 *
 * The pure half (finding the form on a published page, pairing the posted
 * controls with it, the bot traps) is tested directly. The rendered markup,
 * the stylesheet's :target state machine and the migration's privilege shape
 * are held by source assertions, the same arrangement the nav suite uses:
 * what must not drift is pinned where it lives.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cleanNotifyEmail, findFormBlock, parseSubmission, type FoundForm } from '../lib/forms/submit';
import { BLOCKS } from '../lib/content/blocks';
import type { Page } from '../lib/content/schema';

function source(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

// ---------------------------------------------------------------------------

const FORM: FoundForm = {
  name: 'Enquiry',
  notifyEmail: 'owner@example.com',
  fields: [
    { kind: 'text', label: 'Name', required: true },
    { kind: 'email', label: 'Email', required: true },
    { kind: 'textarea', label: 'Message', required: false },
  ],
};

/** A submission a person would plausibly send: traps clear, fields answered. */
function honest(overrides: Record<string, string> = {}): Array<[string, string]> {
  const base: Record<string, string> = {
    _block: 'b_x1',
    _form: 'Enquiry',
    _at: String(1_000_000),
    _website: '',
    q_0: 'Ann',
    q_1: 'ann@example.com',
    q_2: 'Hello',
    ...overrides,
  };
  return Object.entries(base);
}

const NOW = 1_000_000 + 60_000;

describe('parseSubmission', () => {
  it('stores answers under the published labels, not the posted names', () => {
    const result = parseSubmission(honest(), FORM, NOW);
    expect(result).toEqual({
      ok: true,
      data: { Name: 'Ann', Email: 'ann@example.com', Message: 'Hello' },
    });
  });

  it('refuses the filled honeypot silently, so a bot believes it worked', () => {
    const result = parseSubmission(honest({ _website: 'https://spam' }), FORM, NOW);
    expect(result).toEqual({ ok: false, refusal: 'silent' });
  });

  it('refuses a form sent faster than a person reads, silently', () => {
    const result = parseSubmission(honest(), FORM, 1_000_000 + 800);
    expect(result).toEqual({ ok: false, refusal: 'silent' });
  });

  it('refuses a missing or future render timestamp, silently', () => {
    expect(parseSubmission(honest({ _at: '' }), FORM, NOW)).toEqual({ ok: false, refusal: 'silent' });
    expect(parseSubmission(honest({ _at: String(NOW + 120_000) }), FORM, NOW)).toEqual({
      ok: false,
      refusal: 'silent',
    });
  });

  it('refuses a file part silently: no form here asked for one', () => {
    const entries: Array<[string, unknown]> = [...honest(), ['q_0', { name: 'x.bin' }]];
    expect(parseSubmission(entries, FORM, NOW)).toEqual({ ok: false, refusal: 'silent' });
  });

  it('refuses an empty required field as a visible error', () => {
    const result = parseSubmission(honest({ q_1: '  ' }), FORM, NOW);
    expect(result).toEqual({ ok: false, refusal: 'error' });
  });

  it('refuses a submission with nothing answered as a visible error', () => {
    const form: FoundForm = { ...FORM, fields: [{ kind: 'text', label: 'Name', required: false }] };
    const result = parseSubmission(honest({ q_0: '' }), form, NOW);
    expect(result).toEqual({ ok: false, refusal: 'error' });
  });

  it('caps a single answer at 4000 characters rather than refusing it', () => {
    const result = parseSubmission(honest({ q_2: 'x'.repeat(9000) }), FORM, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.Message).toHaveLength(4000);
  });

  it('keeps two identically labelled fields apart with a suffix', () => {
    const form: FoundForm = {
      name: '',
      notifyEmail: '',
      fields: [
        { kind: 'text', label: 'Name', required: false },
        { kind: 'text', label: 'Name', required: false },
      ],
    };
    const result = parseSubmission(honest({ q_0: 'One', q_1: 'Two' }), form, NOW);
    expect(result).toEqual({ ok: true, data: { Name: 'One', 'Name (2)': 'Two' } });
  });
});

// ---------------------------------------------------------------------------

function pageWith(blocks: unknown[], nested: unknown[] = []): Page {
  return {
    version: 1,
    id: 'p1',
    title: 'T',
    slug: 't',
    seo: {},
    sections: [
      {
        id: 's1',
        rows: [
          {
            id: 'r1',
            columns: [
              {
                id: 'c1',
                width: 100,
                blocks: [
                  ...blocks,
                  {
                    id: 'b_grid',
                    type: 'grid',
                    props: { columns: [{ id: 'gc1', width: 100, blocks: nested }] },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Page;
}

describe('findFormBlock', () => {
  const form = {
    id: 'b_f1',
    type: 'form',
    props: {
      name: 'Charter',
      notifyEmail: 'x@example.com',
      fields: [{ kind: 'text', label: 'Name', required: true }],
    },
  };

  it('finds the form and reads its declared fields from the published content', () => {
    const found = findFormBlock(pageWith([form]), 'b_f1');
    expect(found).toEqual({
      name: 'Charter',
      notifyEmail: 'x@example.com',
      fields: [{ kind: 'text', label: 'Name', required: true }],
    });
  });

  it('finds a form nested inside a grid cell', () => {
    const found = findFormBlock(pageWith([], [form]), 'b_f1');
    expect(found?.name).toBe('Charter');
  });

  it('refuses an id that is not a form on the page: the route stores nothing for it', () => {
    expect(findFormBlock(pageWith([form]), 'b_other')).toBeNull();
    const notForm = { ...form, type: 'text' };
    expect(findFormBlock(pageWith([notForm]), 'b_f1')).toBeNull();
  });
});

describe('cleanNotifyEmail', () => {
  it('keeps a plausible address and refuses junk', () => {
    expect(cleanNotifyEmail(' owner@example.com ')).toBe('owner@example.com');
    expect(cleanNotifyEmail('not-an-email')).toBe('');
    expect(cleanNotifyEmail('')).toBe('');
    expect(cleanNotifyEmail(`a@${'b'.repeat(300)}.com`)).toBe('');
  });
});

// ---------------------------------------------------------------------------

describe('the registry entry', () => {
  const def = BLOCKS.find((block) => block.type === 'form');

  it('exists, with the defaults the renderer and the route both lean on', () => {
    expect(def).toBeDefined();
    expect(def?.group).toBe('Actions and contact');
    const defaults = def?.defaults as Record<string, unknown>;
    expect(Array.isArray(defaults.fields)).toBe(true);
    expect(defaults.submitLabel).toBe('Send');
    expect(defaults.notifyEmail).toBe('');
  });

  it('declares the repeater sub-fields, or the sanitiser strips them on save', () => {
    const repeater = def?.fields.find((field) => field.key === 'fields');
    const keys = (repeater && 'fields' in repeater ? repeater.fields : []).map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['kind', 'label', 'required', 'placeholder', 'options']));
  });
});

describe('the rendered form', () => {
  const blocks = source('components', 'render', 'blocks.tsx');

  it('posts without JavaScript to the unmintable path, controls named by index', () => {
    expect(blocks).toContain("action: '/_form'");
    expect(blocks).toContain('method="post"');
    expect(blocks).toContain('`q_${index}`');
  });

  it('carries both bot traps and disables itself in the editor', () => {
    expect(blocks).toContain('name="_website"');
    expect(blocks).toContain('name="_at"');
    expect(blocks).toContain('disabled={editing}');
  });
});

describe('the stylesheet state machine', () => {
  const css = source('app', 'globals.css');

  it(':target shows the thank-you and hides the form, with no script', () => {
    expect(css).toContain('.tgs-form__done:target { display: block; }');
    expect(css).toContain('.tgs-form__done:target + .tgs-form__form { display: none; }');
    expect(css).toContain('.tgs-form__error:target { display: block; }');
  });

  it('the editor renders a picture of a form: controls take no pointer', () => {
    expect(css).toContain('.tgs-form[data-editing] input');
  });
});

describe('the migration keeps the public side write-only, and barely that', () => {
  const migration = source('db', 'migrations', '0025_form_submissions.sql');

  it('grants the renderer role nothing on the table itself', () => {
    // Any table grant naming the renderer would be the doctrine breaking.
    for (const line of migration.split('\n')) {
      if (/^\s*grant .*on public\.form_submissions/i.test(line)) {
        expect(line).not.toContain('tg_sites_renderer');
      }
    }
  });

  it('grants the renderer execute on the one definer function', () => {
    expect(migration).toMatch(/grant execute on function public\.submit_form[\s\S]*?tg_sites_renderer/);
    expect(migration).toContain('security definer');
    expect(migration).toContain('set search_path = public, pg_temp');
  });

  it('gives the app role no delete: an enquiry does not quietly vanish', () => {
    expect(migration).toContain('grant select, insert, update on public.form_submissions to tg_sites_app;');
    expect(migration).not.toMatch(/grant[^;]*delete[^;]*form_submissions/i);
  });
});
