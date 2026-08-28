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
  type OpeningHours,
  type SiteSettings,
  type StaffSettings,
  WEEKDAYS,
  type Weekday,
} from '../../lib/settings/schema';
import { Icon } from '../editor/Icon';
import { ImageField } from '../media/ImageField';
import { ActivityPanel } from './ActivityPanel';
import { DomainsPanel } from './DomainsPanel';
import './settings.css';

type Tab =
  | 'company'
  | 'contact'
  | 'analytics'
  | 'branding'
  | 'language'
  | 'activity'
  | 'domains'
  | 'code';

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
  /*
   * Open on a specific tab when linked with ?tab=, so the visibility screen's
   * "Fix in settings" lands on the exact panel rather than the first one. Read
   * once from the URL on mount rather than through useSearchParams, which would
   * pull this screen into a Suspense boundary it does not otherwise need, and
   * would be a hydration mismatch if read in the initial state.
   */
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    const valid: Tab[] = ['company', 'contact', 'analytics', 'branding', 'language', 'activity', 'domains', 'code'];
    if (wanted && (valid as string[]).includes(wanted)) setTab(wanted as Tab);
  }, []);

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
    { id: 'contact', label: 'Contact details' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'branding', label: 'Icons and sharing' },
    { id: 'language', label: 'Language' },
    // Activity is for everybody: seeing what happened to a site you belong to is
    // not a privilege, the same reasoning as the members screen, and the action
    // it reads is scoped to the caller's own tenant. It sits before the gated
    // pair so the owner-only tabs stay together at the end.
    { id: 'activity', label: 'Activity' },
    // Domains and custom code share the same gate, owner or staff, so they appear
    // together and only for the same people. The gate itself is in the actions.
    ...(canEditCode ? [{ id: 'domains' as Tab, label: 'Domains' }] : []),
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

        {/*
          WHERE THE BUSINESS IS, added 1 Aug 2026.

          Its own tab rather than more boxes under Your company, because the two
          answer different questions. Your company is what the writing assistant
          reads, and nothing on it is published as a fact. Everything here is: it
          goes straight into the structured data on every page, where a search
          engine and an AI assistant read it as a claim about a real place.

          It is also the only panel in the product that asks a client for
          something they have not already typed somewhere, so it says out loud
          what it buys them.
        */}
        {tab === 'contact' && (
          <section className="tv-group">
            <h2 className="tv-group__title">Where you are</h2>
            <p className="tv-note">
              This is what tells a search engine and an AI assistant that you are a
              real business in a real place. It is the strongest single thing you
              can add: asked to recommend somebody local, an assistant will not
              name a business it cannot place. Leave anything blank that does not
              apply.
            </p>

            <div className="tv-field">
              <label className="tv-field__label" htmlFor="street-address">
                Street address
              </label>
              {/*
                autoComplete off on all of these, deliberately. They are the
                BUSINESS's details, and a browser offering to fill them from the
                address book of whoever happens to be signed in would put
                somebody's home address into the structured data of a public
                website, one click, no warning.
              */}
              <input
                id="street-address"
                className="tv-input"
                type="text"
                maxLength={120}
                autoComplete="off"
                value={settings.streetAddress}
                placeholder="14 Market Street"
                onChange={(event) => set('streetAddress', event.target.value)}
              />
            </div>

            <div className="st-pair">
              <div className="tv-field">
                <label className="tv-field__label" htmlFor="address-locality">
                  Town or city
                </label>
                <input
                  id="address-locality"
                  className="tv-input"
                  type="text"
                  maxLength={80}
                  autoComplete="off"
                  value={settings.addressLocality}
                  placeholder="Leeds"
                  onChange={(event) => set('addressLocality', event.target.value)}
                />
              </div>

              <div className="tv-field">
                <label className="tv-field__label" htmlFor="address-region">
                  County
                </label>
                <input
                  id="address-region"
                  className="tv-input"
                  type="text"
                  maxLength={80}
                  autoComplete="off"
                  value={settings.addressRegion}
                  placeholder="West Yorkshire"
                  onChange={(event) => set('addressRegion', event.target.value)}
                />
              </div>
            </div>

            <div className="st-pair">
              <div className="tv-field">
                <label className="tv-field__label" htmlFor="postal-code">
                  Postcode
                </label>
                <input
                  id="postal-code"
                  className="tv-input"
                  type="text"
                  maxLength={20}
                  autoComplete="off"
                  value={settings.postalCode}
                  placeholder="LS1 6DT"
                  onChange={(event) => set('postalCode', event.target.value)}
                />
              </div>

              <div className="tv-field">
                <label className="tv-field__label" htmlFor="address-country">
                  Country
                </label>
                <input
                  id="address-country"
                  className="tv-input"
                  type="text"
                  maxLength={60}
                  autoComplete="off"
                  value={settings.addressCountry}
                  placeholder="United Kingdom"
                  onChange={(event) => set('addressCountry', event.target.value)}
                />
              </div>
            </div>

            <h2 className="tv-group__title">How to reach you</h2>
            <div className="tv-field">
              <label className="tv-field__label" htmlFor="telephone">
                Phone number
              </label>
              <input
                id="telephone"
                className="tv-input"
                type="tel"
                maxLength={40}
                autoComplete="off"
                value={settings.telephone}
                placeholder="+44 113 496 0000"
                onChange={(event) => set('telephone', event.target.value)}
              />
              <p className="tv-field__help">
                Write it with the country code if you can, so it works when
                somebody taps it on a phone abroad. We do not check the format,
                because a check strict enough to be useful would refuse real
                numbers.
              </p>
            </div>

            <h2 className="tv-group__title">When you are open</h2>
            <div className="tv-field">
              <OpeningHoursField
                value={settings.openingHours}
                onChange={(next) => set('openingHours', next)}
              />
              <p className="tv-field__help">
                Leave a day blank if you are closed. A day needs both a start and
                an end time before it counts.
              </p>
            </div>
          </section>
        )}

        {tab === 'analytics' && (
          <>
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

          <section className="tv-group">
            <h2 className="tv-group__title">Cookie consent</h2>
            <div className="tv-field">
              <label className="tv-check">
                <input
                  type="checkbox"
                  checked={settings.cookieConsent.enabled}
                  onChange={(event) =>
                    set('cookieConsent', { ...settings.cookieConsent, enabled: event.target.checked })
                  }
                />
                <span>Ask visitors before analytics cookies are set</span>
              </label>
              <p className="tv-field__help">
                Shows a banner on your published site. Until a visitor accepts,
                Google Analytics and Tag Manager load with consent denied and set
                no cookie, so this is a real gate rather than a notice. It only
                appears when you have an ID above, because there is nothing to ask
                about otherwise.
              </p>
            </div>

            {settings.cookieConsent.enabled && (
              <>
                {!settings.gtmId && !settings.ga4Id && (
                  <p className="st-warn">
                    <Icon name="warning" size={16} />
                    Add a Tag Manager or Analytics ID above and the banner will
                    start showing. With neither, there is nothing to consent to, so
                    it stays hidden.
                  </p>
                )}

                <div className="tv-field">
                  <label className="tv-field__label" htmlFor="cc-title">
                    Banner heading
                  </label>
                  <input
                    className="tv-colour__hex"
                    id="cc-title"
                    type="text"
                    maxLength={80}
                    value={settings.cookieConsent.title}
                    onChange={(event) =>
                      set('cookieConsent', { ...settings.cookieConsent, title: event.target.value })
                    }
                  />
                </div>

                <div className="tv-field">
                  <label className="tv-field__label" htmlFor="cc-message">
                    Message
                  </label>
                  <textarea
                    className="tv-textarea"
                    id="cc-message"
                    rows={2}
                    maxLength={300}
                    value={settings.cookieConsent.message}
                    onChange={(event) =>
                      set('cookieConsent', { ...settings.cookieConsent, message: event.target.value })
                    }
                  />
                  <p className="tv-field__help">
                    Keep it plain. Say what the cookies are for and that they can
                    accept or carry on without.
                  </p>
                </div>

                <div className="tv-field">
                  <label className="tv-field__label" htmlFor="cc-accept">
                    Accept button
                  </label>
                  <input
                    className="tv-colour__hex"
                    id="cc-accept"
                    type="text"
                    maxLength={40}
                    value={settings.cookieConsent.acceptLabel}
                    onChange={(event) =>
                      set('cookieConsent', { ...settings.cookieConsent, acceptLabel: event.target.value })
                    }
                  />
                </div>

                <div className="tv-field">
                  <label className="tv-field__label" htmlFor="cc-reject">
                    Reject button
                  </label>
                  <input
                    className="tv-colour__hex"
                    id="cc-reject"
                    type="text"
                    maxLength={40}
                    value={settings.cookieConsent.rejectLabel}
                    onChange={(event) =>
                      set('cookieConsent', { ...settings.cookieConsent, rejectLabel: event.target.value })
                    }
                  />
                </div>

                <div className="tv-field">
                  <label className="tv-field__label" htmlFor="cc-policy">
                    Cookie policy link
                  </label>
                  <input
                    className="tv-colour__hex"
                    id="cc-policy"
                    type="text"
                    placeholder="https://your-site.com/cookies"
                    spellCheck={false}
                    value={settings.cookieConsent.policyUrl ?? ''}
                    onChange={(event) =>
                      set('cookieConsent', {
                        ...settings.cookieConsent,
                        policyUrl: event.target.value as SiteSettings['cookieConsent']['policyUrl'],
                      })
                    }
                  />
                  <p className="tv-field__help">
                    Optional. If you have a cookie or privacy page, link it and the
                    banner shows a "Read our cookie policy" link.
                  </p>
                </div>
              </>
            )}
          </section>
          </>
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

            {/*
              STOP RIGHT CLICK. Andy's call, 21 Aug 2026, from Duda's Disable
              Right Click. It lives on this tab because this is where the site's
              own pictures already are, and it is a client-facing choice rather
              than a technical one, so it is not behind the owner-only gate.

              THE HELP TEXT SAYS WHAT IT CANNOT DO. A setting that quietly
              implies the photographs are protected would be the worse outcome
              than not having it: somebody would rely on it.
            */}
            <div className="tv-field">
              <label className="tv-check">
                <input
                  type="checkbox"
                  checked={settings.noRightClick}
                  onChange={(event) => set('noRightClick', event.target.checked)}
                />
                <span>Stop right click on the published site</span>
              </label>
              <p className="tv-field__help">
                Makes it harder to save a picture by right-clicking or dragging it
                off the page. It is a deterrent, not protection: the pictures are
                still in the page and still one screenshot away. Typing fields keep
                their menu, so somebody can still paste an email address into your
                enquiry form.
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

        {tab === 'activity' && <ActivityPanel />}

        {tab === 'domains' && canEditCode && <DomainsPanel />}

        {tab === 'code' && canEditCode && <CustomCodePanel onError={setMessage} />}
      </div>

      {/*
        The global save bar is hidden on the custom code and activity tabs, and on
        both it is a fix rather than a preference.

        Custom code loads and saves its own values through its own gated actions, so
        it has its own button. With both on screen, somebody editing Head HTML and
        pressing "Save settings" at the bottom would get a success state and no
        change: the bottom bar saves the other settings and has never heard of the
        code ones. Two save buttons where one silently ignores what you just typed
        is worse than one button in the right place.

        Activity has nothing to save at all: it is a read-only timeline. A "Save
        settings" bar under it would offer to commit changes that were never made,
        which reads as a screen that does not understand itself.
      */}
      {tab !== 'code' && tab !== 'activity' && (
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
 * The week, as seven rows of two times.
 *
 * BLANK MEANS CLOSED, rather than a Closed checkbox beside each day. A checkbox
 * would be a second control saying the same thing as the two beside it, and the
 * two could disagree: ticked Closed with times still in the boxes, and now
 * something has to decide which one wins. Blank cannot disagree with itself, and
 * the row says "Closed" back so nobody has to guess the convention.
 *
 * A HALF-FILLED ROW IS KEPT, which is the whole reason OpeningHours allows an
 * empty time. A time input reports its value only once a whole time is entered,
 * so picking an opening time arrives here with the closing time still empty. If
 * that were thrown away the field would blank itself the instant it was filled
 * in, and the row would be impossible to complete. It is stored, it counts for
 * nothing, and isOpenDay is the one place that says so.
 *
 * The day name is a span with aria-labels on the inputs rather than a label
 * element, because one label cannot name two fields and "Monday" on its own does
 * not say which of the two it belongs to. A screen reader hears "Monday opening
 * time" and "Monday closing time".
 */
function OpeningHoursField({
  value,
  onChange,
}: {
  value: OpeningHours[];
  onChange: (next: OpeningHours[]) => void;
}) {
  const byDay = new Map(value.map((entry) => [entry.day, entry]));

  function setTime(day: Weekday, key: 'opens' | 'closes', time: string) {
    const next = new Map(byDay);
    const updated = { ...(byDay.get(day) ?? { day, opens: '', closes: '' }), [key]: time };

    // Both blank is not a row at all, so the day comes out rather than being
    // stored as an entry that says nothing.
    if (updated.opens === '' && updated.closes === '') next.delete(day);
    else next.set(day, updated);

    // Rebuilt in weekday order from WEEKDAYS, so the stored list never depends
    // on the order somebody happened to fill the rows in.
    onChange(WEEKDAYS.filter((day_) => next.has(day_)).map((day_) => next.get(day_) as OpeningHours));
  }

  return (
    <div className="st-hours">
      {WEEKDAYS.map((day) => {
        const entry = byDay.get(day);
        const opens = entry?.opens ?? '';
        const closes = entry?.closes ?? '';

        return (
          <div className="st-hours__row" key={day}>
            <span className="st-hours__day">{day}</span>
            <input
              className="st-hours__time"
              type="time"
              value={opens}
              aria-label={`${day} opening time`}
              onChange={(event) => setTime(day, 'opens', event.target.value)}
            />
            <span className="st-hours__to" aria-hidden="true">
              to
            </span>
            <input
              className="st-hours__time"
              type="time"
              value={closes}
              aria-label={`${day} closing time`}
              onChange={(event) => setTime(day, 'closes', event.target.value)}
            />
            <span className="st-hours__state">
              {opens === '' && closes === '' ? 'Closed' : ''}
            </span>
          </div>
        );
      })}
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
