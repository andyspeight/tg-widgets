/**
 * Quote PDF — the Location card shows the travel month's weather (8 Sep 2026).
 *
 * Just Sardinia's Dubai in June quote: the online quote page shows "Average
 * weather in June" with 36°C / 96°F, a 38°C / 101°F maximum, 12 hours of sun
 * and 0 in of rain. The PDF showed none of it. The field names monthOfTravel
 * and weatherAverages were right; the card then read high/temp inside each
 * month's entry, keys Travelify never sends, so every month printed blank and
 * June was never picked out.
 *
 * The month entries below are the real shape, confirmed on that live quote
 * through /api/admin/quote-shape. Drives the REAL renderer.
 *
 * Run: node test/quote-location-weather-smoke.mjs   (npm run test:quote-location-weather)
 */
import { readFileSync } from 'node:fs';
import { renderQuoteHTML } from '../render-quote.js';

const SRC = readFileSync(new URL('../render-quote.js', import.meta.url), 'utf8');
let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } };

// Twelve real entries, as Travelify sends them (values from the live quote).
const M = (month, monthName, avgtempC, avgtempF, avgmaxtempC, avgmaxtempF, rainMM, rainIn, sun) =>
  ({ month, monthName, avgtempF, avgtempC, avgmaxtempF, avgmaxtempC, avgdailyrainfallMM: rainMM, avgdailyrainfallInches: rainIn, avgdrydays: 27, avgraindays: 3, avgsnowdays: 0, avguvindex: 7, avgsunhour: sun });
const WEATHER = [
  M(1, 'January', 22, 71, 23, 74, 0.49, 0.02, 11.8), M(2, 'February', 23, 73, 25, 76, 0.25, 0.01, 11.9),
  M(3, 'March', 25, 78, 27, 81, 0.49, 0.02, 11.8), M(4, 'April', 29, 85, 31, 88, 0.25, 0.01, 11.9),
  M(5, 'May', 33, 92, 36, 96, 0.03, 0, 12), M(6, 'June', 36, 96, 38, 101, 0, 0, 12),
  M(7, 'July', 37, 99, 39, 103, 0.02, 0, 12), M(8, 'August', 37, 98, 39, 103, 0.07, 0, 12),
  M(9, 'September', 35, 95, 38, 100, 0.01, 0, 12), M(10, 'October', 32, 89, 35, 94, 0.01, 0, 12),
  M(11, 'November', 27, 81, 30, 86, 0.28, 0.01, 12), M(12, 'December', 24, 75, 26, 78, 0.27, 0.01, 11.9),
];
const location = (extra) => Object.assign({
  type: 'locations', locationName: 'Dubai, United Arab Emirates',
  overview: 'Welcome to Dubai.', overviewHtml: 'Welcome to Dubai.', sellingAngle: '', sellingAngleHtml: '', visaNotes: '', visaNotesHtml: '',
  localCurrency: 'AED', monthOfTravel: 6, imageName: '', imageSize: '', imagePreview: '', weatherAverages: WEATHER,
}, extra || {});
const doc = (loc) => ({ data: { id: 8375, quoteDocument: {
  setup: { quoteTitle: 'Dubai in June', adults: 2, children: 0, tripDestination: 'Dubai', tripDates: '' },
  items: [{ type: 'hotels', hotelName: 'Atlantis The Palm', city: 'Dubai', starRating: 5, checkIn: '2027-06-10', checkOut: '2027-06-17', nights: 7, price: 4200, currency: 'GBP', images: [] }, loc],
  total: 4200,
} } });
const render = (loc) => renderQuoteHTML(doc(loc), {});

console.log('The travel month is picked out and shown like the online page');
{
  const html = render(location());
  ok('a block headed "Average weather in June"', html.includes('Average weather in June'));
  ok('average temperature 36°C / 96°F', html.includes('36&deg;C / 96&deg;F'));
  ok('average max temperature 38°C / 101°F', html.includes('38&deg;C / 101&deg;F'));
  ok('hours of sun 12', /Average hours of sun<\/div><div class="lwm-value">12</.test(html));
  ok('rainfall 0 in', /Average rainfall<\/div><div class="lwm-value">0 in</.test(html));
  ok('the year strip is not shown as well', !html.includes('class="loc-weather"'));
  ok('the meta line still says the travel month', html.includes('Travelling in <strong>June</strong>'));
  ok('the destination name and currency are there', html.includes('Dubai, United Arab Emirates') && html.includes('Local currency: <strong>AED</strong>'));
}

console.log('\nWithout a travel month the year is shown, with real highs');
{
  const html = render(location({ monthOfTravel: undefined }));
  ok('the twelve-month strip renders', html.includes('class="loc-weather"') && (html.match(/class="loc-weather-cell"/g) || []).length === 12);
  ok('each cell carries the daytime high', html.includes('>Jun</div><div class="lw-temp">38&deg;</div>') && html.includes('>Jan</div><div class="lw-temp">23&deg;</div>'));
  ok('no blank temperatures, the bug that was reported', !/lw-temp"><\/div>/.test(html));
  ok('no month block without a month', !html.includes('Average weather in'));
}
{
  const html = render(location({ monthOfTravel: 13 }));
  ok('a month outside 1 to 12 falls back to the strip', html.includes('class="loc-weather"') && !html.includes('Average weather in'));
}

console.log('\nRobust to thinner or older data');
{
  const html = render(location({ weatherAverages: [{ month: 6, avgsunhour: 12 }] }));
  ok('an entry with only hours of sun still shows that fact', html.includes('Average weather in June') && /lwm-value">12</.test(html) && !html.includes('Average temperature'));
  const html2 = render(location({ weatherAverages: [{ month: 6, avgtempC: '', avgsunhour: 'lots' }] }));
  ok('an entry with nothing usable falls back to the strip rather than an empty block', !html2.includes('Average weather in June'));
  const html3 = render(location({ monthOfTravel: 6, weatherAverages: [{ month: 6, high: 38 }, { month: 7, temp: 39 }] }));
  ok('the older high/temp names still render in the strip', html3.includes('>Jun</div><div class="lw-temp">38&deg;</div>') && html3.includes('>Jul</div><div class="lw-temp">39&deg;</div>'));
  const html4 = render(location({ weatherAverages: [{ month: 6, avgdailyrainfallMM: 0.49 }] }));
  ok('rainfall falls back to millimetres when inches are missing', /Average rainfall<\/div><div class="lwm-value">0\.49 mm</.test(html4));
  const html5 = render(location({ weatherAverages: null }));
  ok('no weather at all renders no weather block and does not throw', !html5.includes('class="loc-weather') && !html5.includes('Average weather in'));
  const html6 = render(location({ locationName: 'Dubai <b>x</b>', weatherAverages: [{ month: 6, avgsunhour: '<i>12</i>' }] }));
  ok('names and values are escaped', html6.includes('Dubai &lt;b&gt;x&lt;/b&gt;') && !html6.includes('<i>12</i>'));
}

console.log('\nSource guards');
{
  ok('the catalogue now records the confirmed locations shape', /locations\s+locationName, overview\/overviewHtml/.test(SRC) && /avgmaxtempC, avgmaxtempF/.test(SRC));
  ok('the month block is styled', /\.loc-weather-month\{display:grid/.test(SRC) && /\.lwm-value\{/.test(SRC));
  ok('the card no longer reads only high/temp', !/w\.high != null \|\| w\.temp != null/.test(SRC));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
