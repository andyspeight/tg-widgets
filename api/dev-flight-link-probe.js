/**
 * TEMPORARY — verifies the built TicketAccommodationFlight links against the
 * live Travelify endpoint before any widget shows the button. Deleted after.
 *
 * The three cases: our built link on Andy's app (the example's own account),
 * the same link on the demo 250 app the demos run on, and the __ORG__
 * placeholder form as a control (expected to fail — surfaces must always
 * substitute a real IATA code first).
 */

const CASES = [
  ['built-384-org-LGW', 'https://dl.tvllnk.com/deeplink/384?st=TicketAccommodationFlight&supp=179&refe=395302&curr=GBP&fr=2026-09-16&to=2026-09-16&lat=41.3809&lng=2.12283&rad=20&org=LGW&dst=BCN&frd=0&dur=1&dir=false&adt=2&chd=0&inf=0&loc=FC+Barcelona+vs+Racing+Santander+%28Football+%28Soccer%29%2C+Spanish+La+Liga%29%3A+16-Sep-2026'],
  ['built-250-org-LGW', 'https://dl.tvllnk.com/deeplink/250?st=TicketAccommodationFlight&supp=179&refe=395302&curr=GBP&fr=2026-09-16&to=2026-09-16&lat=41.3809&lng=2.12283&rad=20&org=LGW&dst=BCN&frd=0&dur=1&dir=false&adt=2&chd=0&inf=0&loc=FC+Barcelona+vs+Racing+Santander+%28Football+%28Soccer%29%2C+Spanish+La+Liga%29%3A+16-Sep-2026'],
  ['placeholder-org', 'https://dl.tvllnk.com/deeplink/384?st=TicketAccommodationFlight&supp=179&refe=395302&curr=GBP&fr=2026-09-16&to=2026-09-16&lat=41.3809&lng=2.12283&rad=20&org=__ORG__&dst=BCN&frd=0&dur=1&dir=false&adt=2&chd=0&inf=0&loc=FC+Barcelona+vs+Racing+Santander+%28Football+%28Soccer%29%2C+Spanish+La+Liga%29%3A+16-Sep-2026'],
  ['andys-example', 'https://dl.tvllnk.com/deeplink/384?st=TicketAccommodationFlight&supp=144&refe=1939276025ff419489c076968d8f51b8_gnr&curr=GBP&fr=2026-09-16&to=2026-09-16&lat=41.38087&lng=2.122802&rad=20&org=LGW&dst=BCN&frd=0&dur=1&dir=false&adt=2&chd=0&inf=0&loc=FC+Barcelona+vs+Racing+de+Santander+(Football%2C+La+Liga)%3A+16-Sep-2026+17%3A00'],
];

export default async function handler(req, res) {
  const rows = [];
  for (const [name, url] of CASES) {
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const body = r.status >= 300 && r.status < 400 ? '' : (await r.text()).slice(0, 200);
      rows.push({ name, status: r.status, location: r.headers.get('location') || null, body });
    } catch (e) {
      rows.push({ name, error: String(e && e.message).slice(0, 100) });
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ rows });
}
