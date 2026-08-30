/**
 * The site-wide floating widgets: the config a client sets, made safe, and the
 * inline config the shell emits.
 *
 * THE ONE THAT MATTERS: the config becomes an inline data-tg-config attribute on
 * a published page, so a bad value in the database must never reach it. The
 * parser is total and defensive; these tests hold that a colour that is not a
 * colour, a url that is a javascript: url, an out-of-range number and an unknown
 * enum all come back as the safe default rather than on the page.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FLOATING_WIDGETS,
  enabledFloatingWidgets,
  parseFloatingWidgets,
} from '../lib/settings/floating-widgets';
import {
  FLOATING_WIDGET_TAGS,
  floatingWidgetScriptUrl,
  WIDGET_KINDS,
  WIDGET_ORIGIN,
} from '../lib/content/widgets';
import { DEFAULT_SETTINGS, parseSettings } from '../lib/settings/schema';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('floating widgets defaults', () => {
  it('are all off by default, so a site that asks for nothing ships nothing', () => {
    const fw = parseFloatingWidgets({});
    expect(fw.backToTop.enabled).toBe(false);
    expect(fw.whatsapp.enabled).toBe(false);
    expect(fw.dealBar.enabled).toBe(false);
    expect(fw.loader.enabled).toBe(false);
    expect(enabledFloatingWidgets(fw)).toEqual([]);
  });

  it('round-trip through the whole settings parser under their own key', () => {
    const parsed = parseSettings({ ...DEFAULT_SETTINGS });
    expect(parsed.floatingWidgets).toEqual(DEFAULT_FLOATING_WIDGETS);
  });

  it('never throw on nonsense', () => {
    expect(parseFloatingWidgets('not an object').backToTop.enabled).toBe(false);
    expect(parseFloatingWidgets(null)).toEqual(DEFAULT_FLOATING_WIDGETS);
    expect(parseFloatingWidgets({ backToTop: 'x', whatsapp: 5, dealBar: [], loader: true })).toEqual(
      DEFAULT_FLOATING_WIDGETS,
    );
  });
});

describe('a bad value never reaches the page', () => {
  it('keeps a colour to hex or the default', () => {
    const bad = parseFloatingWidgets({ backToTop: { enabled: true, accent: 'red; }</style>' } });
    expect(bad.backToTop.accent).toBe('#0891B2');
    const good = parseFloatingWidgets({ backToTop: { enabled: true, accent: '#abc' } });
    expect(good.backToTop.accent).toBe('#abc');
  });

  it('refuses a javascript: url on the deal bar button', () => {
    // eslint-disable-next-line no-script-url
    const bad = parseFloatingWidgets({ dealBar: { enabled: true, ctaUrl: 'javascript:alert(1)' } });
    expect(bad.dealBar.ctaUrl).toBe('');
    const ok = parseFloatingWidgets({ dealBar: { enabled: true, ctaUrl: 'https://x.example/deals' } });
    expect(ok.dealBar.ctaUrl).toBe('https://x.example/deals');
    const anchor = parseFloatingWidgets({ dealBar: { enabled: true, ctaUrl: '/offers' } });
    expect(anchor.dealBar.ctaUrl).toBe('/offers');
  });

  it('clamps a number to the widget bounds', () => {
    const fw = parseFloatingWidgets({ backToTop: { enabled: true, size: 9999, showAfter: -5 } });
    expect(fw.backToTop.size).toBe(80);
    expect(fw.backToTop.showAfter).toBe(1);
  });

  it('falls back an unknown enum to the default', () => {
    const fw = parseFloatingWidgets({
      backToTop: { enabled: true, position: 'floating', shape: 'star' },
      loader: { enabled: true, template: 'nonsense' },
    });
    expect(fw.backToTop.position).toBe('bottom-right');
    expect(fw.backToTop.shape).toBe('circle');
    expect(fw.loader.template).toBe('plane-path');
  });

  it('strips control characters and caps the message length', () => {
    const long = 'x'.repeat(1000);
    const fw = parseFloatingWidgets({ dealBar: { enabled: true, message: long } });
    expect(fw.dealBar.message.length).toBeLessThanOrEqual(300);
  });

  it('allows only transparent or a hex for the loader background', () => {
    expect(parseFloatingWidgets({ loader: { background: 'TRANSPARENT' } }).loader.background).toBe('transparent');
    expect(parseFloatingWidgets({ loader: { background: '#fff' } }).loader.background).toBe('#fff');
    expect(parseFloatingWidgets({ loader: { background: 'url(x)' } }).loader.background).toBe('transparent');
  });
});

describe('what the shell emits', () => {
  it('emits only enabled widgets, shaped into each widget config', () => {
    const fw = parseFloatingWidgets({
      backToTop: { enabled: true, accent: '#123456' },
      dealBar: { enabled: true, message: 'Deals' },
    });
    const out = enabledFloatingWidgets(fw);
    expect(out.map((w) => w.tag)).toEqual(['backtotop', 'dealbar']);
    expect(out[0].config.accent).toBe('#123456');
  });

  it('leaves a WhatsApp button off until it has a number', () => {
    const noNumber = enabledFloatingWidgets(parseFloatingWidgets({ whatsapp: { enabled: true, phone: '' } }));
    expect(noNumber).toEqual([]);
    const withNumber = enabledFloatingWidgets(
      parseFloatingWidgets({ whatsapp: { enabled: true, phone: '+44 7900 900900' } }),
    );
    expect(withNumber).toHaveLength(1);
    // Forced to the floating single-agent layout and the brand nested where the widget wants it.
    expect(withNumber[0].config.layout).toBe('floating');
    expect(withNumber[0].config.mode).toBe('single');
    expect(withNumber[0].config.theme).toEqual({ brand: '#25D366' });
  });

  it('nests the loader colours the way its widget reads them', () => {
    const out = enabledFloatingWidgets(parseFloatingWidgets({ loader: { enabled: true, primary: '#00b4d8' } }));
    expect(out[0].config.colors).toEqual({ primary: '#00b4d8', secondary: '#1B2B5B', track: '#E2E8F0' });
  });
});

describe('the registry that turns a tag into a url', () => {
  it('builds a script url on the widget origin for every floating tag', () => {
    for (const tag of FLOATING_WIDGET_TAGS) {
      expect(floatingWidgetScriptUrl(tag)).toBe(`${WIDGET_ORIGIN}/widget-${tag}.js`);
    }
  });

  /*
   * DERIVED FROM THE SOURCE LIST, not a hardcoded copy. A floating widget is
   * emitted once per page from settings; if the same tag were also a placeable
   * column block (in WIDGET_KINDS) a page could carry two containers and two
   * inits of it. The comment on FLOATING_WIDGET_TAGS says the two lists must stay
   * disjoint; this proves it for whatever the list holds, so a fifth floating tag
   * added to both places fails here rather than shipping the double-init.
   */
  it('keeps every floating tag out of the placeable widget registry', () => {
    const placeable = new Set(WIDGET_KINDS.map((kind) => kind.tag));
    for (const tag of FLOATING_WIDGET_TAGS) {
      expect(placeable.has(tag), `${tag} is both floating and placeable — it would init twice`).toBe(false);
    }
  });

  it('has a tag for every widget the settings can enable', () => {
    const emitted = new Set(
      enabledFloatingWidgets(
        parseFloatingWidgets({
          backToTop: { enabled: true },
          whatsapp: { enabled: true, phone: '+1' },
          dealBar: { enabled: true },
          loader: { enabled: true },
        }),
      ).map((w) => w.tag),
    );
    for (const tag of emitted) {
      expect((FLOATING_WIDGET_TAGS as readonly string[]).includes(tag)).toBe(true);
    }
    expect(emitted.size).toBe(4);
  });
});

describe('the published shell wires it up on both paths', () => {
  const page = read('app', 'site', '[host]', '[[...path]]', 'page.tsx');

  it('mounts FloatingWidgets in the main render AND the search render', () => {
    const mounts = page.match(/<FloatingWidgets settings=\{/g) ?? [];
    expect(mounts.length).toBe(2);
  });

  it('never adds the external widget scripts to the same-origin asset allowlist', () => {
    const middleware = read('middleware.ts');
    for (const tag of FLOATING_WIDGET_TAGS) {
      expect(middleware).not.toContain(`widget-${tag}.js`);
    }
  });
});
