'use client';

/**
 * Site settings.
 *
 * Built on the theme screen's own classes (tv-wrap, tv-head, tv-tabs, tv-group,
 * tv-field, tv-bar) rather than a new set. These are siblings: a client goes from
 * one to the other in the same session, and a settings screen that looked like a
 * different product would be the third design in a two-screen tool.
 *
 * THE CUSTOM CODE TAB IS DRAWN ONLY WHEN IT CAN BE USED AND THAT IS NOT THE
 * PROTECTION. The gate is a refusal in app/actions/settings.ts. Every server action
 * is a public endpoint whose URL is in the page's own JavaScript, so a hidden panel
 * stops nobody. It is here so an editor or a viewer is not shown a field they cannot
 * use, which is a courtesy, not a control.
 */

import { useEffect, useMemo, useState, useTransition } from 'react';

import {
  loadCustomCodeAction,
  saveCustomCodeAction,
  saveSettingsAction,
} from '../../app/actions/settings';
import { analytics } from '../../lib/settings/head';
import {
  LOCALES,
  LOCALE_IDS,
  MAX_RAW_HTML,
  type SiteSettings,
  type StaffSettings,
} from '../../lib/settings/schema';
import { Icon } from '../editor/Icon';
import { ImageField } from '../media/ImageField';
import './settings.css';

type Tab = 'company' | 'analytics' | 'branding' | 'language' | 'code';

interface Props {
  siteName: string;
  initial: SiteSettings;
  /**
   * Whether this person may edit head and body HTML: the site's owner, or us.
   * Decided by the server. The screen never works this out for itself.
   */
  canEditCode: boolean;
}

