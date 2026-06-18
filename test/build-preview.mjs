/**
 * Builds a standalone, offline preview of the Spotlight widget with the new
 * "Good to know" planning panel. Inlines the real widget source so the file
 * opens anywhere with no server and no API. For eyeballing only.
 *
 * Run: node test/build-preview.mjs  ->  writes /tmp/preview-spotlight-planning.html
 */
import { readFileSync, writeFileSync } from 'node:fs';

const widgetSrc = readFileSync(new URL('../public/widget-spotlight.js', import.meta.url), 'utf8');

// Country-level payload (Greece owns its planning data).
const greece = {
  level: 'country', name: 'Greece',
  tagline: 'Where every island tells a different story',
  region: 'Mediterranean and Southern Europe',
  images: ['https://images.unsplash.com/photo-1503152394-c571994fd383?w=1600&q=80'],
  attributions: ['Photo: Unsplash'],
  climate: {
    temps: [12,12,14,17,22,27,30,30,26,21,17,14],
    rainfall: [60,50,40,25,12,5,2,3,10,45,70,75],
    season: ['off','off','shoulder','shoulder','best','best','best','best','best','shoulder','off','off'],
  },
  facts: { flightTime: '3h 45m', timeZone: 'GMT +2', currency: 'Euro (EUR)', language: 'Greek', voltage: '230V Type F' },
  highlights: [
    { icon: 'temple', title: 'Ancient wonders', description: 'The Acropolis, Delphi and Knossos bring three thousand years of history within easy reach.' },
    { icon: 'beach', title: 'Island beaches', description: 'From volcanic black sand on Santorini to soft gold bays on Crete and the Ionian.' },
    { icon: 'food', title: 'Tavernas and wine', description: 'Long lunches of fresh fish, village salads and assyrtiko by the water.' },
  ],
  bestForTags: ['Couples', 'Beach', 'Culture', 'Honeymoons', 'Families'],
  events: [{ month: 'Jul-Aug', name: 'Athens Epidaurus Festival', description: 'Open-air theatre and music at ancient venues across the summer.' }],
  planning: {
    priceBand: '£££',
    bookingLead: 'Book ahead (3-6 months)',
    tripDuration: ['7 nights', '10-14 nights'],
    visaStatus: 'Not required',
    visaAdvisory: 'UK passport holders can visit Greece visa-free under Schengen rules: up to 90 days within any 180-day period for tourism or business. Passport must be valid for at least 3 months beyond planned departure and issued within the last 10 years.',
    healthNotes: 'No vaccinations required. Tap water is generally safe in Athens and main resort areas. Heat is intense in summer, so sun protection and hydration are essential. Standard travel insurance recommended.',
  },
  planningInherited: {}, factsInherited: {},
};

// Resort-level payload (Oludeniz) with planning INHERITED from the country, the
// way the API would deliver it. Price band uses real pound signs here.
const oludeniz = JSON.parse(JSON.stringify(greece));
oludeniz.level = 'resort';
oludeniz.name = 'Oludeniz';
oludeniz.tagline = 'A sheltered blue lagoon under the paragliders of Babadag';
oludeniz.region = 'Fethiye and the Turquoise Coast';
oludeniz.facts.flightTime = '4h 10m';
oludeniz.planning.priceBand = '££';
oludeniz.planning.tripDuration = ['7 nights'];
oludeniz.planningInherited = { priceBand: 'country', bookingLead: 'country', visaStatus: 'country', visaAdvisory: 'country', healthNotes: 'country', tripDuration: 'city' };

const page = `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spotlight planning panel preview</title>
<style>
  body { margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#F8FAFC; color:#0F172A; }
  .wrap { max-width:1040px; margin:0 auto; padding:32px 24px 80px; }
  h1 { font-size:24px; margin:0 0 4px; }
  p.lead { color:#475569; margin:0 0 28px; }
  .label { font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#64748B; margin:36px 0 12px; }
  .card { background:#fff; border:1px solid #E2E8F0; border-radius:18px; padding:24px; }
</style></head>
<body><div class="wrap">
  <h1>Destination Spotlight &mdash; new &ldquo;Good to know&rdquo; panel</h1>
  <p class="lead">Offline preview. The panel sits between Quick facts and Highlights. Click the visa and health rows to expand.</p>

  <div class="label">Country level &mdash; Greece (owns its planning data)</div>
  <div class="card"><div id="host-country"></div></div>

  <div class="label">Resort level &mdash; Oludeniz (visa, health, price and booking inherited from Turkey; trip length from the city)</div>
  <div class="card"><div id="host-resort"></div></div>
</div>

<script>${widgetSrc}</script>
<script>
  new window.TGSpotlightWidget(document.getElementById('host-country'), { destinationData: ${JSON.stringify(greece)}, sections: { hero:true, tags:true, climate:false, facts:true, planning:true, highlights:false, events:false, cta:false } });
  new window.TGSpotlightWidget(document.getElementById('host-resort'),  { destinationData: ${JSON.stringify(oludeniz)}, sections: { hero:true, tags:false, climate:false, facts:true, planning:true, highlights:false, events:false, cta:false } });
</script>
</body></html>`;

writeFileSync('/tmp/preview-spotlight-planning.html', page);
console.log('Wrote /tmp/preview-spotlight-planning.html (' + page.length + ' bytes)');
