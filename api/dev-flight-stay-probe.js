/**
 * TEMPORARY probe (9 Sep 2026) — multi-night TicketAccommodationFlight, the
 * shape the stay calendar on the flight package will emit. Base links are the
 * probe-verified 24 Aug cases with only fr/to/dur varied. Deleted after the
 * run; results recorded in scripts/probe-flight-deeplink.js.
 */

const CASES = [
  ['pkg-2n-event-384', 'https://dl.tvllnk.com/deeplink/384?st=TicketAccommodationFlight&supp=179&refe=395302&curr=GBP&fr=2026-09-16&to=2026-09-18&lat=41.3809&lng=2.12283&rad=20&org=LGW&dst=BCN&frd=0&dur=2&dir=false&adt=2&chd=0&inf=0&loc=FC+Barcelona+vs+Racing+Santander+%28Football+%28Soccer%29%2C+Spanish+La+Liga%29%3A+16-Sep-2026'],
  ['pkg-2n-event-250', 'https://dl.tvllnk.com/deeplink/250?st=TicketAccommodationFlight&supp=179&refe=395302&curr=GBP&fr=2026-09-16&to=2026-09-18&lat=41.3809&lng=2.12283&rad=20&org=LGW&dst=BCN&frd=0&dur=2&dir=false&adt=2&chd=0&inf=0&loc=FC+Barcelona+vs+Racing+Santander+%28Football+%28Soccer%29%2C+Spanish+La+Liga%29%3A+16-Sep-2026'],
  ['pkg-2n-early-384', 'https://dl.tvllnk.com/deeplink/384?st=TicketAccommodationFlight&supp=179&refe=395302&curr=GBP&fr=2026-09-15&to=2026-09-17&lat=41.3809&lng=2.12283&rad=20&org=LGW&dst=BCN&frd=0&dur=2&dir=false&adt=2&chd=0&inf=0&loc=FC+Barcelona+vs+Racing+Santander+%28Football+%28Soccer%29%2C+Spanish+La+Liga%29%3A+16-Sep-2026'],
  ['pkg-5n-span-250', 'https://dl.tvllnk.com/deeplink/250?st=TicketAccommodationFlight&supp=179&refe=395302&curr=GBP&fr=2026-09-14&to=2026-09-19&lat=41.3809&lng=2.12283&rad=20&org=LGW&dst=BCN&frd=0&dur=5&dir=false&adt=2&chd=0&inf=0&loc=FC+Barcelona+vs+Racing+Santander+%28Football+%28Soccer%29%2C+Spanish+La+Liga%29%3A+16-Sep-2026'],
];

export default async function handler(req, res) {
  const rows = await Promise.all(CASES.map(async ([name, url]) => {
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const body = r.status >= 300 && r.status < 400 ? '' : (await r.text()).slice(0, 200);
      return { name, status: r.status, location: r.headers.get('location') || null, body };
    } catch (e) {
      return { name, error: String(e && e.message).slice(0, 100) };
    }
  }));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ rows });
}