export function SettingsEditor({ siteName, initial, canEditCode }: Props) {
  const [settings, setSettings] = useState<SiteSettings>(initial);
  const [saved, setSaved] = useState<SiteSettings>(initial);
  /*
   * Opens on Your company, which is also the first tab.
   *
   * It used to open on Analytics because Analytics was the only thing here. Now
   * that the profile decides what the writing assistant says on every page, it
   * is both the most useful panel and the one a new site has not filled in, and
   * a tablist whose first tab is not the selected one on load reads as a bug.
   */
  const [tab, setTab] = useState<Tab>('company');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  /*
   * Compared as JSON rather than field by field, same as the theme screen. Six flat
   * fields would survive a per-key comparison today and not after the seventh is
   * added, and the failure mode is a change that says it saved and did not.
   */
  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(saved),
    [settings, saved],
  );

  const tags = useMemo(() => analytics(settings), [settings]);

  function set<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setMessage(null);
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveSettingsAction(settings);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      /*
       * The SERVER's version becomes the new state, not the one that was sent.
       *
       * The parser tidies as it goes: a lower-case id comes back upper-cased, a URL
       * it refuses comes back null. Keeping the local copy would leave the screen
       * showing "gtm-abc1234" while the database holds "GTM-ABC1234", and the field
       * would look dirty again the moment anything else changed.
       */
      setSettings(result.data);
      setSaved(result.data);
    });
  }

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'company', label: 'Your company' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'branding', label: 'Icons and sharing' },
    { id: 'language', label: 'Language' },
    ...(canEditCode ? [{ id: 'code' as Tab, label: 'Custom code' }] : []),
  ];

  return (
    <div className="sv-root tv-root" data-theme="light">
      <div className="tv-wrap">
        <header className="tv-head">
          <div>
            <p className="sv-eyebrow">Settings</p>
            <h1 className="sv-title">{siteName}</h1>
            <p className="sv-url">
              What the writing assistant knows about you, tracking, the icons in a
              browser tab and on a phone, and the picture that shows when somebody
              shares a page.
            </p>
          </div>
          <a className="sv-btn" href="/sites">
            Back to pages
          </a>
        </header>

        {message && (
          <p className="sv-msg" role="alert">
            <Icon name="warning" size={16} />
            {message}
          </p>
        )}

        <div className="tv-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="tv-tab"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/*
          WHO THIS COMPANY IS, for the writing assistant to read.

          Andy, 31 Jul 2026: "an area in settings where users can add a company
          profile, so it tells the AI about the company, the writing style and
          the tone of voice".

          Four boxes rather than one, because "tell us about your company" gets a
          postal address and "how should this sound" gets something usable. It
          also means the AI can be given the tone WITHOUT the history, which is
          usually the right prompt for a heading.

          First tab, because it is the one that changes what the product does for
          you rather than what a page reports to Google.
        */}
        {tab === 'company' && (
          <section className="tv-group">
            <h2 className="tv-group__title">Your company</h2>
            <p className="tv-note">
              This is what the writing assistant knows about you. The more you put
              here, the more the copy it suggests will sound like you rather than
              like anybody.
            </p>

            <div className="tv-field">
              <label className="tv-field__label" htmlFor="company-name">
                Company name
              </label>
              <input
                id="company-name"
                className="tv-input"
                type="text"
                maxLength={120}
                value={settings.companyName}
                placeholder="Sunvil Travel"
                onChange={(event) => set('companyName', event.target.value)}
              />
            </div>

            <div className="tv-field">
              <label className="tv-field__label" htmlFor="company-about">
                What you do, and who for
              </label>
              <textarea
                id="company-about"
                className="tv-textarea"
                rows={5}
                maxLength={1200}
                value={settings.companyAbout}
                placeholder={
                  'Tailor-made holidays to Greece and Cyprus, mostly for couples '
                  + 'and families in their forties and up. Every trip is put together '
                  + 'by somebody who has been there. We do not sell package deals.'
                }
                onChange={(event) => set('companyAbout', event.target.value)}
              />
              <p className="tv-field__help">
                The facts the writing has to stay inside. The assistant will not
                invent a speciality, an award or a place you have not mentioned.
              </p>
            </div>

            <div className="tv-field">
              <label className="tv-field__label" htmlFor="tone-of-voice">
                How it should sound
              </label>
              <textarea
                id="tone-of-voice"
                className="tv-textarea"
                rows={3}
                maxLength={600}
                value={settings.toneOfVoice}
                placeholder={
                  'Warm and unhurried, like a person who has been there talking to '
                  + 'a friend. Confident without pushing. Never salesy.'
                }
                onChange={(event) => set('toneOfVoice', event.target.value)}
              />
            </div>

            <div className="tv-field">
              <label className="tv-field__label" htmlFor="avoid">
                Words and claims to keep out
              </label>
              <textarea
                id="avoid"
                className="tv-textarea"
                rows={3}
                maxLength={600}
                value={settings.avoid}
                placeholder={'bucket list, hidden gem, once in a lifetime, cheapest, guaranteed'}
                onChange={(event) => set('avoid', event.target.value)}
              />
              <p className="tv-field__help">
                Often the most useful box of the four. UK English, no em dashes and
                no marketing cliche are already on by default, for every site.
              </p>
            </div>
          </section>
        )}

        {tab === 'analytics' && (
          <section className="tv-group">
            <h2 className="tv-group__title">Google Tag Manager</h2>
            <div className="tv-field">
              <label className="tv-field__label" htmlFor="gtm">
                Container ID
              </label>
              <input
                className="tv-colour__hex"
                id="gtm"
                type="text"
                value={settings.gtmId ?? ''}
                placeholder="GTM-ABC1234"
                spellCheck={false}
                onChange={(event) => set('gtmId', event.target.value as SiteSettings['gtmId'])}
              />
              <p className="tv-field__help">
                Just the ID, not the code. We write the tracking code ourselves from
                it, which is why nobody can accidentally paste something that breaks
                the site. Find it at the top of your Tag Manager workspace.
              </p>
            </div>

            <h2 className="tv-group__title">Google Analytics</h2>
            <div className="tv-field">
              <label className="tv-field__label" htmlFor="ga4">
                Measurement ID
              </label>
              <input
                className="tv-colour__hex"
                id="ga4"
                type="text"
                value={settings.ga4Id ?? ''}
                placeholder="G-ABC1234567"
                spellCheck={false}
                onChange={(event) => set('ga4Id', event.target.value as SiteSettings['ga4Id'])}
              />
              <p className="tv-field__help">
                Starts with G-. An older ID starting UA- will not work: those
                properties stopped collecting data in 2023.
              </p>
            </div>

            {/*
              Worth saying out loud. It is not an error and it does double-count, and
              nobody would connect the two on their own.
            */}
            {tags.bothConfigured && (
              <p className="st-warn">
                <Icon name="warning" size={16} />
                You have both set. If Analytics is already configured inside Tag
                Manager, every page view will be counted twice. Usually you want one
                or the other here.
              </p>
            )}
          </section>
        )}

        {tab === 'branding' && (
          <section className="tv-group">
            <h2 className="tv-group__title">Browser tab icon</h2>
            <div className="tv-field">
              {/*
                The same control as every other image in the product, so this comes
                off the image bank rather than being a fourth upload path.
              */}
              <ImageField
                value={settings.faviconUrl ?? ''}
                onChange={(url) => set('faviconUrl', (url || null) as SiteSettings['faviconUrl'])}
              />
              <p className="tv-field__help">
                A square image works best, because every browser crops it to a square
                anyway. It is shown at about the size of this text, so a full logo
                with words in it will not be readable: the mark on its own is better.
              </p>
            </div>

            <h2 className="tv-group__title">Sharing picture</h2>
            <div className="tv-field">
              <ImageField
                value={settings.socialImageUrl ?? ''}
                onChange={(url) =>
                  set('socialImageUrl', (url || null) as SiteSettings['socialImageUrl'])
                }
              />
              <p className="tv-field__help">
                What appears when somebody pastes a link to your site into WhatsApp,
                Facebook or a message. Landscape, and about twice as wide as it is
                tall. A page with its own picture chosen uses that one instead.
              </p>
            </div>

            <h2 className="tv-group__title">Home screen icon</h2>
            <div className="tv-field">
              <ImageField
                value={settings.touchIconUrl ?? ''}
                onChange={(url) =>
                  set('touchIconUrl', (url || null) as SiteSettings['touchIconUrl'])
                }
              />
              <p className="tv-field__help">
                For somebody who saves your site to their phone. Square again, and
                leave a little space around the mark: phones crop icons to whatever
                shape their launcher uses, so anything tight to the edge loses its
                corners.
              </p>
            </div>
          </section>
        )}

        {tab === 'language' && (
          <section className="tv-group">
            <h2 className="tv-group__title">Site language</h2>
            <div className="tv-field">
              <label className="tv-field__label" htmlFor="locale">
                Language
              </label>
              <select
                className="tv-select"
                id="locale"
                value={settings.locale}
                onChange={(event) => set('locale', event.target.value as SiteSettings['locale'])}
              >
                {LOCALE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {LOCALES[id]}
                  </option>
                ))}
              </select>
              <p className="tv-field__help">
                Tells a browser and a screen reader what language the site is in. It
                does not translate anything.
              </p>
            </div>

            {/*
              An honest stub. It says what it does today and what it does not, rather
              than implying a translation feature that is not there.
            */}
            <p className="tv-note">
              Running the same site in more than one language is coming, and it is a
              bigger job than a setting: every page needs a version per language and
              a way for a visitor to switch. This is the groundwork.
            </p>
          </section>
        )}

        {tab === 'code' && canEditCode && <CustomCodePanel onError={setMessage} />}
      </div>

      {/*
        The global save bar is hidden on the custom code tab, and that is a fix
        rather than a preference.

        That panel loads and saves its own values through its own gated actions, so
        it has its own button. With both on screen, somebody editing Head HTML and
        pressing "Save settings" at the bottom would get a success state and no
        change: the bottom bar saves the other settings and has never heard of the
        code ones. Two save buttons where one silently ignores what you just typed
        is worse than one button in the right place.
      */}
      {tab !== 'code' && (
      <div className="tv-bar" data-dirty={dirty ? 'true' : undefined}>
        <span className="tv-bar__state">{dirty ? 'Not saved yet' : 'Saved'}</span>
        <button
          type="button"
          className="tg-btn"
          disabled={!dirty || busy}
          onClick={() => {
            setMessage(null);
            setSettings(saved);
          }}
        >
          Discard changes
        </button>
        <button
          type="button"
          className="tg-btn"
          data-variant="primary"
          disabled={!dirty || busy}
          onClick={save}
        >
          {busy ? 'Saving' : 'Save settings'}
        </button>
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Head and body HTML.
 *
 * Loaded on demand rather than passed in with the rest, so the page an editor or a
 * viewer gets never contains these values at all. If it were a prop, the head HTML
 * of the site would be in the server-rendered payload of the settings screen for
 * everybody who opened it, tab drawn or not, and it can hold an API key for
 * whatever it was pasted to load.
 *
 * The copy addresses the site's owner, because since 30 Jul 2026 that is who is
 * usually reading it. It stays blunt about the risk: this is the one field in the
 * product that puts unchecked script on a live site, and softening that to sound
 * friendlier would be doing somebody a disservice.
 */
function CustomCodePanel({ onError }: { onError: (message: string) => void }) {
  const [code, setCode] = useState<StaffSettings | null>(null);
  const [saved, setSaved] = useState<StaffSettings | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await loadCustomCodeAction();
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setCode(result.data);
      setSaved(result.data);
    });
    // Once, on mount. onError is a setState function and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!code || !saved) return <p className="tv-note">Reading the current values…</p>;

  const dirty = code.headHtml !== saved.headHtml || code.bodyHtml !== saved.bodyHtml;

  function save() {
    startTransition(async () => {
      const result = await saveCustomCodeAction(code);
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setCode(result.data);
      setSaved(result.data);
    });
  }

  /*
   * No group title, unlike every other panel on this screen. On the others it earns
   * its place, because "Google Tag Manager" says something the tab label "Analytics"
   * does not. Here it would read "CUSTOM CODE" directly under a tab called Custom
   * code, which is a heading that tells you nothing twice. The warning takes the top
   * of the panel instead, which is where it wants to be, and the section keeps an
   * aria-label so it is still a named landmark without a visible duplicate.
   */
  return (
    <section className="tv-group st-code-panel" aria-label="Custom code">
      <p className="st-warn">
        <Icon name="warning" size={16} />
        Anything you put here runs on every page of your live site, exactly as
        written. We do not check it or clean it, because the whole point is that it
        goes through untouched. A mistake here can break the site, so read it twice
        before you save, and paste code only from somewhere you trust.
      </p>

      <div className="tv-field">
        <label className="tv-field__label" htmlFor="head-html">
          Head HTML
        </label>
        <textarea
          className="st-code"
          id="head-html"
          rows={8}
          maxLength={MAX_RAW_HTML}
          spellCheck={false}
          value={code.headHtml}
          onChange={(event) => setCode({ ...code, headHtml: event.target.value })}
        />
        <p className="tv-field__help">
          Goes in the head. Meta tags for verifying your domain with Google or
          Facebook, a tracking script that is not Tag Manager or Analytics, a font or
          stylesheet from somewhere else. {code.headHtml.length} of {MAX_RAW_HTML}{' '}
          characters.
        </p>
      </div>

      <div className="tv-field">
        <label className="tv-field__label" htmlFor="body-html">
          Body HTML
        </label>
        <textarea
          className="st-code"
          id="body-html"
          rows={8}
          maxLength={MAX_RAW_HTML}
          spellCheck={false}
          value={code.bodyHtml}
          onChange={(event) => setCode({ ...code, bodyHtml: event.target.value })}
        />
        <p className="tv-field__help">
          Goes at the end of the body, which is where a live chat widget belongs so it
          does not hold up the rest of the page. {code.bodyHtml.length} of{' '}
          {MAX_RAW_HTML} characters.
        </p>
      </div>

      {/*
        Said here rather than left to be discovered. The preview shares an origin
        with the editor, so this HTML is deliberately not run there, and somebody
        checking their work in the preview would otherwise conclude it had not saved.
      */}
      <p className="tv-note">
        This does not appear in the editor preview, on purpose: the preview sits at
        the same address as the editor, and running your code there would give it
        access to your sign-in. Check it on your own domain.
      </p>

      <div className="st-code-save">
        <button
          type="button"
          className="tg-btn"
          data-variant={dirty ? 'danger' : undefined}
          disabled={!dirty || busy}
          onClick={save}
        >
          {busy ? 'Saving' : 'Save custom code'}
        </button>
        <span className="st-code-save__state">{dirty ? 'Not saved yet' : 'Saved'}</span>
      </div>
    </section>
  );
}
