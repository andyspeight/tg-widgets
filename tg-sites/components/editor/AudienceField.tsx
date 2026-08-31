'use client';

/**
 * The "Who sees this" audience control, shared by the section and block property
 * panels (Properties.tsx) and the site-wide Popup settings (FloatingWidgetsPanel).
 * A toggle reveals the facets: show/hide mode, a searchable country picker,
 * language chips, a utm_campaign box, traffic source, device and returning. It
 * holds the working rule locally so a mode sticks before a facet is picked, and
 * commits the tidied rule up; an empty rule commits undefined. Extracted here so
 * every surface that targets an audience uses one control, not three.
 */

import { useMemo, useState, type CSSProperties } from 'react';

import {
  AUDIENCE_SOURCES,
  type Audience,
  type AudienceDevice,
  type AudienceMode,
  type AudienceVisitor,
} from '../../lib/content/audience';
import { ISO_COUNTRIES } from '../../lib/content/countries';
import { COMMON_LANGUAGES } from '../../lib/content/languages';

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ed-field">
      <label className="ed-label">{label}</label>
      <div
        className="ed-segmented"
        role="group"
        aria-label={label}
        style={{ '--ed-seg-count': options.length } as CSSProperties}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Strip a working audience down to what is worth storing, or nothing. */
function tidyAudience(audience: Audience): Audience | undefined {
  const out: Audience = { mode: audience.mode === 'hide' ? 'hide' : 'show' };
  if (audience.countries && audience.countries.length) out.countries = audience.countries;
  if (audience.languages && audience.languages.length) out.languages = audience.languages;
  if (audience.campaigns && audience.campaigns.length) out.campaigns = audience.campaigns;
  if (audience.source && audience.source.length) out.source = audience.source;
  if (audience.device) out.device = audience.device;
  if (audience.visitor) out.visitor = audience.visitor;
  // A rule with no facet constrains nobody, so it is no rule.
  if (
    !out.countries &&
    !out.languages &&
    !out.campaigns &&
    !out.source &&
    !out.device &&
    !out.visitor
  ) {
    return undefined;
  }
  return out;
}

const SOURCE_LABEL: Record<(typeof AUDIENCE_SOURCES)[number], string> = {
  search: 'Search',
  social: 'Social',
  direct: 'Direct',
};

/**
 * A searchable multi-select over the whole country list, so a client is not
 * boxed into a shortlist. The chosen countries sit as removable chips above a
 * search box; typing filters the full ISO list and each result toggles. The rule
 * stores alpha-2 codes; the names are presentation only (lib/content/countries).
 */
function CountryPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const nameByCode = useMemo(() => new Map(ISO_COUNTRIES.map((c) => [c.code, c.name])), []);
  const q = query.trim().toLowerCase();
  const matches = q
    ? ISO_COUNTRIES.filter(
        (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q,
      ).slice(0, 60)
    : [];
  const toggle = (code: string) =>
    onChange(selected.includes(code) ? selected.filter((x) => x !== code) : [...selected, code]);

  return (
    <div className="ed-country">
      {selected.length > 0 && (
        <div className="ed-chips" role="group" aria-label="Chosen countries">
          {selected.map((code) => (
            <button
              key={code}
              type="button"
              className="ed-chip is-on"
              aria-label={`Remove ${nameByCode.get(code) ?? code}`}
              onClick={() => toggle(code)}
            >
              {nameByCode.get(code) ?? code} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <input
        className="ed-input"
        type="search"
        placeholder="Search countries…"
        aria-label="Search countries"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {q && (
        <ul className="ed-country__list">
          {matches.length === 0 && (
            <li className="ed-help" style={{ padding: '6px 8px' }}>
              No match.
            </li>
          )}
          {matches.map((country) => {
            const on = selected.includes(country.code);
            return (
              <li key={country.code}>
                <button
                  type="button"
                  className={`ed-country__opt${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggle(country.code)}
                >
                  <span>{country.name}</span>
                  {on && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * WHO SEES THIS SECTION: the per-section personalisation control.
 *
 * The working rule is held locally, seeded from the section, so a choice like
 * "Hide from" sticks while the client is still picking the country it applies to
 * (the stored value is dropped to nothing until a facet exists, but the panel
 * must not forget the mode in the meantime). The parent keys this by section id,
 * so switching sections remounts it and re-seeds from that section's own rule.
 * Every change commits the tidied rule up; an empty one commits undefined, which
 * is exactly a section with no rule.
 */
export function AudienceField({
  audience,
  onChange,
  noun = 'section',
}: {
  audience: Audience | undefined;
  onChange: (next: Audience | undefined) => void;
  /** 'section' or 'block', so the copy names what the rule is on. */
  noun?: 'section' | 'block';
}) {
  const [enabled, setEnabled] = useState<boolean>(Boolean(audience));
  const [draft, setDraft] = useState<Audience>(audience ?? { mode: 'show' });
  // The campaign box keeps the raw text so a comma the client is mid-typing is
  // not eaten; the committed value is the split, lowercased list.
  const [campaignText, setCampaignText] = useState((audience?.campaigns ?? []).join(', '));

  const change = (patch: Partial<Audience>) => {
    const next: Audience = { ...draft, ...patch };
    setDraft(next);
    onChange(tidyAudience(next));
  };

  const countries = draft.countries ?? [];
  const languages = draft.languages ?? [];
  const sources = draft.source ?? [];

  return (
    <div className="ed-field">
      <label className="ed-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            if (event.target.checked) {
              setEnabled(true);
            } else {
              setEnabled(false);
              onChange(undefined);
            }
          }}
        />
        <span>Show this {noun} to some visitors only</span>
      </label>
      <p className="ed-help" style={{ marginTop: 6 }}>
        A {noun} can be shown to, or hidden from, visitors by where they are, how
        they arrived, their language, their device, or whether they have been before.
        Leave a choice empty or on Any to not use it. Design a plain version alongside
        a targeted one, so every visitor sees something.
      </p>

      {enabled && (
        <div className="ed-audience">
          <Segmented
            label="Rule"
            value={draft.mode}
            options={[
              { value: 'show', label: 'Show only to' },
              { value: 'hide', label: 'Hide from' },
            ]}
            onChange={(value) => change({ mode: value as AudienceMode })}
          />

          <div className="ed-field">
            <label className="ed-label">Countries</label>
            <CountryPicker
              selected={countries}
              onChange={(next) => change({ countries: next })}
            />
            <p className="ed-help">None chosen means any country.</p>
          </div>

          <div className="ed-field">
            <label className="ed-label">Languages</label>
            <div className="ed-chips" role="group" aria-label="Languages">
              {COMMON_LANGUAGES.map((language) => {
                const on = languages.includes(language.code);
                return (
                  <button
                    key={language.code}
                    type="button"
                    className={`ed-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      change({
                        languages: on
                          ? languages.filter((code) => code !== language.code)
                          : [...languages, language.code],
                      })
                    }
                  >
                    {language.name}
                  </button>
                );
              })}
            </div>
            <p className="ed-help">The visitor&apos;s browser language. None means any.</p>
          </div>

          <div className="ed-field">
            <label className="ed-label" htmlFor="ed-audience-campaigns">
              Campaigns
            </label>
            <input
              id="ed-audience-campaigns"
              className="ed-input"
              value={campaignText}
              placeholder="summer-sale, winter-2026"
              onChange={(event) => {
                setCampaignText(event.target.value);
                const list = Array.from(
                  new Set(
                    event.target.value
                      .split(',')
                      .map((entry) => entry.trim().toLowerCase())
                      .filter(Boolean),
                  ),
                );
                change({ campaigns: list });
              }}
            />
            <p className="ed-help">
              Match a link&apos;s <code>utm_campaign</code>, so a section shows only to
              visitors who arrived on that campaign. Comma separated. None means any.
            </p>
          </div>

          <div className="ed-field">
            <label className="ed-label">Arrived from</label>
            <div className="ed-chips" role="group" aria-label="Traffic source">
              {AUDIENCE_SOURCES.map((source) => {
                const on = sources.includes(source);
                return (
                  <button
                    key={source}
                    type="button"
                    className={`ed-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      change({
                        source: on ? sources.filter((s) => s !== source) : [...sources, source],
                      })
                    }
                  >
                    {SOURCE_LABEL[source]}
                  </button>
                );
              })}
            </div>
            <p className="ed-help">Search engines, social links, or a direct visit. None means any.</p>
          </div>

          <Segmented
            label="Device"
            value={draft.device ?? 'any'}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'mobile', label: 'Phone' },
              { value: 'desktop', label: 'Desktop' },
            ]}
            onChange={(value) =>
              change({ device: value === 'any' ? undefined : (value as AudienceDevice) })
            }
          />

          <Segmented
            label="Been before"
            value={draft.visitor ?? 'any'}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'new', label: 'New' },
              { value: 'returning', label: 'Returning' },
            ]}
            onChange={(value) =>
              change({ visitor: value === 'any' ? undefined : (value as AudienceVisitor) })
            }
          />

          <p className="ed-help" data-tone="warn" style={{ marginTop: 4 }}>
            Press the eye button and use Preview as to check each audience. Country is
            read at the edge and is unknown in the editor.
          </p>
        </div>
      )}
    </div>
  );
}

