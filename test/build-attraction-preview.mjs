/**
 * Offline preview of the Attraction Spotlight (post-QA): theme-park icons,
 * aligned spacing, no "For travel agents" section. Inlines the real widget and
 * real Disneyland Paris content. For eyeballing only.
 *
 * Run: node test/build-attraction-preview.mjs  ->  /tmp/preview-attraction.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
const widgetSrc = readFileSync(new URL('../public/widget-attraction.js', import.meta.url), 'utf8');

const dlp = {
  name: 'Disneyland Paris',
  tagline: "Europe's most-visited theme park, with two parks and a sprinkle of pixie dust",
  type: 'Resort Complex', operator: 'Disney', country: 'France', location: 'Marne-la-Vallée, Paris',
  lat: 48.8722, lng: 2.7758,
  overview: 'Disneyland Paris is the closest Disney resort to the UK, with two parks: Disneyland Park, the classic castle park, and Disney Adventure World, renamed from Walt Disney Studios in March 2026.\n\nIt sits around 32 miles east of central Paris and is the most accessible Disney experience for UK families, reachable by Eurostar, ferry, Eurotunnel or a short flight.',
  bestTime: 'Quietest on weekdays in January, February, May to June and September to mid-October. Peak at Christmas, Easter and the summer holidays. The Halloween and Christmas seasons bring excellent themed events.',
  season: 'Year-round (parks open daily)', daysNeeded: '2-4 days', priceBand: 'Premium (£200-£400)',
  bestFor: ['Families', 'Young Children (under 7)', 'Older Children (7-12)', 'Disney Fans', 'First-timers', 'Couples'],
  starAttractions: 'In Disneyland Park: Big Thunder Mountain (widely rated the best version in the world), Phantom Manor, Pirates of the Caribbean and Star Wars Hyperspace Mountain. In Disney Adventure World: Avengers Campus, the Tower of Terror, Crushs Coaster and the new World of Frozen with its Frozen Ever After boat ride beneath a 36-metre North Mountain.',
  familyGuide: 'Excellent for younger families, with Fantasyland and Adventureland full of no-minimum-height rides. Baby Care Centres in both parks, a Rider Switch programme and pushchair hire. The new World of Frozen is a headline draw for younger guests.',
  thrillGuide: 'Less thrill-focused than Florida, but Big Thunder Mountain, Hyperspace Mountain and Crushs Coaster are excellent. The Tower of Terror is the headline thrill, and Avengers Assemble Flight Force is the Marvel coaster.',
  heightRestrict: 'Most family rides have no minimum height. Common minimums: 1.02m for Big Thunder Mountain and Crushs Coaster, 1.20m for Hyperspace Mountain and the Tower of Terror, 1.32m for the most intense rides.',
  accessibility: 'A Disability Access card is available at Guest Services and gives reduced waiting at attractions. Wheelchair and scooter hire available. Audio description and sign language for selected shows. Service dogs welcome.',
  fastTrack: 'Disney Premier Access is the paid skip-the-queue, either per ride or as a full-day Ultimate pass. Worth it on busy days, usually unnecessary in low season. A free Standby Pass is offered for the newest rides.',
  tickets: 'One-park one-day tickets start cheaper off-peak and rise at peak, with multi-day tickets much better value per day. Under-3s go free. UK package deals that bundle a Disney hotel with tickets are often the best value. Check the official site for live prices.',
  nearestAirport: 'Paris Charles de Gaulle (CDG), 35-45 minutes by TGV or RER A. Paris Orly (ORY) around 75 minutes. Most UK families travel by Eurostar.',
  gettingThere: 'Best route for UK families is Eurostar from London to Lille, then a TGV to Marne-la-Vallée Chessy, a 2-minute walk from the gates. Driving via the Eurotunnel is the most economical for families of four or more.',
  nearestTown: 'Marne-la-Vallée, around 32 miles east of central Paris, just off the A4. The simplest arrival is by train to Marne-la-Vallée Chessy.',
  onSiteHotels: 'Seven Disney-owned hotels, all with the early-entry Extra Magic Time perk. The five-star Disneyland Hotel sits at the park entrance, down through the mid-tier Newport Bay Club and Sequoia Lodge to the cheaper Hotel Cheyenne and Santa Fe, plus the self-catering Davy Crockett Ranch cabins.',
  hasOnSiteHotels: true,
  nearbyHotels: 'Partner hotels nearby (the Val de France complex, Radisson Blu and Marriotts Village) run free shuttles and cost less, but without Extra Magic Time.',
  foodDrink: 'Over 200 dining options from quick-service to signature restaurants. Character dining at Auberge de Cendrillon and the Ratatouille-themed Bistrot Chez Rémy are bookable 60 days ahead. Outside food is permitted in moderation.',
  dogFriendly: false,
  quirks: 'Manage UK families expectations: Disneyland Paris has two parks and far fewer rides than Florida. The direct Eurostar to Marne-la-Vallée was withdrawn in 2023, so customers now change at Lille. Tickets must be bought online in advance.',
  combineWith: 'Paris itself is the natural pairing, 32 miles west. Parc Astérix is around 1 hour 15 minutes away. The Val dEurope shopping centre is one RER stop away.',
  tourOperators: 'TUI, Disney Holidays UK, easyJet holidays and Eurostar packages.',
  officialWebsite: 'https://www.disneylandparis.com', verifiedDate: '2026-05-30',
};

const page = `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Attraction Spotlight preview (QA)</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  body { margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#F1F5F9; color:#0F172A; }
  .wrap { max-width:1040px; margin:0 auto; padding:28px 20px 80px; }
  h1 { font-size:22px; margin:0 0 4px; }
  p.lead { color:#475569; margin:0 0 24px; font-size:14px; }
  .frame { background:#fff; border-radius:20px; box-shadow:0 10px 40px -12px rgba(15,23,42,0.18); padding:18px; }
  .controls { margin:0 0 18px; }
  button { font:inherit; font-size:13px; font-weight:600; padding:7px 14px; border-radius:999px; border:1px solid #CBD5E1; background:#fff; cursor:pointer; }
  button.on { background:#0F172A; color:#fff; border-color:#0F172A; }
</style></head>
<body><div class="wrap">
  <h1>Attraction Spotlight &mdash; QA preview</h1>
  <p class="lead">Now with a real embedded map in "Getting there", an expanded tickets section, wider icon-to-text spacing, and no book-direct link (agents keep the booking). Real Disneyland Paris content.</p>
  <div class="controls">
    <button id="b-light" class="on" type="button">Light</button>
    <button id="b-dark" type="button">Dark</button>
  </div>
  <div class="frame"><div id="host"></div></div>
</div>
<script>${widgetSrc}</script>
<script>
  const DATA = ${JSON.stringify(dlp)};
  const host = document.getElementById('host');
  let inst;
  function build(theme){ host.innerHTML=''; inst = new window.TGAttractionWidget(host, { attractionData: DATA, theme: theme }); }
  document.getElementById('b-light').addEventListener('click', function(){ this.classList.add('on'); document.getElementById('b-dark').classList.remove('on'); build('light'); });
  document.getElementById('b-dark').addEventListener('click', function(){ this.classList.add('on'); document.getElementById('b-light').classList.remove('on'); build('dark'); });
  build('light');
</script>
</body></html>`;

writeFileSync('/tmp/preview-attraction.html', page);
console.log('Wrote /tmp/preview-attraction.html (' + page.length + ' bytes)');
