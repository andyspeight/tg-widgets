'use client';

/**
 * Site settings.
 *
 * Built on the theme screen's own classes (tv-wrap, tv-head, tv-tabs, tv-group,
 * tv-field, tv-bar) rather than a new set. These are siblings: a client goes from
 * one to the other in the same session, and a settings screen that looked like a
 * different product would be the third design in a two-screen tool.
 *
 * THE STAFF TAB IS DRAWN ONLY FOR STAFF AND THAT IS NOT THE PROTECTION. The gate is
 * a refusal in app/actions/settings.ts. Every server action is a public endpoint
 * whose URL is in the page's own JavaScript, so a hidden panel stops nobody. It is
 * here so a client is not shown a field they cannot use, which is a courtesy, not a
 * control.
 */

import { useEffect, useMemo, useState, useTransition } from 'react';

import {
  loadStaffSettingsAction,
  saveSettingsAction,
  saveStaffSettingsAction,
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

type Tab = 'analytics' | 'branding' | 'language' | 'staff';

interface Props {
  siteName: string;
  initial: SiteSettings;
  /** Decided by the server. The screen never works this out for itself. */
  isStaff: boolean;
}

export function SettingsEditor({ siteName, initial, isStaff }: Props) {
  const [settings, setSettings] = useState<SiteSettings>(initial);
  const [saved, setSaved] = useState<SiteSettings>(initial);
  const [tab, setTab] = useState<Tab>('analytics');
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
    { id: 'analytics', label: 'Analytics' },
    { id: 'branding', label: 'Icons and sharing' },
    { id: 'language', label: 'Language' },
    ...(isStaff ? [{ id: 'staff' as Tab, label: 'Travelgenix' }] : []),
  ];

  return (
    <div className="sv-root tv-root" data-theme="light">
      <div className="tv-wrap">
        <header className="tv-head">
          <div>
            <p className="sv-eyebrow">Settings</p>
            <h1 className="sv-title">{siteName}</h1>
            <p className="sv-url">
              Tracking, the icons in a browser tab and on a phone, and the picture
              that shows when somebody shares a page.
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
              {id === 'staff' && <span className="st-staff-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>

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

        {tab === 'staff' && isStaff && <StaffPanel onError={setMessage} />}
      </div>

      {/*
        The global save bar is hidden on the Travelgenix tab, and that is a fix
        rather than a preference.

        That panel loads and saves its own values through its own gated actions, so
        it has its own button. With both on screen, somebody editing Head HTML and
        pressing "Save settings" at the bottom would get a success state and no
        change: the bottom bar saves the client settings and has never heard of the
        staff ones. Two save buttons where one silently ignores what you just typed
        is worse than one button in the right place.
      */}
      {tab !== 'staff' && (
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
 * Loaded on demand rather than passed in with the rest, so the page a client gets
 * never contains these values at all. If it were a prop, the head HTML of every
 * site would be in the server-rendered payload of the settings screen, staff tab
 * drawn or not, and a client could read it in view-source.
 */
function StaffPanel({ onError }: { onError: (message: string) => void }) {
  const [staff, setStaff] = useState<StaffSettings | null>(null);
  const [saved, setSaved] = useState<StaffSettings | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await loadStaffSettingsAction();
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setStaff(result.data);
      setSaved(result.data);
    });
    // Once, on mount. onError is a setState function and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!staff || !saved) return <p className="tv-note">Reading the current values…</p>;

  const dirty = staff.headHtml !== saved.headHtml || staff.bodyHtml !== saved.bodyHtml;

  function save() {
    startTransition(async () => {
      const result = await saveStaffSettingsAction(staff);
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setStaff(result.data);
      setSaved(result.data);
    });
  }

  return (
    <section className="tv-group st-staff">
      <h2 className="tv-group__title">Travelgenix only</h2>

      <p className="st-warn">
        <Icon name="warning" size={16} />
        Anything here runs on every page of this client&rsquo;s live site, exactly as
        written. It is not checked or cleaned. A mistake here can break the site or
        leak whatever the script has access to, so read it twice before saving.
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
          value={staff.headHtml}
          onChange={(event) => setStaff({ ...staff, headHtml: event.target.value })}
        />
        <p className="tv-field__help">
          Goes in the head. Meta tags for verifying a domain, a tag manager the
          client cannot express as an ID, that sort of thing.{' '}
          {staff.headHtml.length} of {MAX_RAW_HTML} characters.
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
          value={staff.bodyHtml}
          onChange={(event) => setStaff({ ...staff, bodyHtml: event.target.value })}
        />
        <p className="tv-field__help">
          Goes at the end of the body, which is where a chat widget belongs so it
          does not hold up the page. {staff.bodyHtml.length} of {MAX_RAW_HTML}{' '}
          characters.
        </p>
      </div>

      {/*
        Said here rather than left to be discovered. The preview shares an origin
        with the editor, so this HTML is deliberately not run there, and somebody
        checking their work in the preview would otherwise conclude it had not saved.
      */}
      <p className="tv-note">
        This does not appear in the editor preview, on purpose: the preview shares an
        address with the editor, and running a client&rsquo;s script there would give
        it access to your session. Check it on the site&rsquo;s own domain.
      </p>

      <div className="tv-field">
        <button
          type="button"
          className="tg-btn"
          data-variant={dirty ? 'danger' : undefined}
          disabled={!dirty || busy}
          onClick={save}
        >
          {busy ? 'Saving' : 'Save Travelgenix settings'}
        </button>
      </div>
    </section>
  );
}
