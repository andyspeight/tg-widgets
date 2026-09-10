/**
 * Destination content coverage — the pure half.
 *
 * The field specs that define "complete" for each of the five tables, the
 * per-value checks that decide whether a field is genuinely usable, and the
 * aggregation that turns 1,539 scanned records into coverage figures and a
 * ranked queue of what to fix next.
 *
 * WHY IT IS SEPARATE. Nothing in here touches the network, Airtable, auth or
 * the environment. That keeps the judgement calls — how long a prose field has
 * to be before it stops being a stub, whether a Highlights JSON of "[]" counts
 * as content, how a country's gaps are weighted against a resort's — testable
 * on their own, without credentials or a running base. api/admin/destinations-
 * dashboard.js supplies the records and owns everything with a side effect.
 *
 * Tests: npm run test:destinations-coverage
 */

/* ------------------------------------------------------------------ *
 * Field specs — the definition of "complete" for each content type.
 * ------------------------------------------------------------------ */

const F = (id, label, kind, tier, group) => ({ id, label, kind, tier, group });

export const TYPES = [
  {
    key: 'country',
    label: 'Countries',
    singular: 'country',
    tableId: 'tblsxbqbyhTDoWhbo',
    nameField: 'flddJJrpwcXOwWIow',
    statusField: 'fldCpclokepeFkQZ2',
    groupByField: 'fldeVnkZXLiy8qCcl', // Continent
    childLinkField: 'fld1WRXSGcusXTjcN', // Cities and Regions
    fields: [
      F('fldeVnkZXLiy8qCcl', 'Continent', 'select', 'core', 'Identity'),
      F('fldDwZVR1C63K4HGT', 'URL Slug', 'text', 'core', 'Identity'),
      F('fldADwbC9R6R6jr35', 'Region', 'text', 'rich', 'Identity'),
      F('fldv3l23pOs8Yj3px', 'Hero Intro', 'prose', 'core', 'Editorial'),
      F('fldyyz5YdAhdFILdn', 'Overview', 'prose', 'core', 'Editorial'),
      F('fldjpYZsvAdMt1KlW', 'Tagline', 'text', 'core', 'Editorial'),
      F('fldwBjpooWzPoJ35H', 'Best Time to Visit', 'prose', 'rich', 'Editorial'),
      F('fldTwmug2ec2uxoIs', 'Top Things to Do', 'prose', 'rich', 'Editorial'),
      F('fldOuBi2V8DMhFTXF', 'Food and Drink', 'prose', 'rich', 'Editorial'),
      F('fldvarabAjjpOUKFG', 'Practical Info', 'prose', 'rich', 'Practical'),
      F('fld98IDBKf9mFpxoG', 'Getting There', 'prose', 'rich', 'Practical'),
      F('fldGPxNRuf9xao0He', 'Flight Time From UK', 'text', 'core', 'Practical'),
      F('fldOqkxbOYfxL1Qxt', 'Time Zone', 'text', 'core', 'Practical'),
      F('fldoe2LemU2kZS3EP', 'Currency', 'text', 'core', 'Practical'),
      F('fldypaRO1PZgwom22', 'Language', 'text', 'core', 'Practical'),
      F('fld5gv8Q7I0VrYib5', 'Voltage And Plug', 'text', 'rich', 'Practical'),
      F('flda8AY7qIO5BQJyI', 'Climate Temps', 'csv12', 'core', 'Climate'),
      F('fldJNzwIVJEHrHZZr', 'Climate Rainfall', 'csv12', 'rich', 'Climate'),
      F('fldqx5p1U0siNtvYy', 'Climate Season', 'csv12', 'core', 'Climate'),
      F('fldOFmB8E9rDvgQEZ', 'Highlights JSON', 'json', 'core', 'Structured'),
      F('fldylxHJYE7PtQ86s', 'Events JSON', 'json', 'rich', 'Structured'),
      F('fldC5ZvX1hitoxWY6', 'Best For Tags', 'multi', 'core', 'Structured'),
      F('fldJOZeflKobE2o9g', 'Price Band UK', 'select', 'rich', 'Trip planning'),
      F('fld3JLyT3MsMGWVT4', 'Booking Lead Time', 'select', 'rich', 'Trip planning'),
      F('flduOcMEuPq3cnVG5', 'Trip Duration Sweet Spot', 'multi', 'rich', 'Trip planning'),
      F('fldmKvRkDDRjj7PT2', 'Visa Status UK', 'select', 'rich', 'Trip planning'),
      F('fldecKeSnkZ6ABZfd', 'Visa Advisory', 'prose', 'rich', 'Trip planning'),
      F('fldOGSgbbH3BIoU6A', 'Health Notes UK', 'prose', 'rich', 'Trip planning'),
      F('fldlxsWrbmU6ELUPW', 'Latitude', 'lat', 'core', 'Geo'),
      F('fldz3whFdzKsZ66hg', 'Longitude', 'lng', 'core', 'Geo'),
      F('fldTqpNZX5n1219mh', 'Image URLs', 'lines3', 'core', 'Media'),
      F('fldVxxvianhuEj11t', 'Image Attribution', 'text', 'rich', 'Media'),
      F('fldMCiFq7ICmFgpjf', 'SEO Meta Title', 'text', 'core', 'SEO'),
      F('fld4oMfFdwuwWIjmG', 'SEO Meta Description', 'text', 'core', 'SEO'),
    ],
  },
  {
    key: 'city',
    label: 'Cities and Regions',
    singular: 'city or region',
    tableId: 'tblTkKujdVZgWPAQe',
    nameField: 'fld2VkY61c1JKUWKB',
    statusField: 'fld8GKaD5SPycD4Ld',
    parentLinkField: 'fldmJaOJZcMFtJNZD',
    childLinkField: 'fldKpmxTcy8qvg46C',
    fields: [
      F('fldmJaOJZcMFtJNZD', 'Country link', 'link', 'core', 'Identity'),
      F('fldL6MlFZgZMW25Vp', 'URL Slug', 'text', 'core', 'Identity'),
      F('fld1pD6llYo3Q8WlJ', 'Region', 'text', 'rich', 'Identity'),
      F('fldijlzHjf9BvhPJI', 'Hero Intro', 'prose', 'core', 'Editorial'),
      F('fldLhvqoaLAED69OU', 'Overview', 'prose', 'core', 'Editorial'),
      F('fldIu4zaqZZ7XUHZn', 'Tagline', 'text', 'core', 'Editorial'),
      F('fldsAUI3MY9WKYbeZ', 'What Makes It Special', 'prose', 'rich', 'Editorial'),
      F('fldDmqrLFyi2M3SNm', 'Best Time to Visit', 'prose', 'rich', 'Editorial'),
      F('fldtOOVnuRJyg7DqO', 'Top Things to Do', 'prose', 'rich', 'Editorial'),
      F('fldK2rPWmY6gyQeLb', 'Food and Drink', 'prose', 'rich', 'Editorial'),
      F('fldgQ1yrlJPCdASFk', 'Who Is It Best For', 'prose', 'rich', 'Editorial'),
      F('fldDppgzDttdnfmTZ', 'Getting There', 'prose', 'rich', 'Practical'),
      F('fldjhp4H3MHcjLQbG', 'Flight Time From UK', 'text', 'rich', 'Practical'),
      F('fldftMgM4Z3XQYNcf', 'Time Zone', 'text', 'rich', 'Practical'),
      F('fldyVpNjyezPfVeRM', 'Currency', 'text', 'rich', 'Practical'),
      F('fldFUbivACHoLzGkO', 'Language', 'text', 'rich', 'Practical'),
      F('fldebFrJI6MHeRJsZ', 'Voltage And Plug', 'text', 'rich', 'Practical'),
      F('fldxjOSYkYRPOZQgx', 'Climate Temps', 'csv12', 'core', 'Climate'),
      F('fldl296lX37f8stws', 'Climate Rainfall', 'csv12', 'rich', 'Climate'),
      F('fldHwvHjSwkpEgFa2', 'Climate Season', 'csv12', 'core', 'Climate'),
      F('fld1moM61DARrsBwr', 'Highlights JSON', 'json', 'core', 'Structured'),
      F('fldxze1iXQRrJ0UZW', 'Events JSON', 'json', 'rich', 'Structured'),
      F('fldZQTVNuqRXHileW', 'Best For Tags', 'multi', 'core', 'Structured'),
      F('fldPSVfkYVAIhtNDp', 'Trip Duration Sweet Spot', 'multi', 'rich', 'Trip planning'),
      F('fldLDQj6e1K4lq3tT', 'Lat', 'lat', 'core', 'Geo'),
      F('fld2pa6AKkU6dIq7O', 'Lng', 'lng', 'core', 'Geo'),
      F('fldt3898YIanGbfzc', 'Image URLs', 'lines3', 'core', 'Media'),
      F('fldzdo1vtYbAvpt0v', 'Image Attribution', 'text', 'rich', 'Media'),
      F('fldFhKUCfLONw0acp', 'SEO Meta Title', 'text', 'core', 'SEO'),
      F('fldhwA30pH8EfOMks', 'SEO Meta Description', 'text', 'core', 'SEO'),
    ],
  },
  {
    key: 'resort',
    label: 'Resorts and Areas',
    singular: 'resort or area',
    tableId: 'tblwV9gnbVEyZ99gI',
    nameField: 'fldnvOipaWpG3W1rx',
    statusField: 'fldTQcZWJ21MahuCF',
    parentLinkField: 'fldrUx3VrEMJPheIP',
    fields: [
      F('fldrUx3VrEMJPheIP', 'City/Region link', 'link', 'core', 'Identity'),
      F('fldwVxLg8V4CBi90B', 'URL Slug', 'text', 'core', 'Identity'),
      F('fldF9hitGwa75MYBa', 'Region', 'text', 'rich', 'Identity'),
      F('fld9NFRPv1MVRL4G9', 'Hero Intro', 'prose', 'core', 'Editorial'),
      F('fldrBplqTg6q2Kr0B', 'Overview', 'prose', 'core', 'Editorial'),
      F('fldwMqygnNpKvf9KO', 'Tagline', 'text', 'core', 'Editorial'),
      F('fldNOyr04aDvrtG3d', 'Character and Vibe', 'prose', 'rich', 'Editorial'),
      F('fldQz9jILNZRfNwiO', 'Best Time to Visit', 'prose', 'rich', 'Editorial'),
      F('fldcmrIHtByKtW4SM', 'Top Things to Do', 'prose', 'rich', 'Editorial'),
      F('fldZ57iIzJhoGPCg2', 'Beaches', 'prose', 'rich', 'Editorial'),
      F('fldoqi7dlgkaPKtZX', 'Food and Drink', 'prose', 'rich', 'Editorial'),
      F('fldw2O82s0EHzjDlY', 'Who Is It Best For', 'multi', 'core', 'Structured'),
      F('fldxwRsL9p1NvKoRz', 'Getting Around', 'prose', 'rich', 'Practical'),
      F('fld9tEZFMupU2GMn4', 'Nearby Excursions', 'prose', 'rich', 'Practical'),
      F('fldMlw191r1T3lFXe', 'Flight Time From UK', 'text', 'rich', 'Practical'),
      F('fldyV0RY9yxqDEJvR', 'Time Zone', 'text', 'rich', 'Practical'),
      F('fldGNJTsJWk7VnUWf', 'Currency', 'text', 'rich', 'Practical'),
      F('fldX1CJSFmL8NKu3w', 'Language', 'text', 'rich', 'Practical'),
      F('fldnjJpthgX61yp47', 'Voltage And Plug', 'text', 'rich', 'Practical'),
      F('fld7m7s8LXamDaKzP', 'Climate Temps', 'csv12', 'core', 'Climate'),
      F('fldCuW6FzzetUe0tV', 'Climate Rainfall', 'csv12', 'rich', 'Climate'),
      F('fld5RyPuxYdFFIFhb', 'Climate Season', 'csv12', 'core', 'Climate'),
      F('fldUyjDhtoA43hdHv', 'Highlights JSON', 'json', 'core', 'Structured'),
      F('fldWRl0d0z1MY6DMq', 'Events JSON', 'json', 'rich', 'Structured'),
      F('fldTmH3gT1wT48PLn', 'Best For Tags', 'multi', 'core', 'Structured'),
      F('flda4Fa7bBj6Nf850', 'Lat', 'lat', 'core', 'Geo'),
      F('fldpXXwrWplV7DiKN', 'Lng', 'lng', 'core', 'Geo'),
      F('fldBMns5p5ChZCriU', 'Image URLs', 'lines3', 'core', 'Media'),
      F('fldMn6hYB1o5OwJpN', 'Image Attribution', 'text', 'rich', 'Media'),
      F('fldg0iscgZqn3hjGm', 'SEO Meta Title', 'text', 'core', 'SEO'),
      F('fldM8ZBdWj8yib7xn', 'SEO Meta Description', 'text', 'core', 'SEO'),
    ],
  },
  {
    key: 'airport',
    label: 'Airports',
    singular: 'airport',
    tableId: 'tblI2iVAbIGCtsGa7',
    nameField: 'fldlT6eApAdQHGYED',
    statusField: 'fldjvujj14Q9QNLLq',
    groupByField: 'fldjARk52dZi7TGGc', // Country Text
    verifiedField: 'fldRCo83Wz1AFZXwP',
    fields: [
      F('fldcS9uu4NWMVaIVP', 'IATA Code', 'iata', 'core', 'Identity'),
      F('fldgrJ2uFjzPcAxUx', 'City Served', 'text', 'core', 'Identity'),
      F('fldjARk52dZi7TGGc', 'Country Text', 'text', 'core', 'Identity'),
      F('fldUSTC6kdgXNgKfI', 'Airport Role', 'select', 'core', 'Identity'),
      F('fldZNl5eveKEDN2Xu', 'Airport Type', 'select', 'rich', 'Identity'),
      F('fldXZKuycZOgJScSj', 'Latitude', 'lat', 'core', 'Geo'),
      F('fldRG7pc5iPJPzhEI', 'Longitude', 'lng', 'core', 'Geo'),
      F('fldmRELkLWrUGL5Ss', 'Overview', 'prose', 'core', 'Editorial'),
      F('fldxsl1xMOzqVZ73f', 'Tagline', 'text', 'rich', 'Editorial'),
      F('fldoJm0H4vTRLuJlL', 'Terminals & Airlines', 'prose', 'core', 'Editorial'),
      F('fldrf2gm0skVmW7bX', 'Useful Tips', 'prose', 'rich', 'Editorial'),
      F('flda3DUGpxz2m54Lx', 'Quirks & Local Tips', 'prose', 'rich', 'Editorial'),
      F('fldk6vN66c33umyEP', 'Distance & Drive Time', 'prose', 'core', 'Getting there'),
      F('fldRVYMNcYeBJJ4vC', 'Getting There By Car', 'prose', 'rich', 'Getting there'),
      F('fld9lb4Zzp40PsVmq', 'Getting There By Train', 'prose', 'rich', 'Getting there'),
      F('fldv9urpL8JP6PmCw', 'Getting There By Coach', 'prose', 'rich', 'Getting there'),
      F('flduHqBj7hcAvIVjs', 'Taxi & Rideshare', 'prose', 'rich', 'Getting there'),
      F('fldKSgegnHPllWRIJ', 'Drop-off & Pick-up', 'prose', 'rich', 'Getting there'),
      F('fldoKcDvovYdGvxqy', 'Parking', 'prose', 'core', 'Facilities'),
      F('fldkq66823wiLYMoK', 'Lounges', 'prose', 'rich', 'Facilities'),
      F('fldhYDGrBJC6DL9og', 'Eating & Shopping', 'prose', 'rich', 'Facilities'),
      F('fldVzj8DMHrKbeSzO', 'Family Facilities', 'prose', 'rich', 'Facilities'),
      F('fld2FqwMdLj3UYVbv', 'Special Assistance', 'prose', 'rich', 'Facilities'),
      F('fld2deWhxd3PA1KHw', 'Airport Hotels', 'prose', 'rich', 'Facilities'),
      F('fldIPVLmhkvQR39Dz', 'Recommended Arrival Time', 'prose', 'rich', 'Facilities'),
      F('fld4wWA0oIapvQjUX', 'Hero Image URL', 'url', 'rich', 'Media'),
      F('fldkrScmky7HhnD0r', 'Official Website', 'url', 'core', 'Evidence'),
      F('fldEVfcn75Tm0u0Es', 'Source 1 URL', 'url', 'core', 'Evidence'),
      F('flds3csPG5slNZgKX', 'Source 2 URL', 'url', 'core', 'Evidence'),
      F('fldRCo83Wz1AFZXwP', 'Verified Date', 'date', 'core', 'Evidence'),
    ],
  },
  {
    key: 'attraction',
    label: 'Theme Parks and Attractions',
    singular: 'attraction',
    tableId: 'tblhVDUdpwaLabDmQ',
    nameField: 'fldboK0kstNohXgqJ',
    statusField: 'fldSMqzRfIwIcodgS',
    groupByField: 'fldlx9YGIZQ797rem', // Country
    verifiedField: 'fld3srQgBZZYtx1LJ',
    fields: [
      F('fld1UMHOpugpUm865', 'Attraction Type', 'select', 'core', 'Identity'),
      F('flduUYklGYPVCvvfV', 'Operator', 'select', 'rich', 'Identity'),
      F('fldlx9YGIZQ797rem', 'Country', 'text', 'core', 'Identity'),
      F('fldyoIhTvHu2NI3gn', 'Location', 'text', 'core', 'Identity'),
      F('fldxmLHlNM0GYndlb', 'Latitude', 'lat', 'core', 'Geo'),
      F('fldywVEVFPKDZgXWn', 'Longitude', 'lng', 'core', 'Geo'),
      F('fldipL05iT6Kxryfb', 'Overview', 'prose', 'core', 'Editorial'),
      F('fldYpnpQzBV01Ogoa', 'Tagline', 'text', 'rich', 'Editorial'),
      F('fldojtl6BCSVGJka0', 'Star Attractions', 'prose', 'core', 'Editorial'),
      F('fldRexuVXFyEpaL98', 'Quirks and Insider Tips', 'prose', 'rich', 'Editorial'),
      F('fldILi6fGKRzinp6C', 'Combine With', 'prose', 'rich', 'Editorial'),
      F('fld2RxBaZGkt9yfa8', 'Best For', 'multi', 'core', 'Structured'),
      F('flds4rCmkrt4FXl5j', 'Days Needed', 'text', 'rich', 'Structured'),
      F('fldcffvJT5D2DhJwT', 'Price Band', 'select', 'rich', 'Structured'),
      F('fldejcSph2rPnJ2ej', 'Best Time to Visit', 'prose', 'core', 'Planning'),
      F('fldRuLLokqPdNmxbt', 'Season', 'text', 'core', 'Planning'),
      F('fldwwrUwBGkooii5u', 'Tickets and Prices', 'prose', 'core', 'Planning'),
      F('fldcmxidk5kxxlxRp', 'Fast Track Options', 'prose', 'rich', 'Planning'),
      F('fldVMTZELNw8wwbkq', 'Family Guide', 'prose', 'rich', 'Audience'),
      F('fldo2JQvEqn8mCQJP', 'Thrill Guide', 'prose', 'rich', 'Audience'),
      F('fldU4NklSGLsnYSwT', 'Height Restrictions', 'prose', 'rich', 'Audience'),
      F('fldZuI9uYNODxYxYa', 'Accessibility', 'prose', 'rich', 'Audience'),
      F('fldOM08zdOuuOpjBX', 'Nearest Airport', 'prose', 'core', 'Getting there'),
      F('flddRZy9LxxqDyLFK', 'Getting There', 'prose', 'rich', 'Getting there'),
      F('fldyh0d8etOmfwGIE', 'Nearest Town/City', 'prose', 'rich', 'Getting there'),
      F('fld70c4zqzC6pYEEB', 'On-Site Hotels', 'prose', 'rich', 'Stay and eat'),
      F('fldwHd6iPpoZpc1rz', 'Nearby Hotels', 'prose', 'rich', 'Stay and eat'),
      F('fldI9TGApt1G5re4T', 'Food and Drink', 'prose', 'rich', 'Stay and eat'),
      F('fldl1WwjVPaEExo5i', 'Tour Operators', 'prose', 'rich', 'Trade'),
      F('fldaYcpCsTaJO5tqe', 'Official Website', 'url', 'core', 'Evidence'),
      F('fldeAkzpOCWR1bMpp', 'Source 1 URL', 'url', 'core', 'Evidence'),
      F('fldEeqE4sunewCTvy', 'Source 2 URL', 'url', 'core', 'Evidence'),
      F('fld3srQgBZZYtx1LJ', 'Verified Date', 'date', 'core', 'Evidence'),
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Value checking — is this field genuinely usable?
 * ------------------------------------------------------------------ */

export const PROSE_MIN_CHARS = 40; // below this a prose field is a stub, not content

export function selName(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v.name != null ? String(v.name) : '';
  return v == null ? '' : String(v);
}

function twelveNumbers(raw) {
  const parts = String(raw).split(',').map(s => s.trim()).filter(s => s !== '');
  if (parts.length !== 12) return false;
  return parts.every(p => Number.isFinite(Number(p)));
}

function twelveTokens(raw) {
  const parts = String(raw).split(',').map(s => s.trim().toLowerCase()).filter(s => s !== '');
  if (parts.length !== 12) return false;
  return parts.every(p => p === 'best' || p === 'shoulder' || p === 'off');
}

/**
 * Returns 'filled' | 'empty' | 'invalid'.
 * 'invalid' means something is there but it cannot be used — a malformed JSON
 * array, eleven months of temperatures, a coordinate out of range. Those are
 * worth separating from blanks because they need a correction, not authoring.
 */
export function checkValue(value, kind) {
  const isBlank = value == null
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
  if (isBlank) return 'empty';

  switch (kind) {
    case 'text':
      return selName(value).trim() ? 'filled' : 'empty';

    case 'prose': {
      const s = selName(value).trim();
      if (!s) return 'empty';
      return s.length >= PROSE_MIN_CHARS ? 'filled' : 'invalid';
    }

    case 'select':
      return selName(value).trim() ? 'filled' : 'empty';

    case 'multi':
    case 'link':
      return Array.isArray(value) && value.length > 0 ? 'filled' : 'empty';

    case 'json': {
      const s = selName(value).trim();
      if (!s) return 'empty';
      try {
        const parsed = JSON.parse(s);
        return Array.isArray(parsed) && parsed.length > 0 ? 'filled' : 'invalid';
      } catch {
        return 'invalid';
      }
    }

    case 'csv12': {
      const s = selName(value).trim();
      if (!s) return 'empty';
      return (twelveNumbers(s) || twelveTokens(s)) ? 'filled' : 'invalid';
    }

    case 'lines3': {
      const lines = selName(value).split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return 'empty';
      const allUrls = lines.every(l => /^https?:\/\//i.test(l));
      return (lines.length >= 3 && allUrls) ? 'filled' : 'invalid';
    }

    case 'url': {
      const s = selName(value).trim();
      if (!s) return 'empty';
      return /^https?:\/\//i.test(s) ? 'filled' : 'invalid';
    }

    case 'date': {
      const s = selName(value).trim();
      if (!s) return 'empty';
      return Number.isFinite(new Date(s).getTime()) ? 'filled' : 'invalid';
    }

    case 'iata': {
      const s = selName(value).trim();
      if (!s) return 'empty';
      return /^[A-Z]{3}$/.test(s) ? 'filled' : 'invalid';
    }

    case 'lat':
    case 'lng': {
      const n = Number(value);
      if (!Number.isFinite(n)) return 'invalid';
      const limit = kind === 'lat' ? 90 : 180;
      if (n < -limit || n > limit) return 'invalid';
      return n === 0 ? 'invalid' : 'filled'; // 0,0 is null island, never a real place here
    }

    default:
      return selName(value).trim() ? 'filled' : 'empty';
  }
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

export function scoreRecord(rec, spec) {
  let coreTotal = 0, coreFilled = 0, richTotal = 0, richFilled = 0;
  const missing = [];   // field indices that are empty
  const broken = [];    // field indices that hold something unusable
  const states = [];    // per-field state, reused for the fill-rate tally

  spec.fields.forEach((f, idx) => {
    const state = checkValue(rec.fields[f.id], f.kind);
    states.push(state);
    const isCore = f.tier === 'core';
    if (isCore) coreTotal++; else richTotal++;
    if (state === 'filled') {
      if (isCore) coreFilled++; else richFilled++;
    } else if (state === 'invalid') {
      broken.push(idx);
    } else {
      missing.push(idx);
    }
  });

  // Core is worth double: a record with every core field and no depth is
  // publishable; one with rich depth and no slug is not.
  const weighted = (coreFilled * 2 + richFilled) / ((coreTotal * 2 + richTotal) || 1);
  const score = Math.round(weighted * 100);

  let tier;
  if (coreFilled === coreTotal && broken.length === 0) tier = richFilled === richTotal ? 'complete' : 'ready';
  else if (coreFilled + richFilled <= 2) tier = 'skeleton';
  else tier = 'partial';

  return { score, tier, coreTotal, coreFilled, richTotal, richFilled, missing, broken, states };
}

function emptyTally() { return { complete: 0, ready: 0, partial: 0, skeleton: 0 }; }

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

/**
 * Every field id this type needs read from Airtable — the scored fields plus
 * the ones used for naming, grouping and walking the hierarchy.
 */
export function fieldIdsFor(spec) {
  const wanted = new Set(spec.fields.map(f => f.id));
  wanted.add(spec.nameField);
  if (spec.statusField) wanted.add(spec.statusField);
  if (spec.groupByField) wanted.add(spec.groupByField);
  if (spec.parentLinkField) wanted.add(spec.parentLinkField);
  if (spec.childLinkField) wanted.add(spec.childLinkField);
  return [...wanted];
}

/**
 * Turn scanned tables into the dashboard read model.
 * @param {Array<{spec: object, rows: Array<{id,createdTime,fields}>}>} scanned
 */
export function aggregate(scanned) {

  // Record id -> display name, so a child can name its parent.
  const nameById = new Map();
  for (const { spec, rows } of scanned) {
    for (const r of rows) nameById.set(r.id, selName(r.fields[spec.nameField]).trim() || '(unnamed)');
  }

  const types = [];
  const records = [];
  const now = Date.now();

  for (const { spec, rows } of scanned) {
    const tally = emptyTally();
    const statusTally = {};
    const fieldStats = spec.fields.map(f => ({
      label: f.label, group: f.group, tier: f.tier, kind: f.kind,
      filled: 0, empty: 0, invalid: 0,
    }));
    let scoreSum = 0;
    let verifiedCount = 0;
    let staleCount = 0;

    for (const rec of rows) {
      const s = scoreRecord(rec, spec);
      tally[s.tier]++;
      scoreSum += s.score;

      s.states.forEach((state, idx) => { fieldStats[idx][state]++; });

      const status = selName(rec.fields[spec.statusField]).trim() || 'No status';
      statusTally[status] = (statusTally[status] || 0) + 1;

      let verifiedAgeDays = null;
      if (spec.verifiedField) {
        const raw = selName(rec.fields[spec.verifiedField]).trim();
        const t = raw ? new Date(raw).getTime() : NaN;
        if (Number.isFinite(t)) {
          verifiedCount++;
          verifiedAgeDays = Math.floor((now - t) / 86400000);
          if (verifiedAgeDays > 180) staleCount++;
        }
      }

      const parentId = Array.isArray(rec.fields[spec.parentLinkField]) ? rec.fields[spec.parentLinkField][0] : null;
      const childIds = Array.isArray(rec.fields[spec.childLinkField]) ? rec.fields[spec.childLinkField] : [];

      records.push({
        id: rec.id,
        type: spec.key,
        name: nameById.get(rec.id) || '(unnamed)',
        parentId: parentId || null,
        parent: parentId ? (nameById.get(parentId) || null) : null,
        group: selName(rec.fields[spec.groupByField]).trim() || null,
        status,
        score: s.score,
        tier: s.tier,
        core: [s.coreFilled, s.coreTotal],
        rich: [s.richFilled, s.richTotal],
        missing: s.missing,
        broken: s.broken,
        children: childIds.length,
        created: rec.createdTime,
        verifiedAgeDays,
      });
    }

    types.push({
      key: spec.key,
      label: spec.label,
      singular: spec.singular,
      tableId: spec.tableId,
      count: rows.length,
      avgScore: rows.length ? Math.round(scoreSum / rows.length) : 0,
      tiers: tally,
      statuses: statusTally,
      fields: fieldStats,
      hasEvidence: !!spec.verifiedField,
      verified: verifiedCount,
      stale: staleCount,
    });
  }

  // A country carries the resorts beneath it, so its gaps cost more. Reach is
  // how many records hang off this one, counted by record id rather than by
  // name — two different countries can both hold a "Riviera".
  const byId = new Map(records.map(r => [r.id, r]));
  const childCount = new Map();
  for (const r of records) {
    if (r.parentId) childCount.set(r.parentId, (childCount.get(r.parentId) || 0) + 1);
  }
  const TYPE_WEIGHT = { country: 3, city: 2, resort: 1, airport: 1.5, attraction: 1 };

  for (const r of records) {
    const reach = 1 + (childCount.get(r.id) || 0) + (r.children || 0);
    const shortfall = (100 - r.score) / 100;
    const brokenPenalty = r.broken.length * 4; // a wrong value is worse than a blank one
    r.reach = reach;
    r.priority = Math.round(shortfall * 100 * (TYPE_WEIGHT[r.type] || 1) * Math.log2(reach + 1) + brokenPenalty);
  }

  records.sort((a, b) => b.priority - a.priority);

  const totals = {
    records: records.length,
    complete: records.filter(r => r.tier === 'complete').length,
    ready: records.filter(r => r.tier === 'ready').length,
    partial: records.filter(r => r.tier === 'partial').length,
    skeleton: records.filter(r => r.tier === 'skeleton').length,
    broken: records.filter(r => r.broken.length > 0).length,
    avgScore: records.length ? Math.round(records.reduce((s, r) => s + r.score, 0) / records.length) : 0,
    fieldsFilled: types.reduce((s, t) => s + t.fields.reduce((a, f) => a + f.filled, 0), 0),
    fieldsTotal: types.reduce((s, t) => s + t.fields.length * t.count, 0),
  };

  // Coverage by continent. A resort's continent sits two links up (resort ->
  // city -> country), so walk the parent chain by id rather than reading the
  // immediate parent's name, which only ever worked one level deep.
  function continentFor(rec) {
    let node = rec;
    for (let hop = 0; node && hop < 4; hop++) {
      if (node.type === 'country') return node.group || null;
      node = node.parentId ? byId.get(node.parentId) : null;
    }
    return null;
  }

  const continents = new Map();
  for (const r of records) {
    // Airports and attractions carry a country name, not a link, so they are
    // reported by country in their own tables rather than forced onto this axis.
    const c = (r.type === 'airport' || r.type === 'attraction') ? null : continentFor(r);
    if (!c) continue;
    if (!continents.has(c)) continents.set(c, { name: c, count: 0, scoreSum: 0, byType: {} });
    const row = continents.get(c);
    row.count++;
    row.scoreSum += r.score;
    row.byType[r.type] = (row.byType[r.type] || 0) + 1;
  }
  const continentRows = [...continents.values()]
    .map(c => ({ name: c.name, count: c.count, avgScore: Math.round(c.scoreSum / c.count), byType: c.byType }))
    .sort((a, b) => b.count - a.count);

  const recent = [...records]
    .sort((a, b) => new Date(b.created) - new Date(a.created))
    .slice(0, 12)
    .map(r => ({ name: r.name, type: r.type, created: r.created, tier: r.tier, score: r.score }));

  return {
    generatedAt: new Date().toISOString(),
    totals,
    types,
    continents: continentRows,
    records,
    recent,
  };
}
