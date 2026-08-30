'use client';

/**
 * The Floating widgets settings tab: turn on and set up the widgets that sit
 * across the whole site (back to top, WhatsApp, the deal bar, the loader).
 *
 * Its own component because it is large and self-contained: one section per
 * widget, an enable toggle, and its fields underneath only when it is on. Every
 * field binds back through onChange with the same nested-object spread the rest
 * of the settings use. The panel validates nothing itself; the schema
 * (lib/settings/floating-widgets.ts) is the one place values are made safe, so a
 * field here is just a plain control over a plain value.
 */

import type { FloatingWidgetsSettings } from '../../lib/settings/schema';

type Setter<T> = (patch: Partial<T>) => void;

export function FloatingWidgetsPanel({
  value,
  onChange,
}: {
  value: FloatingWidgetsSettings;
  onChange: (next: FloatingWidgetsSettings) => void;
}) {
  const setBackToTop: Setter<FloatingWidgetsSettings['backToTop']> = (patch) =>
    onChange({ ...value, backToTop: { ...value.backToTop, ...patch } });
  const setWhatsapp: Setter<FloatingWidgetsSettings['whatsapp']> = (patch) =>
    onChange({ ...value, whatsapp: { ...value.whatsapp, ...patch } });
  const setDealBar: Setter<FloatingWidgetsSettings['dealBar']> = (patch) =>
    onChange({ ...value, dealBar: { ...value.dealBar, ...patch } });
  const setLoader: Setter<FloatingWidgetsSettings['loader']> = (patch) =>
    onChange({ ...value, loader: { ...value.loader, ...patch } });
  const setPopup: Setter<FloatingWidgetsSettings['popup']> = (patch) =>
    onChange({ ...value, popup: { ...value.popup, ...patch } });

  const btt = value.backToTop;
  const wa = value.whatsapp;
  const db = value.dealBar;
  const ld = value.loader;
  const pu = value.popup;

  return (
    <>
      <p className="tv-field__help" style={{ marginBottom: 12 }}>
        These sit across every published page rather than in a column, so they do
        not show on the editing canvas. Switch one on, save, and{' '}
        <a href="/preview" target="_blank" rel="noopener noreferrer">
          open a preview
        </a>{' '}
        to see it on your site. You do not have to publish first.
      </p>

      {/* --- Back to top --- */}
      <section className="tv-group">
        <Enable
          title="Back to top"
          on={btt.enabled}
          onChange={(enabled) => setBackToTop({ enabled })}
          hint="A small button that fades in as a visitor scrolls down and takes them back to the top."
        />
        {btt.enabled && (
          <>
            <Select
              label="Position"
              value={btt.position}
              onChange={(position) => setBackToTop({ position: position as typeof btt.position })}
              options={[
                ['bottom-right', 'Bottom right'],
                ['bottom-left', 'Bottom left'],
                ['bottom-center', 'Bottom centre'],
              ]}
            />
            <Num label="Show after scrolling (% of page)" value={btt.showAfter} min={1} max={95} onChange={(showAfter) => setBackToTop({ showAfter })} />
            <Colour label="Accent colour" value={btt.accent} onChange={(accent) => setBackToTop({ accent })} />
            <Select
              label="Shape"
              value={btt.shape}
              onChange={(shape) => setBackToTop({ shape: shape as typeof btt.shape })}
              options={[['circle', 'Circle'], ['rounded', 'Rounded'], ['square', 'Square']]}
            />
            <Select
              label="Icon"
              value={btt.icon}
              onChange={(icon) => setBackToTop({ icon: icon as typeof btt.icon })}
              options={[['chevron', 'Chevron'], ['arrow', 'Arrow'], ['double', 'Double chevron']]}
            />
            <Num label="Button size (px)" value={btt.size} min={36} max={80} onChange={(size) => setBackToTop({ size })} />
            <Num label="Distance from edge (px)" value={btt.offset} min={0} max={80} onChange={(offset) => setBackToTop({ offset })} />
            <Check label="Show a text label" value={btt.showLabel} onChange={(showLabel) => setBackToTop({ showLabel })} />
            {btt.showLabel && (
              <Text label="Label" value={btt.labelText} maxLength={16} placeholder="Top" onChange={(labelText) => setBackToTop({ labelText })} />
            )}
            <Check label="Smooth scroll to top" value={btt.smoothScroll} onChange={(smoothScroll) => setBackToTop({ smoothScroll })} />
            <Check label="Drop shadow" value={btt.shadow} onChange={(shadow) => setBackToTop({ shadow })} />
          </>
        )}
      </section>

      {/* --- WhatsApp --- */}
      <section className="tv-group">
        <Enable
          title="WhatsApp chat"
          on={wa.enabled}
          onChange={(enabled) => setWhatsapp({ enabled })}
          hint="A floating WhatsApp button that opens a chat with your number, with the first message written for the visitor."
        />
        {wa.enabled && (
          <>
            <Text
              label="WhatsApp number"
              value={wa.phone}
              maxLength={24}
              placeholder="+44 7900 900900"
              onChange={(phone) => setWhatsapp({ phone })}
            />
            {!wa.phone.trim() && (
              <p className="st-warn" style={{ marginTop: 0 }}>
                Add a number, with its country code, or the button stays hidden.
              </p>
            )}
            <Area label="First message" value={wa.message} rows={2} maxLength={500} onChange={(message) => setWhatsapp({ message })} />
            <Select
              label="Position"
              value={wa.position}
              onChange={(position) => setWhatsapp({ position: position as typeof wa.position })}
              options={[
                ['bottom-right', 'Bottom right'],
                ['bottom-left', 'Bottom left'],
                ['top-right', 'Top right'],
                ['top-left', 'Top left'],
                ['middle-right', 'Middle right'],
                ['middle-left', 'Middle left'],
              ]}
            />
            <Colour label="Brand colour" value={wa.brand} onChange={(brand) => setWhatsapp({ brand })} />
            <Check label="Show a greeting bubble" value={wa.greetingEnabled} onChange={(greetingEnabled) => setWhatsapp({ greetingEnabled })} />
            {wa.greetingEnabled && (
              <>
                <Text label="Greeting text" value={wa.greetingText} maxLength={120} onChange={(greetingText) => setWhatsapp({ greetingText })} />
                <Num label="Greeting delay (seconds)" value={wa.greetingDelay} min={0} max={120} onChange={(greetingDelay) => setWhatsapp({ greetingDelay })} />
              </>
            )}
          </>
        )}
      </section>

      {/* --- Deal bar --- */}
      <section className="tv-group">
        <Enable
          title="Deal bar"
          on={db.enabled}
          onChange={(enabled) => setDealBar({ enabled })}
          hint="A bar across the top or bottom of every page for an offer, with a button and an optional countdown."
        />
        {db.enabled && (
          <>
            <Area label="Message" value={db.message} rows={2} maxLength={300} onChange={(message) => setDealBar({ message })} />
            <Text label="Leading emoji (optional)" value={db.emoji} maxLength={8} onChange={(emoji) => setDealBar({ emoji })} />
            <Select
              label="Position"
              value={db.position}
              onChange={(position) => setDealBar({ position: position as typeof db.position })}
              options={[['top', 'Top of the page'], ['bottom', 'Bottom of the page']]}
            />
            <Colour label="Background colour" value={db.bg} onChange={(bg) => setDealBar({ bg })} />
            <Check label="Show a button" value={db.ctaShow} onChange={(ctaShow) => setDealBar({ ctaShow })} />
            {db.ctaShow && (
              <>
                <Text label="Button label" value={db.ctaLabel} maxLength={40} onChange={(ctaLabel) => setDealBar({ ctaLabel })} />
                <Text label="Button link" value={db.ctaUrl} placeholder="https://…" onChange={(ctaUrl) => setDealBar({ ctaUrl })} />
                <Colour label="Button colour" value={db.ctaBg} onChange={(ctaBg) => setDealBar({ ctaBg })} />
                <Check label="Open the link in a new tab" value={db.ctaNewTab} onChange={(ctaNewTab) => setDealBar({ ctaNewTab })} />
              </>
            )}
            <Check label="Show a countdown" value={db.showCountdown} onChange={(showCountdown) => setDealBar({ showCountdown })} />
            {db.showCountdown && (
              <Text label="Counts down to" value={db.countdownTo} placeholder="2026-09-30T23:59" onChange={(countdownTo) => setDealBar({ countdownTo })} hint="A date and time, e.g. 2026-09-30T23:59." />
            )}
            <Check label="Stick to the screen as they scroll" value={db.sticky} onChange={(sticky) => setDealBar({ sticky })} />
            <Check label="Nudge the page so it never covers content" value={db.pushPage} onChange={(pushPage) => setDealBar({ pushPage })} />
            <Check label="Let visitors dismiss it" value={db.dismissible} onChange={(dismissible) => setDealBar({ dismissible })} />
            {db.dismissible && (
              <Check label="Remember when it is closed" value={db.rememberDismiss} onChange={(rememberDismiss) => setDealBar({ rememberDismiss })} />
            )}
            <Text label="Start showing (optional)" value={db.startAt} placeholder="2026-09-01T00:00" onChange={(startAt) => setDealBar({ startAt })} />
            <Text label="Stop showing (optional)" value={db.endAt} placeholder="2026-09-30T23:59" onChange={(endAt) => setDealBar({ endAt })} />
          </>
        )}
      </section>

      {/* --- Loader --- */}
      <section className="tv-group">
        <Enable
          title="Loading animation"
          on={ld.enabled}
          onChange={(enabled) => setLoader({ enabled })}
          hint="A short branded animation while a page loads. Best kept simple; it shows on every page."
        />
        {ld.enabled && (
          <>
            <Select
              label="Style"
              value={ld.template}
              onChange={(template) => setLoader({ template: template as typeof ld.template })}
              options={[
                ['plane-path', 'Plane along a path'],
                ['globe-spin', 'Spinning globe'],
                ['luggage', 'Luggage'],
                ['route-pins', 'Route pins'],
                ['balloon', 'Balloon'],
                ['spinner', 'Spinner'],
                ['dual-ring', 'Dual ring'],
                ['dots-bounce', 'Bouncing dots'],
                ['bar-sweep', 'Sweeping bar'],
                ['bar-progress', 'Progress bar'],
              ]}
            />
            <Colour label="Primary colour" value={ld.primary} onChange={(primary) => setLoader({ primary })} />
            <Colour label="Secondary colour" value={ld.secondary} onChange={(secondary) => setLoader({ secondary })} />
            <Colour label="Track colour" value={ld.track} onChange={(track) => setLoader({ track })} />
            <Text label="Background" value={ld.background} placeholder="transparent or #ffffff" onChange={(background) => setLoader({ background })} hint="The word transparent, or a colour like #ffffff." />
            <Text label="Caption (optional)" value={ld.label} maxLength={80} onChange={(label) => setLoader({ label })} />
            {ld.label.trim() !== '' && (
              <Colour label="Caption colour" value={ld.labelColor} onChange={(labelColor) => setLoader({ labelColor })} />
            )}
          </>
        )}
      </section>

      {/* --- Popup --- */}
      <section className="tv-group">
        <Enable
          title="Popup"
          on={pu.enabled}
          onChange={(enabled) => setPopup({ enabled })}
          hint="A message that appears over the page, once a visitor arrives, scrolls or goes to leave. Keep it to one clear ask."
        />
        {pu.enabled && (
          <>
            <Select
              label="Style"
              value={pu.layout}
              onChange={(layout) => setPopup({ layout: layout as typeof pu.layout })}
              options={[
                ['centered', 'Centred box'],
                ['slide-in', 'Slide in from a corner'],
                ['floating-card', 'Floating card in a corner'],
                ['top-bar', 'Bar along the top'],
                ['bottom-bar', 'Bar along the bottom'],
              ]}
            />
            <Text label="Heading" value={pu.title} maxLength={80} placeholder="Welcome aboard!" onChange={(title) => setPopup({ title })} />
            <Area label="Message" value={pu.body} rows={2} maxLength={300} onChange={(body) => setPopup({ body })} />
            <Text label="Image (optional)" value={pu.image} placeholder="https://…" onChange={(image) => setPopup({ image })} />
            <Text label="Button label" value={pu.ctaText} maxLength={40} placeholder="Find out more" onChange={(ctaText) => setPopup({ ctaText })} />
            <Text label="Button link" value={pu.ctaUrl} placeholder="https://…" onChange={(ctaUrl) => setPopup({ ctaUrl })} />

            <Select
              label="When it appears"
              value={pu.trigger}
              onChange={(trigger) => setPopup({ trigger: trigger as typeof pu.trigger })}
              options={[
                ['load', 'As the page loads'],
                ['time', 'After a delay'],
                ['scroll', 'After scrolling down'],
                ['exit-intent', 'As they go to leave'],
              ]}
            />
            {pu.trigger === 'time' && (
              <Num label="Delay (seconds)" value={pu.delaySeconds} min={0} max={120} onChange={(delaySeconds) => setPopup({ delaySeconds })} />
            )}
            {pu.trigger === 'scroll' && (
              <Num label="After scrolling (% of page)" value={pu.scrollPercent} min={1} max={100} onChange={(scrollPercent) => setPopup({ scrollPercent })} />
            )}

            <Select
              label="How often"
              value={pu.frequency}
              onChange={(frequency) => setPopup({ frequency: frequency as typeof pu.frequency })}
              options={[
                ['session', 'Once per visit'],
                ['visitor', 'Once ever'],
                ['every-visit', 'Every time'],
                ['every-n-days', 'Every few days'],
              ]}
            />
            {pu.frequency === 'every-n-days' && (
              <Num label="Days between showings" value={pu.frequencyDays} min={1} max={90} onChange={(frequencyDays) => setPopup({ frequencyDays })} />
            )}

            <Colour label="Brand colour" value={pu.brand} onChange={(brand) => setPopup({ brand })} />
            <Colour label="Button colour" value={pu.accent} onChange={(accent) => setPopup({ accent })} />
            <Check label="Dim the page behind it" value={pu.overlay} onChange={(overlay) => setPopup({ overlay })} />
          </>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// The small controls, one per field type
// ---------------------------------------------------------------------------

function Enable({
  title,
  on,
  onChange,
  hint,
}: {
  title: string;
  on: boolean;
  onChange: (on: boolean) => void;
  hint: string;
}) {
  return (
    <>
      <h2 className="tv-group__title">{title}</h2>
      <div className="tv-field">
        <label className="tv-check">
          <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} />
          <span>Show this on the site</span>
        </label>
        <p className="tv-field__help">{hint}</p>
      </div>
    </>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
}) {
  return (
    <div className="tv-field">
      <label className="tv-field__label">{label}</label>
      <input
        className="tv-colour__hex"
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="tv-field__help">{hint}</p>}
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  rows,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  maxLength: number;
}) {
  return (
    <div className="tv-field">
      <label className="tv-field__label">{label}</label>
      <textarea
        className="tv-textarea"
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="tv-field">
      <label className="tv-field__label">{label}</label>
      <input
        className="tv-colour__hex"
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const n = Number(event.target.value);
          onChange(Number.isFinite(n) ? n : value);
        }}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div className="tv-field">
      <label className="tv-field__label">{label}</label>
      <select className="tv-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optValue, optLabel]) => (
          <option key={optValue} value={optValue}>
            {optLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="tv-field">
      <label className="tv-check">
        <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    </div>
  );
}

function Colour({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '#000000';
  return (
    <div className="tv-field">
      <label className="tv-field__label">{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="color"
          value={hex}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          style={{ width: 44, height: 34, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
        />
        <input
          className="tv-colour__hex"
          type="text"
          value={value}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
