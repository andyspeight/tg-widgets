'use strict';

/**
 * lib/engine.js — orchestration.
 *
 * Kept separate from api/check.js so the scan can be run and tested without an
 * HTTP layer. api/check.js does transport, CORS, rate limiting and error
 * shaping. This does the work.
 *
 * The whole scan is ONE page fetch plus robots.txt plus six bot probes. The
 * browser control probe doubles as the page fetch, which is why the on-page
 * pillars read from it rather than going back to the site.
 */

const { normaliseInput } = require('./net');
const access = require('./access');
const onpage = require('./onpage');
const score = require('./score');

/**
 * @param {string} rawUrl whatever the visitor typed
 * @returns {Promise<object>} the client-facing report
 */
async function scan(rawUrl) {
  const url = normaliseInput(rawUrl);

  const accessResult = await access.run(url);
  const html = accessResult.page ? accessResult.page.html : null;
  const { schema, content, authority } = onpage.run(html);

  const report = score.buildReport({
    url: url.href,
    accessResult,
    schemaResult: schema,
    contentResult: content,
    authorityResult: authority,
  });

  return Object.assign(report, {
    scanned: {
      requested: url.href,
      final: accessResult.page ? accessResult.page.finalUrl : url.href,
      robots: {
        found: accessResult.robots.found,
        unknown: accessResult.robots.unknown,
        sitemaps: accessResult.robots.sitemaps.slice(0, 5),
      },
      control: accessResult.control,
    },
    details: {
      schema: {
        blocks: schema.blocks,
        invalid: schema.invalid,
        microdata: schema.microdata,
        types: (schema.types || []).slice(0, 25),
      },
      content: content.signals || {},
      authority: authority.signals || {},
    },
  });
}

module.exports = { scan };
