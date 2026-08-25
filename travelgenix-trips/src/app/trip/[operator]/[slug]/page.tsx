// =============================================================================
//  /trip/[operator]/[slug] — the public trip page
// =============================================================================
//  Operator-branded, not Travelgenix-branded. Phase 0 renders the spine only;
//  phase 1 gives it the full body and phase 2 gives it a booking button.
//
//  Nothing here reveals traveller data. Availability is counts only, exactly as
//  the widget endpoint has always done it: the select list is party_size,
//  status and hold_expires_at, and nothing else is ever added to it.
// =============================================================================

import { notFound } from 'next/navigation';
import { sbRequest, tripsDbConfigured } from '@/lib/supabase';
import { summarise, COUNTING_STATUSES, type CountableBooking, type Availability } from '@/lib/capacity';
import { format as money } from '@/lib/money';
import type { Trip, Departure, Operator } from '@/lib/types';

// Matches the 60s CDN cache the widget availability endpoint already uses, so
// the origin is hit about once a minute per trip however busy the page gets.
export const revalidate = 60;

interface Params { operator: string; slug: string }

export default async function TripPage({ params }: { params: Promise<Params> }) {
  const { operator: operatorSlug, slug } = await params;
  if (!tripsDbConfigured()) notFound();

  const operators = await sbRequest<Operator[]>(
    `gt_operators?slug=eq.${encodeURIComponent(operatorSlug)}&select=*&limit=1`,
  ).catch(() => null);
  const operator = operators?.[0];
  if (!operator) notFound();

  const trips = await sbRequest<Trip[]>(
    `gt_trips?operator_id=eq.${operator.id}&slug=eq.${encodeURIComponent(slug)}` +
      `&status=eq.published&select=*&limit=1`,
  ).catch(() => null);
  const trip = trips?.[0];
  if (!trip) notFound();

  const departures =
    (await sbRequest<Departure[]>(
      `gt_departures?trip_id=eq.${trip.id}&status=eq.open&select=*&order=starts_on.asc`,
    ).catch(() => null)) ?? [];

  // One query for every departure on the page, not one per departure. Grouped
  // in memory afterwards, so a trip with twenty dates still costs a single read.
  const availability = await availabilityByDeparture(departures);

  const accent = operator.brand?.primaryColour || 'var(--tg-accent)';

  return (
    <main style={{ maxWidth: 760, margin: '56px auto', padding: '0 24px' }}>
      <p style={{ color: 'var(--tg-muted)', fontSize: 13, margin: 0 }}>{operator.name}</p>
      <h1 style={{ margin: '6px 0 8px', textWrap: 'balance' }}>{trip.title}</h1>
      {trip.location && <p style={{ color: 'var(--tg-ink-2)', margin: 0 }}>{trip.location}</p>}
      {trip.summary && <p style={{ marginTop: 20 }}>{trip.summary}</p>}

      <h2 style={{ fontSize: '1.1rem', marginTop: 40 }}>Departures</h2>

      {departures.length === 0 ? (
        <p style={{ color: 'var(--tg-muted)' }}>No dates on sale at the moment.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {departures.map((d) => {
            const seats = availability.get(d.id);
            // A zero price is not free, it is unpriced (locked 10 Aug 2026).
            const price = money(d.price_pence, trip.currency);

            return (
              <li
                key={d.id}
                style={{
                  padding: '16px 0',
                  borderTop: '1px solid var(--tg-rule)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 16,
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <span>
                  {formatDate(d.starts_on)} to {formatDate(d.ends_on)}
                </span>
                <span style={{ color: accent, fontWeight: 600 }}>
                  {price ?? 'Price on request'}
                </span>
                <span style={{ color: 'var(--tg-muted)', fontSize: 13 }}>
                  {describeAvailability(seats)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/**
 * Counts only, for every departure at once. Returns an empty map on failure so
 * the page renders WITHOUT a places-left line rather than showing a wrong
 * number or an error. Fails calm, same as /api/trip-availability.
 */
async function availabilityByDeparture(
  departures: Departure[],
): Promise<Map<string, Availability>> {
  const out = new Map<string, Availability>();
  if (departures.length === 0) return out;

  const ids = departures.map((d) => d.id).join(',');
  const statuses = COUNTING_STATUSES.join(',');

  const rows =
    (await sbRequest<Array<CountableBooking & { departure_id: string }>>(
      `gt_bookings?departure_id=in.(${ids})&status=in.(${statuses})` +
        `&select=departure_id,party_size,status,hold_expires_at`,
    ).catch(() => null)) ?? null;

  if (!rows) return out;

  const grouped = new Map<string, CountableBooking[]>();
  for (const row of rows) {
    const list = grouped.get(row.departure_id);
    if (list) list.push(row);
    else grouped.set(row.departure_id, [row]);
  }

  const now = Date.now();
  for (const d of departures) {
    out.set(d.id, summarise(d.capacity, grouped.get(d.id) ?? [], now));
  }
  return out;
}

function describeAvailability(seats: Availability | undefined): string {
  if (!seats || seats.capacity <= 0) return '';
  if (seats.soldOut) return 'Sold out';
  return `${seats.remaining} places left`;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
