/**
 * The cookie consent banner's one script tag, and the element it reads from.
 *
 * CONDITIONAL, the same rule the rest of this tree keeps: a page that asks for
 * nothing ships nothing. It renders only when the client turned the banner on
 * AND there is an analytics tag to gate (consentGates), so a site with no
 * tracking never carries a banner asking to consent to cookies it does not set.
 *
 * NO CLIENT REACT. Like NoRightClickScript and the widget scripts, this is a
 * server component that emits a plain same-origin script. The banner builds its
 * own DOM in public/cookie-consent.js. The copy travels as data attributes,
 * which React escapes, so nothing a client typed reaches the page as markup.
 *
 * The element is hidden: it carries settings, it is not the banner. The script
 * reads its attributes and draws the banner into the body itself.
 */

import type { ReactElement } from 'react';

import type { SiteSettings } from '../../lib/settings/schema';
import { consentGates } from '../../lib/settings/head';

export function CookieConsent({ settings }: { settings: SiteSettings }): ReactElement | null {
  if (!consentGates(settings)) return null;

  const consent = settings.cookieConsent;

  return (
    <>
      <div
        id="tgs-consent"
        hidden
        data-title={consent.title}
        data-message={consent.message}
        data-accept={consent.acceptLabel}
        data-reject={consent.rejectLabel}
        data-policy={consent.policyUrl ?? ''}
      />
      <script src="/cookie-consent.js" defer />
    </>
  );
}
