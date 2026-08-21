/**
 * Stop right click on the published site.
 *
 * Andy's call, 21 Aug 2026, from Duda's Disable Right Click. It was argued
 * against and asked for again, so it is built. The argument is recorded in the
 * schema and the script rather than repeated at anyone.
 *
 * WHAT THESE TESTS ARE FOR. The blocking itself was checked in a browser by
 * firing real events. What a browser check cannot hold onto is the three
 * decisions inside it, each of which would look like a bug to somebody tidying
 * up later:
 *
 *   1. It is a SITE SETTING, not an element. Right click disabled on the home
 *      page and working on the gallery is not a policy, it is a gap.
 *   2. TEXT FIELDS KEEP THEIR MENU. Right-clicking to paste an email address is
 *      how a lot of people fill in a form, and the enquiry form is what the site
 *      is for. Blocking it there would cost bookings to guard a photograph.
 *   3. BODY TEXT STAYS SELECTABLE. `user-select: none` across a page is the
 *      version of this people hate: it stops somebody copying a reference number
 *      out of a page they are trying to act on.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, parseSettings } from '../lib/settings/schema';

const script = readFileSync(join(__dirname, '..', 'public', 'no-right-click.js'), 'utf8');

/*
 * THE CODE WITHOUT ITS COMMENTS. This repo has the rule written down already —
 * "a source-text assertion must strip comments first, or it reads the prose
 * explaining a bug as the bug" — and the CSP check below walked straight into
 * it anyway: the file's own header says "no eval, no innerHTML", so grepping
 * the raw text for `innerHTML` found the promise not to use it.
 */
const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const component = readFileSync(
  join(__dirname, '..', 'components', 'render', 'NoRightClickScript.tsx'),
  'utf8',
);
const route = readFileSync(
  join(__dirname, '..', 'app', 'site', '[host]', '[[...path]]', 'page.tsx'),
  'utf8',
);

describe('the setting', () => {
  it('is off unless somebody asks for it', () => {
    expect(DEFAULT_SETTINGS.noRightClick).toBe(false);
    expect(parseSettings({}).noRightClick).toBe(false);
  });

  it('only true means true', () => {
    // A stored 'yes' or 1 from a hand-edited row must not quietly turn it on for
    // a client who never chose it.
    expect(parseSettings({ noRightClick: true }).noRightClick).toBe(true);
    for (const value of ['true', 1, 'yes', {}, [], null]) {
      expect(parseSettings({ noRightClick: value }).noRightClick).toBe(false);
    }
  });
});

describe('the script is conditional', () => {
  it('a site that has not asked ships nothing', () => {
    // Clause 1 of the no-JavaScript rule. See lib/content/blocks.ts.
    expect(component).toContain('if (!settings.noRightClick) return null;');
  });

  it('reaches every published document, not just one of them', () => {
    /*
     * The route renders a page and a search results page from two different
     * branches. Wiring only one is the failure mode: right click would work on
     * /search and nowhere else, which nobody would notice until a client did.
     */
    expect(route.match(/<NoRightClickScript settings=/g)).toHaveLength(2);
  });

  it('is loaded from a fixed same-origin path', () => {
    expect(component).toContain('src="/no-right-click.js"');
  });

  it('never runs in the editor', () => {
    // Blocking the context menu on the canvas would stop whoever is building the
    // site from using their own browser. The editor does not render it, so the
    // component is only imported by the published route.
    expect(component).toContain('NEVER IN THE EDITOR');
  });
});

describe('what it deliberately does not block', () => {
  it('leaves the menu alone where somebody is typing', () => {
    expect(script).toContain('function isTyping(node)');
    expect(script).toContain("tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'");
    expect(script).toContain('node.isContentEditable === true');
    expect(script).toContain('if (isTyping(event.target)) return;');
  });

  it('does not make the whole page unselectable', () => {
    // Only pictures, and only so the drag has nothing to grab.
    expect(css).toContain('.tg-noright img,\n.tg-noright video {');
    expect(css).not.toContain('.tg-noright { user-select: none');
    expect(css).not.toContain('.tg-noright * { user-select: none');
  });
});

describe('how it blocks', () => {
  it('listens in the capture phase', () => {
    // A widget's own handler further down could otherwise let the menu through
    // first and make the setting look unreliable.
    expect(code.match(/true,\n  \);/g)?.length).toBeGreaterThanOrEqual(2);
    expect(code).toContain("'contextmenu'");
    expect(code).toContain("'dragstart'");
  });

  it('covers the long press and the drag, which the event handler cannot', () => {
    // -webkit-touch-callout is a touch gesture rather than a contextmenu event.
    expect(css).toContain('-webkit-touch-callout: none;');
    expect(css).toContain('-webkit-user-drag: none;');
  });

  it('is CSP-clean, like everything else served from here', () => {
    // Against `code`, not `script`. See the note where `code` is defined.
    expect(code).not.toContain('eval(');
    expect(code).not.toContain('innerHTML');
    expect(code).not.toContain('new Function');
    expect(code).not.toContain('document.write');
  });

  it('will not initialise twice', () => {
    expect(script).toContain('if (window.__TG_SITES_NORIGHT__) return;');
  });

  /*
   * THE HONESTY CHECK. A setting that implied the photographs were protected
   * would be worse than not having it, because somebody would rely on it. Both
   * the code and the screen have to keep saying so.
   */
  it('says plainly that it is not protection', () => {
    expect(script).toContain('It is not protection.');
    const editor = readFileSync(
      join(__dirname, '..', 'components', 'settings', 'SettingsEditor.tsx'),
      'utf8',
    );
    expect(editor).toContain('It is a deterrent, not protection');
  });
});
