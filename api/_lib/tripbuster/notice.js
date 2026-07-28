/**
 * The small standalone pages somebody lands on from an email.
 *
 * Confirming an address, approving an agency. They are not part of the browsable
 * site and there is nothing to index, but they are the first page a new customer
 * ever sees, so they get the real header, the real footer and a plain sentence
 * about what happens next rather than a bare "OK".
 */
import * as TB from '../../../public/tripbuster/tb-site.js';
import { htmlDocument, esc, SITE_NAME } from './seo.js';

/**
 * @param {object} o
 * @param {string} o.title    browser tab and <h1>
 * @param {string} o.body     one or two sentences, already escaped or safe HTML
 * @param {{href:string,label:string}} [o.cta]
 * @param {string} [o.tone]   'good' | 'bad' — colours the icon only
 * @param {string} [o.form]   raw HTML for a form, when the page needs a POST
 */
export function noticePage(o) {
  const good = o.tone !== 'bad';
  const icon = good
    ? '<path d="M20 6 9 17l-5-5"/>'
    : '<circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/>';

  const body = `<div class="notice">
  <span class="notice-mark${good ? '' : ' is-bad'}">${TB.svg(icon)}</span>
  <h1>${esc(o.title)}</h1>
  <p>${o.body}</p>
  ${o.form || ''}
  ${o.cta ? `<a class="btn btn-primary" href="${esc(o.cta.href)}">${esc(o.cta.label)}</a>` : ''}
</div>`;

  return htmlDocument({
    title: `${o.title} | ${SITE_NAME}`,
    description: 'Tripbuster account',
    // Nothing here belongs in a search index: these pages only make sense to
    // the one person holding the link that reached them.
    robots: 'noindex, nofollow',
    body: `${TB.header('')}
<main id="main" class="wrap">
${body}
</main>
${TB.footer()}`,
  });
}
