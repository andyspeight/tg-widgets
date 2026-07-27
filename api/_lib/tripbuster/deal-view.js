/**
 * Database row → the shape every consumer surface reads.
 *
 * Lifted out of api/tripbuster/deals.js when the server-rendered pages arrived,
 * because the renderer and the JSON feed have to agree about what a deal is
 * down to the key names. Two mappings would mean a field added to the feed and
 * quietly missing from the page it is meant to appear on.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Turn a travel window into the short label the deal card shows.
 * Same year → "Sep – Nov 2026". Spanning years → "Sep 2026 – Mar 2027".
 */
export function dateLabel(from, until) {
  const f = from ? new Date(from) : null;
  const u = until ? new Date(until) : null;
  const ok = (d) => d && !Number.isNaN(d.getTime());
  if (!ok(f) && !ok(u)) return '';
  if (ok(f) && !ok(u)) return `From ${MONTHS[f.getUTCMonth()]} ${f.getUTCFullYear()}`;
  if (!ok(f) && ok(u)) return `Until ${MONTHS[u.getUTCMonth()]} ${u.getUTCFullYear()}`;
  const sameYear = f.getUTCFullYear() === u.getUTCFullYear();
  return sameYear
    ? `${MONTHS[f.getUTCMonth()]} – ${MONTHS[u.getUTCMonth()]} ${u.getUTCFullYear()}`
    : `${MONTHS[f.getUTCMonth()]} ${f.getUTCFullYear()} – ${MONTHS[u.getUTCMonth()]} ${u.getUTCFullYear()}`;
}

export function toDeal(r) {
  const airports = Array.isArray(r.departure_airports) ? r.departure_airports : [];
  const destination = [r.resort, r.country].filter(Boolean).join(', ');
  return {
    id: r.id,
    // The stable public URL, minted by the database at first publish. Null on a
    // draft, which has no page to link to.
    slug: r.slug || '',
    // The slug of the PAGE this deal appears on, which is not always its own: a
    // deal page shows every agent advertising the same hotel, so the group
    // agrees on one URL. Deliberately the earliest published deal in the group
    // rather than the cheapest — cheapest moves every time somebody undercuts,
    // and a canonical that moves undoes the point of a stable slug.
    canonicalSlug: r.canonical_slug || r.slug || '',
    // card essentials — these key names are what widget-tripbuster.js expects
    title: r.title,
    destination,
    board: r.board_basis || '',
    nights: r.nights || null,
    airport: airports[0] || '',
    dates: dateLabel(r.travel_from, r.travel_until),
    travelFrom: r.travel_from || null,
    travelUntil: r.travel_until || null,
    priceFrom: r.price_from != null ? Number(r.price_from) : null,
    wasPrice: r.was_price != null ? Number(r.was_price) : null,
    currency: r.currency || 'GBP',
    image: r.hero_image_url || '',
    clickoutUrl: r.effective_clickout || '',
    atol: r.effective_atol || '',
    // What this deal charges for, already resolved against the agency default.
    // Drives which calls to action the card shows: a link, a number, or both.
    billingMode: r.effective_billing_mode || 'click',
    phone: r.effective_phone || '',
    // Opening hours, the time zone they are read in, what to show while closed,
    // and every number with its label. Deliberately a SCHEDULE rather than an
    // "open now" answer: this response is CDN-cached, so a computed yes would
    // still read yes an hour after closing time. The page works it out; the
    // database works it out again, from its own clock, when there is money in it.
    contact: r.agent_contact || null,
    discount: r.discount_pct || 0,
    badge: Array.isArray(r.offer_badges) && r.offer_badges.length ? r.offer_badges[0] : '',

    // richer fields the consumer site uses
    strapline: r.strapline || '',
    overview: r.overview || '',
    country: r.country || '',
    region: r.region || '',
    resort: r.resort || '',
    accommodation: r.accommodation_name || '',
    starRating: r.star_rating || null,
    guestScore: r.guest_score != null ? Number(r.guest_score) : null,
    distanceToBeach: r.distance_to_beach || '',
    holidayType: r.holiday_type || '',
    allAirports: airports,
    facilities: Array.isArray(r.facilities) ? r.facilities : [],
    sellingPoints: Array.isArray(r.selling_points) ? r.selling_points : [],
    badges: Array.isArray(r.offer_badges) ? r.offer_badges : [],
    availability: r.availability_status || '',
    protection: r.effective_protection || '',
    updatedAt: r.updated_at || r.published_at || null,
    agent: { name: r.agent_name || '', slug: r.agent_slug || '', town: r.agent_town || '' },

    // present only in compare mode: every agent advertising this same hotel
    agentCount: r.agentCount || 1,
    compare: Array.isArray(r.compare)
      ? r.compare.map((c) => ({
          dealId: c.dealId,
          slug: c.slug || '',
          agent: c.agent,
          agentSlug: c.agentSlug,
          atol: c.atol || '',
          price: c.price != null ? Number(c.price) : null,
          clickoutUrl: c.clickoutUrl || '',
          // A rival on a call-first agency is rung, not clicked.
          phone: c.phone || '',
          billingMode: c.billingMode || 'click',
          // Per rival, because one agency in a compare list can be open while
          // the next is shut, and that is often the reason to ring the second
          // cheapest rather than the cheapest.
          contact: c.contact || null,
        }))
      : undefined,
  };
}
