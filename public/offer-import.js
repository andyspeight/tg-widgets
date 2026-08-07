/* ============================================================================
 * offer-import.js  ·  Travelgenix Widget Suite
 * Spreadsheet (CSV) import for special offers.
 *
 * Exposes window.TGOfferImport with:
 *   COLUMNS        — the column spec (header → offer field).
 *   templateCsv()  — a downloadable template (headers + one example row).
 *   parseCsv(text) — robust CSV → array of {header: value} row objects.
 *   rowsToOffers(rows) — maps rows to { offer, errors[], rowNumber }.
 *
 * Pure and dependency-free, so it can be unit-tested in isolation.
 * Array cells (Includes / Tags / Image URLs) are split on the pipe "|".
 * ========================================================================== */
(function () {
  'use strict';

  // header = the spreadsheet column label; key = the offer field;
  // kind: 'field' → offer.fields[key]; 'list' → offer[key] (array); 'currency';
  // 'id' → the internal offer id (used only to UPDATE an existing offer).
  // optional columns are not required for a file to count as "our template".
  const COLUMNS = [
    { header: 'Offer ID', key: '__id', kind: 'id', optional: true },
    { header: 'Title', key: 'title', kind: 'field', required: true },
    { header: 'Teaser', key: 'teaser', kind: 'field' },
    { header: 'Offer type', key: 'type', kind: 'field' },
    { header: 'Holiday style', key: 'style', kind: 'field' },
    { header: 'Country', key: 'country', kind: 'field' },
    { header: 'Region', key: 'region', kind: 'field' },
    { header: 'Resort', key: 'resort', kind: 'field' },
    { header: 'Property', key: 'property', kind: 'field' },
    { header: 'Star rating', key: 'stars', kind: 'field' },
    { header: 'Board', key: 'board', kind: 'field' },
    { header: 'Nights', key: 'nights', kind: 'field' },
    { header: 'Travel period', key: 'period', kind: 'field' },
    { header: 'Departure airport', key: 'origin', kind: 'field' },
    { header: 'Airline', key: 'airline', kind: 'field' },
    { header: 'Flights', key: 'flighttype', kind: 'field' },
    { header: 'Price', key: 'price', kind: 'field' },
    { header: 'Was price', key: 'was', kind: 'field' },
    { header: 'Price basis', key: 'basis', kind: 'field' },
    { header: 'Deposit', key: 'deposit', kind: 'field' },
    { header: 'Badge', key: 'badge', kind: 'field' },
    { header: 'Badge amount', key: 'badgeAmount', kind: 'field' },
    { header: 'Urgency', key: 'urgency', kind: 'field' },
    { header: 'Book by', key: 'bookby', kind: 'field' },
    { header: 'Availability', key: 'avail', kind: 'field' },
    { header: 'Show from', key: 'showFrom', kind: 'field' },
    { header: 'Show until', key: 'showUntil', kind: 'field' },
    { header: 'Reference', key: 'reference', kind: 'field' },
    { header: 'Protection', key: 'protection', kind: 'field' },
    { header: 'Map address', key: 'mapAddress', kind: 'field' },
    { header: 'Latitude', key: 'mapLat', kind: 'field' },
    { header: 'Longitude', key: 'mapLng', kind: 'field' },
    { header: 'Video URL', key: 'video', kind: 'field' },
    { header: 'Enquiry email', key: 'enquiryEmail', kind: 'field' },
    { header: 'Enquiry phone', key: 'enquiryPhone', kind: 'field' },
    { header: 'Description', key: 'description', kind: 'field' },
    { header: 'Hotel description', key: 'hotelDesc', kind: 'field', optional: true },
    { header: 'Resort description', key: 'resortDesc', kind: 'field', optional: true },
    { header: 'Country description', key: 'countryDesc', kind: 'field', optional: true },
    { header: 'Ship description', key: 'shipDesc', kind: 'field', optional: true },
    { header: 'Itinerary', key: 'itinerary', kind: 'field', optional: true },
    { header: 'Highlights', key: 'highlights', kind: 'field', optional: true },
    { header: 'Ski area', key: 'skiArea', kind: 'field', optional: true },
    { header: 'Currency', key: 'currency', kind: 'currency' },
    { header: 'Includes', key: 'includes', kind: 'list' },
    { header: 'Tags', key: 'tags', kind: 'list' },
    { header: 'Image URLs', key: 'images', kind: 'list' }
  ];

  const EXAMPLE = {
    'Title': '7 nights all inclusive in Cancun',
    'Teaser': 'Beachfront five star on the white sands of Costa Mujeres',
    'Offer type': 'Package holiday (flight + hotel)',
    'Holiday style': 'All inclusive',
    'Country': 'Mexico', 'Region': 'Riviera Maya', 'Resort': 'Costa Mujeres',
    'Property': 'Riu Palace Costa Mujeres', 'Star rating': '5 star', 'Board': 'All inclusive',
    'Nights': '7', 'Travel period': 'Sep 2026 to Apr 2027', 'Departure airport': 'London Gatwick',
    'Airline': 'TUI Airways', 'Flights': 'Direct', 'Price': '899', 'Was price': '1299',
    'Price basis': 'per person', 'Deposit': '60', 'Badge': 'Save', 'Badge amount': '400',
    'Urgency': 'Only 4 left at this price', 'Book by': '31 July 2026', 'Availability': 'Limited rooms',
    'Show from': '', 'Show until': '', 'Reference': 'TG-CUN-0926', 'Protection': 'Both',
    'Map address': 'Costa Mujeres, Cancun, Mexico', 'Latitude': '21.0419', 'Longitude': '-86.8126',
    'Video URL': 'https://www.youtube.com/watch?v=Scxs7L0vhZ4',
    'Enquiry email': 'sales@youragency.co.uk', 'Enquiry phone': '0161 123 4567',
    'Description': 'A warm paragraph about the resort and why this deal is worth booking.',
    'Currency': 'GBP',
    'Includes': 'Return flights | Airport transfers | All meals & drinks',
    'Tags': 'Family friendly | Beachfront | Kids stay free',
    'Image URLs': 'https://example.com/photo1.jpg | https://example.com/photo2.jpg'
  };

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function templateCsv() {
    const headers = COLUMNS.map(function (c) { return c.header; });
    const example = headers.map(function (h) { return csvCell(EXAMPLE[h] || ''); });
    return headers.map(csvCell).join(',') + '\r\n' + example.join(',') + '\r\n';
  }

  // Robust CSV parser: quoted fields, "" escapes, commas/newlines inside quotes,
  // CRLF or LF line endings. Returns an array of arrays (rows of cells).
  function parseRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const s = String(text || '').replace(/^﻿/, ''); // strip BOM
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); field = ''; rows.push(row); row = [];
      } else if (ch === '\r') {
        // swallow; the \n (if any) finishes the row
        if (s[i + 1] !== '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      } else {
        field += ch;
      }
    }
    // trailing field/row
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseCsv(text) {
    const rows = parseRows(text);
    if (!rows.length) return [];
    const headers = rows[0].map(function (h) { return String(h).trim(); });
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      // skip wholly-empty lines
      if (cells.every(function (c) { return String(c).trim() === ''; })) continue;
      const obj = {};
      for (let c = 0; c < headers.length; c++) obj[headers[c]] = cells[c] != null ? String(cells[c]) : '';
      out.push(obj);
    }
    return out;
  }

  // Map header-keyed rows to offers + per-row validation.
  function rowsToOffers(rows) {
    return (rows || []).map(function (row, i) {
      const offer = { currency: '', fields: {}, includes: [], tags: [], images: [] };
      const errors = [];
      COLUMNS.forEach(function (col) {
        let v = row[col.header];
        v = v == null ? '' : String(v).trim();
        // Offer ID marks a row that should UPDATE an existing offer rather than
        // create a new one. Left blank (the default in the template) → new offer.
        if (col.kind === 'id') { if (v) offer.id = v; return; }
        if (col.kind === 'currency') { if (v) offer.currency = v; return; }
        if (col.kind === 'list') {
          offer[col.key] = v ? v.split('|').map(function (x) { return x.trim(); }).filter(Boolean) : [];
          return;
        }
        if (v) offer.fields[col.key] = v;
      });
      if (!offer.fields.title) errors.push('Missing Title');
      if (offer.fields.price && !/[0-9]/.test(offer.fields.price)) errors.push('Price has no number');
      // tidy empty arrays
      if (!offer.includes.length) delete offer.includes;
      if (!offer.tags.length) delete offer.tags;
      if (!offer.images.length) delete offer.images;
      if (!offer.currency) delete offer.currency;
      return { rowNumber: i + 2, offer: offer, errors: errors }; // +2 = header + 1-based
    });
  }

  // Does an uploaded file look like our template? Every non-optional column
  // must be present in the header row. Extra columns are tolerated (ignored);
  // missing ones are reported so we can steer the client back to the template.
  function headerCheck(text) {
    const rows = parseRows(text);
    const have = (rows[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
    const missing = COLUMNS
      .filter(function (c) { return !c.optional && have.indexOf(c.header.toLowerCase()) === -1; })
      .map(function (c) { return c.header; });
    return { ok: have.length > 0 && missing.length === 0, missing: missing };
  }

  // Export saved offers (array of { id, offer }) back to a CSV in the SAME
  // template shape, with the Offer ID filled in. A client can download this,
  // edit it offline and re-upload to update those offers (matched on Offer ID)
  // instead of creating duplicates.
  function offersToCsv(offers) {
    const headers = COLUMNS.map(function (c) { return c.header; });
    const lines = [headers.map(csvCell).join(',')];
    (offers || []).forEach(function (rec) {
      const o = (rec && rec.offer) || {};
      const f = (o.fields && typeof o.fields === 'object') ? o.fields : {};
      const cells = COLUMNS.map(function (col) {
        if (col.kind === 'id') return csvCell((rec && rec.id) || '');
        if (col.kind === 'currency') return csvCell(o.currency || '');
        if (col.kind === 'list') return csvCell(Array.isArray(o[col.key]) ? o[col.key].join(' | ') : '');
        return csvCell(f[col.key] != null ? f[col.key] : '');
      });
      lines.push(cells.join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  if (typeof window !== 'undefined') {
    window.TGOfferImport = {
      COLUMNS: COLUMNS, templateCsv: templateCsv, parseCsv: parseCsv,
      rowsToOffers: rowsToOffers, headerCheck: headerCheck, offersToCsv: offersToCsv
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      COLUMNS: COLUMNS, templateCsv: templateCsv, parseCsv: parseCsv,
      rowsToOffers: rowsToOffers, headerCheck: headerCheck, offersToCsv: offersToCsv
    };
  }
})();
