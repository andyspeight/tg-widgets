/* ============================================================================
 * widget-offer-page.js  ·  Travelgenix Widget Suite
 * Special Offer Page — the cinematic landing page for a hand-built offer (v0.1.0)
 *
 * The page a visitor lands on after clicking an offer card. Renders the full
 * offer object the Special Offer Builder emits into a premium, conversion-led
 * page with a built-in enquiry form. Layout + capture only at this stage: the
 * enquiry form validates and fires a `tg-offer-enquiry` event (no backend yet).
 *
 * WOW, all CSP-clean and dependency-free:
 *   - full-bleed hero with a slow Ken Burns zoom and layered gradient
 *   - glass sticky booking bar that slides in once the hero scrolls away
 *   - quick-facts tiles overlapping the hero
 *   - reveal-on-scroll sections (IntersectionObserver)
 *   - photo gallery with a keyboard-navigable lightbox
 *   - live "book by" countdown
 *   - sticky enquiry card with inline validation and success state
 *   - honours prefers-reduced-motion
 *
 * Embed:
 *   <div data-tg-widget="offer-page" data-tg-id="YOUR_WIDGET_ID"></div>
 * or inline:
 *   <div data-tg-widget="offer-page" data-tg-config='{"offer":{...}}'></div>
 *
 * Offer shape = the builder output ({fields, includes, tags, currency}); flat
 * objects accepted. Gallery images come from offer.images[] (array), with
 * offer.fields.image as the hero fallback.
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '0.1.2';

  // Resolve the API base off THIS script's origin. The widget is hosted on
  // widgets.travelify.io and embedded on customer sites, so a relative
  // '/api/...' resolves to the customer origin and 404s (blank render).
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget-offer-page\.js(\?|$|#)/.test(s)) return new URL(s).origin + '/api/widget-config';
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }
  const API_BASE = resolveApiBase();

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (section headings, fact/detail labels, CTA copy,
  // booking-bar and form chrome, countdown and success states, aria-labels).
  // The offer's own data — title, teaser, description, place and hotel names,
  // prices, dates — is author content and is never translated. ATOL/ABTA
  // protection wording is left in English on purpose. English is the source +
  // fallback.
  const MESSAGES = {
    en: {
      defaultTitle: 'Your next great escape',
      save: 'Save', youSave: 'You save', from: 'From', poa: 'POA',
      perPerson: 'per person', basedOnLead: 'based on the lead price',
      deposit: 'Secure it today with a {amount} deposit',
      duration: 'Duration', nights: 'nights', board: 'Board', flights: 'Flights',
      travel: 'Travel', hotel: 'Hotel', star: 'star',
      resort: 'Resort', destination: 'Destination', departsFrom: 'Departs from',
      airline: 'Airline', boardBasis: 'Board basis', travelPeriod: 'Travel period',
      bookByLabel: 'Book by', offerReference: 'Offer reference',
      aboutHoliday: 'About this holiday', whatsIncluded: "What's included",
      photos: 'Photos', takeALook: 'Take a look', whereYoullBe: "Where you'll be",
      theDetail: 'The detail',
      enquireNow: 'Enquire now', enquireAbout: 'Enquire about this offer',
      sendEnquiry: 'Send my enquiry',
      fullName: 'Full name', addName: 'Please add your name',
      email: 'Email', validEmail: 'Valid email please', phone: 'Phone',
      preferredMonth: 'Preferred month',
      travellers: 'Travellers', traveller1: '1 traveller', travellers2: '2 travellers',
      adultsChildren: '2 adults + children', travellers3plus: '3+ travellers',
      messagePlaceholder: 'Anything else we should know? (dates, room type, questions)',
      trustLine: 'No payment taken now. A travel expert replies within one working hour.',
      readyWhenYouAre: 'Ready when you are',
      ctaCopy: 'Talk to a travel expert and we will hold this price while you decide.',
      likeTheLook: 'Like the look of it?',
      enqBandCopy: 'Send us a quick enquiry and a travel expert will be in touch within one working hour. No payment now.',
      offerRef: 'Offer ref', poweredBy: 'Powered by Travelgenix',
      bookByPrefix: 'Book by', endsToday: 'Offer ends today',
      endsIn: 'Offer ends in {days}d {hours}h {mins}m',
      enquirySent: 'Enquiry sent',
      thanksName: 'Thanks {name}. A travel expert will be in touch within one working hour.',
      openPhoto: 'Open photo {n}', video: 'Video'
    },
    fr: {
      defaultTitle: 'Votre prochaine escapade',
      save: 'Économisez', youSave: 'Vous économisez', from: 'À partir de', poa: 'Sur demande',
      perPerson: 'par personne', basedOnLead: 'sur la base du prix de départ',
      deposit: 'Réservez aujourd’hui avec un acompte de {amount}',
      duration: 'Durée', nights: 'nuits', board: 'Pension', flights: 'Vols',
      travel: 'Voyage', hotel: 'Hôtel', star: 'étoiles',
      resort: 'Station', destination: 'Destination', departsFrom: 'Départ de',
      airline: 'Compagnie aérienne', boardBasis: 'Type de pension', travelPeriod: 'Période de voyage',
      bookByLabel: 'Réserver avant le', offerReference: 'Référence de l’offre',
      aboutHoliday: 'À propos de ce séjour', whatsIncluded: 'Ce qui est inclus',
      photos: 'Photos', takeALook: 'Jetez un œil', whereYoullBe: 'Où vous serez',
      theDetail: 'Les détails',
      enquireNow: 'Faire une demande', enquireAbout: 'Renseignez-vous sur cette offre',
      sendEnquiry: 'Envoyer ma demande',
      fullName: 'Nom complet', addName: 'Veuillez indiquer votre nom',
      email: 'E-mail', validEmail: 'Veuillez saisir un e-mail valide', phone: 'Téléphone',
      preferredMonth: 'Mois souhaité',
      travellers: 'Voyageurs', traveller1: '1 voyageur', travellers2: '2 voyageurs',
      adultsChildren: '2 adultes + enfants', travellers3plus: '3 voyageurs ou plus',
      messagePlaceholder: 'Autre chose à nous signaler ? (dates, type de chambre, questions)',
      trustLine: 'Aucun paiement maintenant. Un expert voyages vous répond sous une heure ouvrée.',
      readyWhenYouAre: 'Prêt quand vous l’êtes',
      ctaCopy: 'Parlez à un expert voyages et nous bloquerons ce prix le temps de votre décision.',
      likeTheLook: 'Cela vous plaît ?',
      enqBandCopy: 'Envoyez-nous une demande rapide et un expert voyages vous contactera sous une heure ouvrée. Aucun paiement maintenant.',
      offerRef: 'Réf. offre', poweredBy: 'Propulsé par Travelgenix',
      bookByPrefix: 'Réserver avant le', endsToday: 'L’offre se termine aujourd’hui',
      endsIn: 'L’offre se termine dans {days}j {hours}h {mins}min',
      enquirySent: 'Demande envoyée',
      thanksName: 'Merci {name}. Un expert voyages vous contactera sous une heure ouvrée.',
      openPhoto: 'Ouvrir la photo {n}', video: 'Vidéo'
    },
    de: {
      defaultTitle: 'Ihre nächste Auszeit',
      save: 'Sparen', youSave: 'Sie sparen', from: 'Ab', poa: 'Auf Anfrage',
      perPerson: 'pro Person', basedOnLead: 'auf Basis des Startpreises',
      deposit: 'Sichern Sie es heute mit einer Anzahlung von {amount}',
      duration: 'Dauer', nights: 'Nächte', board: 'Verpflegung', flights: 'Flüge',
      travel: 'Reise', hotel: 'Hotel', star: 'Sterne',
      resort: 'Ferienort', destination: 'Reiseziel', departsFrom: 'Abflug ab',
      airline: 'Fluggesellschaft', boardBasis: 'Verpflegung', travelPeriod: 'Reisezeitraum',
      bookByLabel: 'Buchen bis', offerReference: 'Angebotsreferenz',
      aboutHoliday: 'Über diesen Urlaub', whatsIncluded: 'Was ist inbegriffen',
      photos: 'Fotos', takeALook: 'Werfen Sie einen Blick', whereYoullBe: 'Wo Sie sein werden',
      theDetail: 'Die Details',
      enquireNow: 'Jetzt anfragen', enquireAbout: 'Zu diesem Angebot anfragen',
      sendEnquiry: 'Anfrage senden',
      fullName: 'Vollständiger Name', addName: 'Bitte geben Sie Ihren Namen an',
      email: 'E-Mail', validEmail: 'Bitte gültige E-Mail angeben', phone: 'Telefon',
      preferredMonth: 'Wunschmonat',
      travellers: 'Reisende', traveller1: '1 Reisender', travellers2: '2 Reisende',
      adultsChildren: '2 Erwachsene + Kinder', travellers3plus: '3+ Reisende',
      messagePlaceholder: 'Sonst noch etwas, das wir wissen sollten? (Daten, Zimmertyp, Fragen)',
      trustLine: 'Jetzt keine Zahlung. Ein Reiseexperte antwortet innerhalb einer Arbeitsstunde.',
      readyWhenYouAre: 'Bereit, wenn Sie es sind',
      ctaCopy: 'Sprechen Sie mit einem Reiseexperten und wir halten diesen Preis, während Sie entscheiden.',
      likeTheLook: 'Gefällt es Ihnen?',
      enqBandCopy: 'Senden Sie uns eine kurze Anfrage und ein Reiseexperte meldet sich innerhalb einer Arbeitsstunde. Jetzt keine Zahlung.',
      offerRef: 'Angebotsref.', poweredBy: 'Bereitgestellt von Travelgenix',
      bookByPrefix: 'Buchen bis', endsToday: 'Das Angebot endet heute',
      endsIn: 'Das Angebot endet in {days}T {hours}Std {mins}Min',
      enquirySent: 'Anfrage gesendet',
      thanksName: 'Danke {name}. Ein Reiseexperte meldet sich innerhalb einer Arbeitsstunde.',
      openPhoto: 'Foto {n} öffnen', video: 'Video'
    },
    es: {
      defaultTitle: 'Tu próxima escapada',
      save: 'Ahorra', youSave: 'Ahorras', from: 'Desde', poa: 'A consultar',
      perPerson: 'por persona', basedOnLead: 'según el precio de salida',
      deposit: 'Resérvalo hoy con un depósito de {amount}',
      duration: 'Duración', nights: 'noches', board: 'Régimen', flights: 'Vuelos',
      travel: 'Viaje', hotel: 'Hotel', star: 'estrellas',
      resort: 'Complejo', destination: 'Destino', departsFrom: 'Sale de',
      airline: 'Aerolínea', boardBasis: 'Régimen', travelPeriod: 'Periodo de viaje',
      bookByLabel: 'Reserva antes del', offerReference: 'Referencia de la oferta',
      aboutHoliday: 'Sobre estas vacaciones', whatsIncluded: 'Qué incluye',
      photos: 'Fotos', takeALook: 'Echa un vistazo', whereYoullBe: 'Dónde estarás',
      theDetail: 'Los detalles',
      enquireNow: 'Consultar ahora', enquireAbout: 'Consulta sobre esta oferta',
      sendEnquiry: 'Enviar mi consulta',
      fullName: 'Nombre completo', addName: 'Indica tu nombre, por favor',
      email: 'Correo electrónico', validEmail: 'Introduce un correo válido', phone: 'Teléfono',
      preferredMonth: 'Mes preferido',
      travellers: 'Viajeros', traveller1: '1 viajero', travellers2: '2 viajeros',
      adultsChildren: '2 adultos + niños', travellers3plus: '3 o más viajeros',
      messagePlaceholder: '¿Algo más que debamos saber? (fechas, tipo de habitación, preguntas)',
      trustLine: 'Ningún pago ahora. Un experto en viajes responde en una hora laborable.',
      readyWhenYouAre: 'Cuando quieras',
      ctaCopy: 'Habla con un experto en viajes y mantendremos este precio mientras decides.',
      likeTheLook: '¿Te gusta lo que ves?',
      enqBandCopy: 'Envíanos una consulta rápida y un experto en viajes te contactará en una hora laborable. Sin pago ahora.',
      offerRef: 'Ref. oferta', poweredBy: 'Con tecnología de Travelgenix',
      bookByPrefix: 'Reserva antes del', endsToday: 'La oferta termina hoy',
      endsIn: 'La oferta termina en {days}d {hours}h {mins}min',
      enquirySent: 'Consulta enviada',
      thanksName: 'Gracias {name}. Un experto en viajes te contactará en una hora laborable.',
      openPhoto: 'Abrir foto {n}', video: 'Vídeo'
    },
    it: {
      defaultTitle: 'La tua prossima fuga',
      save: 'Risparmia', youSave: 'Risparmi', from: 'Da', poa: 'Su richiesta',
      perPerson: 'a persona', basedOnLead: 'in base al prezzo di partenza',
      deposit: 'Bloccala oggi con un acconto di {amount}',
      duration: 'Durata', nights: 'notti', board: 'Trattamento', flights: 'Voli',
      travel: 'Viaggio', hotel: 'Hotel', star: 'stelle',
      resort: 'Località', destination: 'Destinazione', departsFrom: 'Partenza da',
      airline: 'Compagnia aerea', boardBasis: 'Trattamento', travelPeriod: 'Periodo di viaggio',
      bookByLabel: 'Prenota entro il', offerReference: 'Riferimento offerta',
      aboutHoliday: 'Su questa vacanza', whatsIncluded: 'Cosa è incluso',
      photos: 'Foto', takeALook: 'Dai un’occhiata', whereYoullBe: 'Dove sarai',
      theDetail: 'I dettagli',
      enquireNow: 'Richiedi ora', enquireAbout: 'Richiedi informazioni su questa offerta',
      sendEnquiry: 'Invia la mia richiesta',
      fullName: 'Nome completo', addName: 'Inserisci il tuo nome',
      email: 'E-mail', validEmail: 'Inserisci un’e-mail valida', phone: 'Telefono',
      preferredMonth: 'Mese preferito',
      travellers: 'Viaggiatori', traveller1: '1 viaggiatore', travellers2: '2 viaggiatori',
      adultsChildren: '2 adulti + bambini', travellers3plus: '3 o più viaggiatori',
      messagePlaceholder: 'Altro che dovremmo sapere? (date, tipo di camera, domande)',
      trustLine: 'Nessun pagamento ora. Un esperto di viaggi risponde entro un’ora lavorativa.',
      readyWhenYouAre: 'Quando vuoi',
      ctaCopy: 'Parla con un esperto di viaggi e bloccheremo questo prezzo mentre decidi.',
      likeTheLook: 'Ti piace?',
      enqBandCopy: 'Inviaci una richiesta veloce e un esperto di viaggi ti contatterà entro un’ora lavorativa. Nessun pagamento ora.',
      offerRef: 'Rif. offerta', poweredBy: 'Realizzato con Travelgenix',
      bookByPrefix: 'Prenota entro il', endsToday: 'L’offerta termina oggi',
      endsIn: 'L’offerta termina tra {days}g {hours}h {mins}min',
      enquirySent: 'Richiesta inviata',
      thanksName: 'Grazie {name}. Un esperto di viaggi ti contatterà entro un’ora lavorativa.',
      openPhoto: 'Apri foto {n}', video: 'Video'
    },
    ro: {
      defaultTitle: 'Următoarea ta evadare',
      save: 'Economisește', youSave: 'Economisești', from: 'De la', poa: 'La cerere',
      perPerson: 'de persoană', basedOnLead: 'pe baza prețului de pornire',
      deposit: 'Rezervă astăzi cu un avans de {amount}',
      duration: 'Durată', nights: 'nopți', board: 'Masă', flights: 'Zboruri',
      travel: 'Călătorie', hotel: 'Hotel', star: 'stele',
      resort: 'Stațiune', destination: 'Destinație', departsFrom: 'Pleacă din',
      airline: 'Companie aeriană', boardBasis: 'Tip de masă', travelPeriod: 'Perioada de călătorie',
      bookByLabel: 'Rezervă până la', offerReference: 'Referință ofertă',
      aboutHoliday: 'Despre acest sejur', whatsIncluded: 'Ce este inclus',
      photos: 'Fotografii', takeALook: 'Aruncă o privire', whereYoullBe: 'Unde vei fi',
      theDetail: 'Detaliile',
      enquireNow: 'Solicită acum', enquireAbout: 'Întreabă despre această ofertă',
      sendEnquiry: 'Trimite solicitarea mea',
      fullName: 'Nume complet', addName: 'Te rugăm să adaugi numele tău',
      email: 'E-mail', validEmail: 'Introdu un e-mail valid', phone: 'Telefon',
      preferredMonth: 'Luna preferată',
      travellers: 'Călători', traveller1: '1 călător', travellers2: '2 călători',
      adultsChildren: '2 adulți + copii', travellers3plus: '3+ călători',
      messagePlaceholder: 'Altceva ce ar trebui să știm? (date, tip de cameră, întrebări)',
      trustLine: 'Nicio plată acum. Un expert în călătorii răspunde în maximum o oră lucrătoare.',
      readyWhenYouAre: 'Când ești pregătit',
      ctaCopy: 'Vorbește cu un expert în călătorii și vom păstra acest preț cât timp te decizi.',
      likeTheLook: 'Îți place?',
      enqBandCopy: 'Trimite-ne o solicitare rapidă și un expert în călătorii te va contacta în maximum o oră lucrătoare. Nicio plată acum.',
      offerRef: 'Ref. ofertă', poweredBy: 'Susținut de Travelgenix',
      bookByPrefix: 'Rezervă până la', endsToday: 'Oferta se încheie astăzi',
      endsIn: 'Oferta se încheie în {days}z {hours}h {mins}min',
      enquirySent: 'Solicitare trimisă',
      thanksName: 'Mulțumim {name}. Un expert în călătorii te va contacta în maximum o oră lucrătoare.',
      openPhoto: 'Deschide fotografia {n}', video: 'Video'
    }
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline
  // resolver keeps the widget self-contained.
  function makeT(cfg) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    const supported = Object.keys(MESSAGES);
    const baseOf = (r) => (r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : '');
    let cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    let lang = 'en';
    for (let i = 0; i < cands.length; i++) { const b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    const dict = MESSAGES[lang] || MESSAGES.en;
    const t = (k, vars) => {
      let s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k);
      if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? vars[n] : m));
      return s;
    };
    t.lang = lang; t.dir = 'ltr';
    return t;
  }

  // Base URL this script was served from, so we can load sibling widgets
  // (widget-maps.js) from the same origin whether on tg-widgets or a client site.
  const SCRIPT_BASE = (function () {
    try {
      const s = document.currentScript && document.currentScript.src;
      if (s) return s.replace(/[^/]+$/, '');
    } catch (e) {}
    return '/';
  })();

  // Reuse the suite's map widget (Leaflet + MapTiler). Loaded on demand, once.
  let _mapsPromise = null;
  function ensureMaps() {
    if (typeof window !== 'undefined' && window.TGMapsWidget) return Promise.resolve();
    if (_mapsPromise) return _mapsPromise;
    _mapsPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = SCRIPT_BASE + 'widget-maps.js';
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('maps-load-failed')); };
      document.head.appendChild(s);
    });
    return _mapsPromise;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function currencySymbol(code) {
    return { GBP: '£', EUR: '€', USD: '$', AUD: '$', CAD: '$' }[code] || '£';
  }
  function num(val) {
    if (val == null || val === '') return 0;
    const n = Number(String(val).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function money(sym, val) {
    const n = num(val);
    if (!n) return '';
    return sym + n.toLocaleString('en-GB');
  }
  function parseStars(s) {
    const m = String(s || '').match(/\d/);
    return m ? Math.min(5, parseInt(m[0], 10)) : 0;
  }
  function shortType(t) {
    if (!t) return '';
    return String(t).split('(')[0].split('/')[0].replace(/\s+only$/i, '').trim();
  }
  function safeUrl(u) {
    if (!u) return '';
    const s = String(u).trim();
    if (/^(https?:)?\/\//i.test(s) || s.startsWith('/') || s.startsWith('#')) return s;
    return '';
  }
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

  // Parse a video URL into something embeddable (YouTube, Vimeo or a direct file).
  function parseVideo(url) {
    if (!url) return null;
    const u = String(url).trim();
    let m;
    if ((m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([\w-]{6,})/i))) return { type: 'youtube', id: m[1] };
    if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i))) return { type: 'vimeo', id: m[1] };
    if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(u) && safeUrl(u)) return { type: 'file', url: safeUrl(u) };
    return null;
  }
  function videoEmbed(v) {
    if (!v) return '';
    if (v.type === 'youtube') return '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(v.id) + '?rel=0" title="Video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>';
    if (v.type === 'vimeo') return '<iframe src="https://player.vimeo.com/video/' + esc(v.id) + '" title="Video" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    if (v.type === 'file') return '<video controls preload="metadata" src="' + esc(v.url) + '"></video>';
    return '';
  }
  function fnum(v) {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
  }

  // Scheduling window — see widget-offer-card.js for the matching logic. The
  // page still renders outside the window but shows a status banner.
  function parseDay(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const t = Date.parse(s);
    if (!isFinite(t)) return null;
    const dt = new Date(t);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  }
  function offerWindow(fromStr, untilStr) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const from = parseDay(fromStr), until = parseDay(untilStr);
    if (from !== null && today < from) return { live: false, state: 'upcoming', from: from, until: until };
    if (until !== null && today > until) return { live: false, state: 'ended', from: from, until: until };
    return { live: true, state: 'live', from: from, until: until };
  }

  // Small inline icon set (stroke icons, currentColor)
  const I = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    plate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18"/><path d="M12 3a8 8 0 0 0-8 8 8 8 0 0 0 16 0 8 8 0 0 0-8-8z"/></svg>',
    plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5a2.12 2.12 0 0 0-3-3L13 8 4.8 6.2a1 1 0 0 0-.9.3l-.5.5a1 1 0 0 0 .1 1.5L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 4.2 5.4a1 1 0 0 0 1.5.1l.5-.5a1 1 0 0 0 .3-.9z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    hotel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9v.01M9 12v.01M9 15v.01"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  // ── Styles ───────────────────────────────────────────────────────────────
  const STYLES = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .tgop {
      --tgo-brand: #1B2B5B; --tgo-accent: #00B4D8; --tgo-accent-hover: #0096B7;
      --tgo-ink: #0F172A; --tgo-sub: #475569; --tgo-muted: #94A3B8;
      --tgo-bg: #FFFFFF; --tgo-surface: #FFFFFF; --tgo-alt: #F7F9FB; --tgo-border: #E8EDF3;
      --tgo-success: #10B981; --tgo-success-soft: #D1FAE5; --tgo-warn: #E8893A;
      --tgo-strike: #94A3B8; --tgo-gold: #FFB703; --tgo-radius: 18px;
      --tgo-shadow: 0 1px 2px rgba(15,23,42,0.05);
      --tgo-shadow-md: 0 10px 30px rgba(15,23,42,0.10);
      --tgo-shadow-lg: 0 30px 70px rgba(15,23,42,0.20);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--tgo-ink); line-height: 1.6; background: var(--tgo-bg);
      -webkit-font-smoothing: antialiased; display: block;
    }
    .tgop[data-theme="dark"] {
      --tgo-ink: #F1F5F9; --tgo-sub: #B6C2D4; --tgo-muted: #7C8AA0;
      --tgo-bg: #0B1220; --tgo-surface: #111B2E; --tgo-alt: #0E1626; --tgo-border: #243043;
      --tgo-success-soft: rgba(16,185,129,0.16);
      --tgo-shadow-md: 0 10px 30px rgba(0,0,0,0.5); --tgo-shadow-lg: 0 30px 70px rgba(0,0,0,0.6);
    }
    a { color: inherit; }
    .tgop-wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px; }

    /* ── Sticky booking bar ── */
    .tgop-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 60;
      background: color-mix(in srgb, var(--tgo-surface) 82%, transparent);
      backdrop-filter: saturate(180%) blur(14px); -webkit-backdrop-filter: saturate(180%) blur(14px);
      border-bottom: 1px solid var(--tgo-border);
      transform: translateY(-105%); transition: transform 0.35s cubic-bezier(.2,.8,.2,1);
      box-shadow: var(--tgo-shadow);
    }
    .tgop-bar.show { transform: translateY(0); }
    .tgop-bar-inner { max-width: 1180px; margin: 0 auto; padding: 10px 24px; display: flex; align-items: center; gap: 16px; }
    .tgop-bar-title { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tgop-bar-spacer { flex: 1; }
    .tgop-bar-price { font-weight: 800; font-size: 18px; white-space: nowrap; }
    .tgop-bar-price small { font-weight: 500; font-size: 12px; color: var(--tgo-sub); }

    /* ── Hero ── */
    .tgop-hero { position: relative; height: min(88vh, 760px); min-height: 520px; overflow: hidden; }
    .tgop-hero-img {
      position: absolute; inset: -4%; background-size: cover; background-position: center;
      animation: tgop-kenburns 26s ease-in-out infinite alternate; will-change: transform;
    }
    .tgop-hero-img.ph { background: linear-gradient(135deg, var(--tgo-brand), var(--tgo-accent)); animation: none; }
    @keyframes tgop-kenburns { from { transform: scale(1); } to { transform: scale(1.12); } }
    .tgop-hero::after {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(7,12,24,0.30) 0%, rgba(7,12,24,0.05) 32%, rgba(7,12,24,0.20) 60%, rgba(7,12,24,0.86) 100%);
    }
    .tgop-hero-inner {
      position: absolute; inset: 0; z-index: 2; max-width: 1180px; margin: 0 auto; padding: 0 24px 120px;
      display: flex; flex-direction: column; justify-content: flex-end; color: #fff;
    }
    .tgop-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .tgop-badge {
      font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px;
      padding: 6px 13px; border-radius: 999px; color: #fff; display: inline-flex; align-items: center; gap: 6px;
    }
    .tgop-badge svg { width: 13px; height: 13px; }
    .tgop-badge.save { background: linear-gradient(120deg, #F97316, #E8893A); box-shadow: 0 6px 18px rgba(232,137,58,0.45); }
    .tgop-badge.glass { background: rgba(255,255,255,0.16); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.25); }
    .tgop-eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: rgba(255,255,255,0.85); margin-bottom: 8px; }
    .tgop-h1 {
      font-size: clamp(34px, 5.4vw, 60px); font-weight: 800; line-height: 1.04; letter-spacing: -1px;
      margin: 0 0 14px; max-width: 16ch; text-shadow: 0 2px 30px rgba(0,0,0,0.35);
    }
    .tgop-hero-meta { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; font-size: 16px; }
    .tgop-hero-loc { display: inline-flex; align-items: center; gap: 7px; }
    .tgop-hero-loc svg { width: 17px; height: 17px; opacity: 0.9; }
    .tgop-hero-stars { color: var(--tgo-gold); letter-spacing: 2px; font-size: 17px; }
    .tgop-scroll-cue {
      position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%); z-index: 3;
      color: rgba(255,255,255,0.8); animation: tgop-bob 2s ease-in-out infinite;
    }
    .tgop-scroll-cue svg { width: 26px; height: 26px; }
    @keyframes tgop-bob { 0%,100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, 7px); } }

    /* ── Quick facts (overlap the hero) ── */
    .tgop-facts-wrap { position: relative; z-index: 5; margin-top: -64px; }
    .tgop-facts {
      background: var(--tgo-surface); border: 1px solid var(--tgo-border); border-radius: var(--tgo-radius);
      box-shadow: var(--tgo-shadow-lg); padding: 8px;
      display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;
    }
    .tgop-fact { text-align: center; padding: 16px 10px; border-radius: 12px; transition: background 0.15s ease; }
    .tgop-fact:hover { background: var(--tgo-alt); }
    .tgop-fact-ic { width: 26px; height: 26px; margin: 0 auto 8px; color: var(--tgo-accent); }
    .tgop-fact-ic svg { width: 100%; height: 100%; }
    .tgop-fact-lab { font-size: 10px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--tgo-muted); font-weight: 700; }
    .tgop-fact-val { font-size: 15px; font-weight: 700; margin-top: 3px; }

    /* ── Body grid ── */
    .tgop-body { display: grid; grid-template-columns: 1fr 380px; gap: 44px; align-items: start; padding: 52px 0 70px; }
    .tgop-main { min-width: 0; }
    .tgop-section { margin-bottom: 46px; }
    .tgop-h2 { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin: 0 0 16px; }
    .tgop-prose p { font-size: 16.5px; color: var(--tgo-sub); line-height: 1.8; margin: 0 0 14px; }

    .tgop-incl { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 20px; }
    .tgop-incl li { display: flex; align-items: center; gap: 12px; font-size: 15.5px; font-weight: 500; }
    .tgop-incl .tick {
      flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: var(--tgo-success-soft);
      color: var(--tgo-success); display: flex; align-items: center; justify-content: center;
    }
    .tgop-incl .tick svg { width: 14px; height: 14px; }

    /* Gallery */
    .tgop-gallery { display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 150px; gap: 10px; }
    .tgop-gallery .g {
      border-radius: 14px; background-size: cover; background-position: center; cursor: pointer;
      position: relative; overflow: hidden; transition: transform 0.3s ease; border: 0; padding: 0;
    }
    .tgop-gallery .g:hover { transform: scale(1.02); }
    .tgop-gallery .g:first-child { grid-column: span 2; grid-row: span 2; }
    .tgop-gallery .g::after { content: ''; position: absolute; inset: 0; background: rgba(15,23,42,0); transition: background 0.2s ease; }
    .tgop-gallery .g:hover::after { background: rgba(15,23,42,0.12); }

    /* Detail table */
    .tgop-table { width: 100%; border-collapse: collapse; font-size: 15px; }
    .tgop-table td { padding: 13px 0; border-bottom: 1px solid var(--tgo-border); }
    .tgop-table td:first-child { color: var(--tgo-muted); font-weight: 600; width: 40%; }
    .tgop-table td:last-child { font-weight: 600; }

    /* Tag chips */
    .tgop-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
    .tgop-tag { font-size: 12px; font-weight: 600; background: var(--tgo-alt); border: 1px solid var(--tgo-border); color: var(--tgo-sub); padding: 6px 12px; border-radius: 999px; }

    /* ── Booking / enquiry card ── */
    .tgop-aside { position: sticky; top: 84px; }
    .tgop-book {
      background: var(--tgo-surface); border: 1px solid var(--tgo-border); border-radius: var(--tgo-radius);
      box-shadow: var(--tgo-shadow-md); overflow: hidden;
    }
    .tgop-book-top { padding: 22px 24px 20px; border-bottom: 1px solid var(--tgo-border); }
    .tgop-book-from { font-size: 12px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--tgo-muted); font-weight: 700; }
    .tgop-price-row { display: flex; align-items: baseline; gap: 10px; margin: 4px 0 2px; }
    .tgop-price { font-size: 42px; font-weight: 800; letter-spacing: -1px; line-height: 1; }
    .tgop-was { font-size: 17px; color: var(--tgo-strike); text-decoration: line-through; }
    .tgop-save { display: inline-block; margin-top: 8px; background: var(--tgo-success-soft); color: var(--tgo-success); font-weight: 800; font-size: 13px; padding: 5px 12px; border-radius: 999px; }
    .tgop-basis { font-size: 13.5px; color: var(--tgo-sub); margin-top: 10px; }
    .tgop-deposit { margin-top: 14px; font-size: 13.5px; color: var(--tgo-ink); background: color-mix(in srgb, var(--tgo-accent) 10%, transparent); border: 1px solid color-mix(in srgb, var(--tgo-accent) 22%, transparent); border-radius: 12px; padding: 11px 14px; display: flex; gap: 9px; align-items: center; }
    .tgop-deposit svg { width: 17px; height: 17px; color: var(--tgo-accent); flex-shrink: 0; }
    .tgop-countdown { margin-top: 12px; text-align: center; font-size: 13px; color: var(--tgo-warn); font-weight: 700; }
    .tgop-countdown b { font-variant-numeric: tabular-nums; }

    .tgop-form { padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 11px; }
    .tgop-form-h { font-weight: 800; font-size: 17px; }
    .tgop-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
    .tgop-field { display: flex; flex-direction: column; gap: 5px; }
    .tgop-input {
      width: 100%; padding: 11px 13px; border: 1px solid var(--tgo-border); border-radius: 11px;
      font: inherit; font-size: 14.5px; background: var(--tgo-bg); color: var(--tgo-ink); transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .tgop-input:focus { outline: none; border-color: var(--tgo-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgo-accent) 18%, transparent); }
    textarea.tgop-input { resize: vertical; min-height: 72px; }
    .tgop-field.bad .tgop-input { border-color: #DC2626; }
    .tgop-field-err { font-size: 11px; color: #DC2626; font-weight: 600; display: none; }
    .tgop-field.bad .tgop-field-err { display: block; }
    .tgop-submit {
      margin-top: 4px; border: 0; border-radius: 12px; padding: 15px; cursor: pointer; font: inherit;
      font-weight: 800; font-size: 15.5px; color: #fff;
      background: linear-gradient(120deg, var(--tgo-accent), var(--tgo-brand));
      background-size: 160% 100%; transition: background-position 0.4s ease, transform 0.1s ease;
      box-shadow: 0 10px 24px color-mix(in srgb, var(--tgo-accent) 35%, transparent);
    }
    .tgop-submit:hover { background-position: 100% 0; }
    .tgop-submit:active { transform: translateY(1px); }
    .tgop-trust { font-size: 11.5px; color: var(--tgo-muted); text-align: center; margin-top: 4px; line-height: 1.6; }
    .tgop-trust b { color: var(--tgo-sub); }
    .tgop-enq-success { padding: 36px 24px; text-align: center; }
    .tgop-enq-success .tick { width: 60px; height: 60px; border-radius: 50%; background: var(--tgo-success-soft); color: var(--tgo-success); display: flex; align-items: center; justify-content: center; margin: 0 auto 14px; }
    .tgop-enq-success .tick svg { width: 28px; height: 28px; }
    .tgop-enq-success h4 { margin: 0 0 6px; font-size: 18px; font-weight: 800; }
    .tgop-enq-success p { margin: 0; color: var(--tgo-sub); font-size: 14px; }

    /* ── Final CTA band ── */
    .tgop-cta-band { background: linear-gradient(120deg, var(--tgo-brand), color-mix(in srgb, var(--tgo-brand) 60%, var(--tgo-accent))); color: #fff; }
    .tgop-cta-inner { max-width: 1180px; margin: 0 auto; padding: 48px 24px; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
    .tgop-cta-inner h3 { font-size: 26px; font-weight: 800; margin: 0 0 4px; }
    .tgop-cta-inner p { margin: 0; color: rgba(255,255,255,0.85); }
    .tgop-cta-spacer { flex: 1; }
    .tgop-btn {
      display: inline-flex; align-items: center; gap: 9px; border: 0; border-radius: 12px; cursor: pointer;
      font: inherit; font-weight: 800; font-size: 15px; padding: 14px 24px; text-decoration: none; white-space: nowrap;
    }
    .tgop-btn.primary { background: #fff; color: var(--tgo-brand); }
    .tgop-btn.primary svg { width: 17px; height: 17px; }
    .tgop-btn.ghost { background: rgba(255,255,255,0.14); color: #fff; border: 1px solid rgba(255,255,255,0.3); }
    .tgop-btn.sm { padding: 9px 16px; font-size: 14px; }
    .tgop-btn.accent { background: var(--tgo-accent); color: #fff; }
    .tgop-btn.accent:hover { background: var(--tgo-accent-hover); }

    /* Footer trust */
    .tgop-foot { background: var(--tgo-alt); border-top: 1px solid var(--tgo-border); }
    .tgop-foot-inner { max-width: 1180px; margin: 0 auto; padding: 26px 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--tgo-muted); }
    .tgop-foot-inner svg { width: 16px; height: 16px; color: var(--tgo-success); }
    .tgop-foot-trust { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--tgo-sub); }

    /* ── Lightbox ── */
    .tgop-lb { position: fixed; inset: 0; z-index: 90; background: rgba(7,12,24,0.94); display: none; align-items: center; justify-content: center; }
    .tgop-lb.open { display: flex; }
    .tgop-lb-img { max-width: 92vw; max-height: 86vh; border-radius: 10px; box-shadow: 0 30px 80px rgba(0,0,0,0.6); }
    .tgop-lb-btn { position: absolute; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); color: #fff; width: 48px; height: 48px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .tgop-lb-btn svg { width: 22px; height: 22px; }
    .tgop-lb-btn.close { top: 22px; right: 22px; }
    .tgop-lb-btn.prev { left: 18px; top: 50%; transform: translateY(-50%); }
    .tgop-lb-btn.next { right: 18px; top: 50%; transform: translateY(-50%); }

    /* ── Video ── */
    .tgop-video { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 16px; overflow: hidden; background: #000; box-shadow: var(--tgo-shadow-md); }
    .tgop-video iframe, .tgop-video video { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; object-fit: cover; }

    /* ── Map ── */
    .tgop-map-addr { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--tgo-sub); margin: 0 0 14px; }
    .tgop-map-addr svg { width: 16px; height: 16px; color: var(--tgo-accent); }
    .tgop-map { width: 100%; border-radius: 16px; overflow: hidden; box-shadow: var(--tgo-shadow-md); min-height: 120px; }
    .tgop-map.tgop-map-failed { display: none; }

    /* ── Split hero (immersive template) ── */
    .tgop-hero--split { display: grid; grid-template-columns: 1.05fr 1fr; height: min(82vh, 680px); min-height: 500px; }
    .tgop-hero--split::after { display: none; }
    .tgop-hsplit-img { position: relative; inset: auto; background-size: cover; background-position: center; animation: none; }
    .tgop-hsplit-img.ph { background: linear-gradient(135deg, var(--tgo-brand), var(--tgo-accent)); }
    .tgop-hsplit-panel { background: var(--tgo-surface); display: flex; align-items: center; padding: 0 clamp(28px, 5vw, 72px); }
    .tgop-hsplit-inner { max-width: 460px; }
    .tgop-eyebrow.alt { color: var(--tgo-accent); }
    .tgop-h1.alt { color: var(--tgo-ink); text-shadow: none; font-size: clamp(30px, 3.6vw, 46px); }
    .tgop-hero-meta.alt { color: var(--tgo-sub); }
    .tgop-hsplit-panel .tgop-hero-loc { color: var(--tgo-sub); }
    .tgop-hsplit-panel .tgop-hero-loc svg { color: var(--tgo-muted); }
    .tgop-hsplit-teaser { font-size: 16px; color: var(--tgo-sub); line-height: 1.7; margin: 16px 0 0; }
    .tgop-hsplit-buy { display: flex; align-items: center; gap: 18px; margin-top: 26px; flex-wrap: wrap; }
    .tgop-hsplit-price { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
    .tgop-hsplit-price span { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--tgo-muted); display: block; }
    .tgop-hsplit-price small { font-size: 13px; font-weight: 500; color: var(--tgo-sub); }
    .tgop-badge.glass.light { background: var(--tgo-alt); border: 1px solid var(--tgo-border); color: var(--tgo-sub); }
    @media (max-width: 820px) {
      .tgop-hero--split { grid-template-columns: 1fr; height: auto; min-height: 0; }
      .tgop-hsplit-img { min-height: 300px; }
      .tgop-hsplit-panel { padding: 32px 24px 38px; }
      .tgop-hsplit-inner { max-width: none; }
    }

    /* ── Editorial template ── */
    .tgop-editorial { max-width: 780px; padding-top: 52px; padding-bottom: 10px; }
    .tgop[data-template="editorial"] .tgop-h2 { font-size: 30px; }
    .tgop[data-template="editorial"] .tgop-prose p { font-size: 18px; line-height: 1.85; }
    .tgop[data-template="editorial"] .tgop-section { margin-bottom: 52px; }
    .tgop-enqband { background: var(--tgo-alt); border-top: 1px solid var(--tgo-border); border-bottom: 1px solid var(--tgo-border); }
    .tgop-enqband-inner { display: grid; grid-template-columns: 1fr 420px; gap: 44px; align-items: center; padding-top: 56px; padding-bottom: 56px; }
    .tgop-enqband-copy h2 { margin: 0 0 10px; }
    .tgop-enqband-copy p { font-size: 17px; color: var(--tgo-sub); margin: 0; max-width: 42ch; }
    .tgop-enqband-card .tgop-aside, .tgop-enqband-card { position: static; }
    @media (max-width: 820px) {
      .tgop-enqband-inner { grid-template-columns: 1fr; gap: 24px; }
    }

    /* Reveal on scroll — gated by [data-anim] so content is visible if JS or
       IntersectionObserver is unavailable (progressive enhancement). */
    .tgop[data-anim="1"] .tgop-reveal { opacity: 0; transform: translateY(26px); transition: opacity 0.7s cubic-bezier(.2,.7,.2,1), transform 0.7s cubic-bezier(.2,.7,.2,1); }
    .tgop[data-anim="1"] .tgop-reveal.in { opacity: 1; transform: none; }

    /* Honeypot — offscreen, never seen by a real visitor */
    .tgop-hp { position: absolute !important; left: -9999px !important; width: 1px; height: 1px; opacity: 0; }

    @media (max-width: 900px) {
      .tgop-body { grid-template-columns: 1fr; gap: 8px; }
      .tgop-aside { position: static; margin-top: 8px; }
      .tgop-facts { grid-template-columns: repeat(3, 1fr); }
      .tgop-facts .tgop-fact:nth-child(4), .tgop-facts .tgop-fact:nth-child(5) { display: none; }
    }
    @media (max-width: 600px) {
      .tgop-incl { grid-template-columns: 1fr; }
      .tgop-gallery { grid-template-columns: repeat(2, 1fr); grid-auto-rows: 120px; }
      .tgop-gallery .g:first-child { grid-column: span 2; grid-row: span 1; }
      .tgop-facts-wrap { margin-top: -36px; }
      .tgop-form-row { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      .tgop-hero-img { animation: none; }
      .tgop-scroll-cue { animation: none; }
      .tgop-reveal { opacity: 1; transform: none; transition: none; }
    }
  `;

  // ── Widget ─────────────────────────────────────────────────────────────────
  class TGOfferPageWidget {
    constructor(container, config) {
      this.el = container;
      container._tgInitialised = true;
      this.cfg = this._defaults(config);
      this.t = makeT(this.cfg);   // resolve viewer language + UI strings
      this.lo = this._localizedOffer(this.cfg.offer);   // content localised for that language
      this.shadow = container.attachShadow({ mode: 'open' });
      this._timers = [];
      this._io = null;
      this._render();
    }

    _defaults(c) {
      c = c || {};
      const o = c.offer && typeof c.offer === 'object' ? c.offer : {};
      const templates = ['classic', 'editorial', 'immersive'];
      return {
        template: templates.indexOf(c.template) !== -1 ? c.template : 'classic',
        theme: c.theme === 'dark' ? 'dark' : 'light',
        brandColor: c.brandColor || '',
        accentColor: c.accentColor || '',
        radius: typeof c.radius === 'number' ? c.radius : 18,
        currency: c.currency || '',
        agencyName: c.agencyName || '',
        offerId: c.offerId || '',                    // stored offer id, for routing the enquiry
        enquiryEndpoint: c.enquiryEndpoint || (SCRIPT_BASE + 'api/offer-enquiry'),
        offer: o
      };
    }

    /**
     * Layer-2 content overlay. The author writes the offer once in the source
     * language (English); offer.i18n holds per-language overlays produced on save
     * by the editor's translation step. Here we lay the overlay for the viewer's
     * language over the source so a missing translation always falls back to the
     * original, never a blank.
     *
     * Only the translatable copy is overlaid — title, teaser, description, urgency
     * and avail in `fields`, plus the includes and tags arrays. Everything else
     * (price, currency, country, region, resort, property, dates, references,
     * board, stars, airline and the rest) comes straight from the source offer
     * untouched. Localising a price or place would be wrong, so it never happens.
     */
    _localizedOffer(offer) {
      const o = offer && typeof offer === 'object' ? offer : {};
      const lang = this.t && this.t.lang;
      if (!lang || lang === 'en' || !o.i18n || typeof o.i18n !== 'object') return o;
      const tr = o.i18n[lang];
      if (!tr || typeof tr !== 'object') return o;

      const out = Object.assign({}, o);

      // Overlay only the translatable text fields; keep every other field source.
      if (tr.fields && typeof tr.fields === 'object') {
        const pick = (base, over) => (typeof over === 'string' && over.trim()) ? over : base;
        const baseFields = (o.fields && typeof o.fields === 'object') ? o.fields : {};
        const overlaid = Object.assign({}, baseFields);
        ['title', 'teaser', 'description', 'urgency', 'avail'].forEach((k) => {
          overlaid[k] = pick(baseFields[k], tr.fields[k]);
        });
        out.fields = overlaid;
      }

      // Replace the includes / tags arrays only when a non-empty translation exists.
      if (Array.isArray(tr.includes) && tr.includes.length) out.includes = tr.includes;
      if (Array.isArray(tr.tags) && tr.tags.length) out.tags = tr.tags;

      return out;
    }

    _f(key) {
      const o = this.lo || this.cfg.offer || {};
      if (o.fields && o.fields[key] != null && o.fields[key] !== '') return o.fields[key];
      if (o[key] != null && o[key] !== '') return o[key];
      return '';
    }

    _images() {
      const o = this.lo || this.cfg.offer || {};
      let imgs = [];
      if (Array.isArray(o.images)) imgs = o.images.slice();
      const hero = this._f('image');
      if (hero && imgs.indexOf(hero) === -1) imgs.unshift(hero);
      return imgs.map(safeUrl).filter(Boolean);
    }

    _derive() {
      const o = this.lo || this.cfg.offer || {};
      const sym = currencySymbol(this.cfg.currency || o.currency || 'GBP');
      const imgs = this._images();
      const priceN = num(this._f('price'));
      const wasN = num(this._f('was'));
      const save = wasN && priceN && wasN > priceN ? wasN - priceN : 0;
      const savePct = save ? Math.round((save / wasN) * 100) : 0;
      const protection = this._f('protection');

      // Map — only when we have valid coordinates (mirrors the maps widget,
      // which needs lat/lng; the address is display text).
      const lat = fnum(this._f('mapLat')), lng = fnum(this._f('mapLng'));
      const map = (lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
        ? { lat: lat, lng: lng, address: this._f('mapAddress'), style: this._f('mapStyle') || 'streets' }
        : null;

      return {
        sym: sym, images: imgs,
        eyebrow: [this._f('style'), shortType(this._f('type'))].filter(Boolean).join('  ·  '),
        title: this._f('title') || this.t('defaultTitle'),
        stars: parseStars(this._f('stars')),
        loc: [this._f('resort'), this._f('region'), this._f('country')].filter(Boolean).join(', '),
        teaser: this._f('teaser'),
        description: this._f('description') || this._f('teaser'),
        nights: this._f('nights'),
        board: this._f('board'),
        flighttype: this._f('flighttype'),
        airline: this._f('airline'),
        period: this._f('period'),
        property: this._f('property'),
        price: money(sym, priceN), priceN: priceN,
        was: money(sym, wasN),
        save: money(sym, save), savePct: savePct,
        basis: this._f('basis'),
        deposit: money(sym, this._f('deposit')),
        badge: this._f('badge'), badgeAmount: this._f('badgeAmount'),
        urgency: this._f('urgency'),
        bookby: this._f('bookby'),
        avail: this._f('avail'),
        reference: this._f('reference'),
        protection: protection,
        atol: /atol|both/i.test(protection),
        abta: /abta|both/i.test(protection),
        includes: Array.isArray(o.includes) ? o.includes : [],
        tags: Array.isArray(o.tags) ? o.tags : [],
        enquiryEmail: this._f('enquiryEmail') || this.cfg.offer.enquiryEmail || '',
        enquiryPhone: this._f('enquiryPhone'),
        video: parseVideo(this._f('video')),
        map: map,
        currency: sym
      };
    }

    _heroBadges(d, onLight) {
      const glass = onLight ? 'glass light' : 'glass';
      const out = [];
      if (d.save) out.push('<span class="tgop-badge save">' + esc(this.t('save')) + ' ' + esc(d.save) + (d.savePct ? ' (' + d.savePct + '%)' : '') + '</span>');
      else if (d.badge && d.badge !== 'No badge') out.push('<span class="tgop-badge save">' + esc(d.badge) + '</span>');
      if (d.atol) out.push('<span class="tgop-badge ' + glass + '">' + I.shield + ' ATOL protected</span>');
      else if (d.abta) out.push('<span class="tgop-badge ' + glass + '">' + I.shield + ' ABTA member</span>');
      return out.length ? '<div class="tgop-badges">' + out.join('') + '</div>' : '';
    }

    _facts(d) {
      const t = this.t;
      const items = [];
      if (d.nights) items.push([I.moon, t('duration'), esc(d.nights) + ' ' + esc(t('nights'))]);
      if (d.board) items.push([I.plate, t('board'), esc(d.board)]);
      if (d.flighttype && d.flighttype !== 'Not included') items.push([I.plane, t('flights'), esc(d.flighttype)]);
      if (d.period) items.push([I.calendar, t('travel'), esc(d.period)]);
      if (d.stars) items.push([I.hotel, t('hotel'), d.stars + ' ' + esc(t('star'))]);
      // Pad to 5 if we can, but never show empties
      return items.slice(0, 5).map(function (f) {
        return '<div class="tgop-fact"><div class="tgop-fact-ic">' + f[0] + '</div>'
          + '<div class="tgop-fact-lab">' + f[1] + '</div><div class="tgop-fact-val">' + f[2] + '</div></div>';
      }).join('');
    }

    _detailTable(d) {
      const t = this.t;
      const rows = [
        [t('resort'), [d.property, this._f('resort')].filter(Boolean).join(', ')],
        [t('destination'), d.loc],
        [t('departsFrom'), this._f('origin')],
        [t('airline'), [d.airline, d.flighttype].filter(Boolean).join(', ')],
        [t('boardBasis'), d.board],
        [t('travelPeriod'), d.period],
        [t('bookByLabel'), d.bookby],
        [t('offerReference'), d.reference]
      ].filter(function (r) { return r[1]; });
      return rows.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>';
      }).join('');
    }

    _bookCard(d) {
      const t = this.t;
      const was = d.was ? '<span class="tgop-was">' + esc(d.was) + '</span>' : '';
      const save = d.save ? '<div><span class="tgop-save">' + esc(t('youSave')) + ' ' + esc(d.save) + (d.savePct ? ' · ' + d.savePct + '%' : '') + '</span></div>' : '';
      const basis = d.basis ? '<div class="tgop-basis">' + esc(d.basis) + (d.nights ? ' · ' + esc(t('basedOnLead')) : '') + '</div>' : '';
      const deposit = d.deposit ? '<div class="tgop-deposit">' + I.shield + '<span>' + esc(t('deposit', { amount: d.deposit })) + '</span></div>' : '';
      const countdown = '<div class="tgop-countdown" data-countdown hidden></div>';
      const trustBits = [];
      if (d.atol) trustBits.push('ATOL protected');
      if (d.abta) trustBits.push('ABTA member');
      const trust = '<p class="tgop-trust">' + esc(t('trustLine'))
        + (trustBits.length ? '<br>🔒 <b>' + esc(trustBits.join(' · ')) + '</b>' : '') + '</p>';

      return '<div class="tgop-book">'
        + '<div class="tgop-book-top">'
          + '<div class="tgop-book-from">' + esc(t('from')) + '</div>'
          + '<div class="tgop-price-row"><div class="tgop-price">' + (d.price || esc(t('poa'))) + '</div>' + was + '</div>'
          + save + basis + deposit + countdown
        + '</div>'
        + '<form class="tgop-form" novalidate>'
          + '<div class="tgop-form-h">' + esc(t('enquireAbout')) + '</div>'
          + '<div class="tgop-field" data-req="name"><input class="tgop-input" name="name" placeholder="' + esc(t('fullName')) + '" autocomplete="name"><span class="tgop-field-err">' + esc(t('addName')) + '</span></div>'
          + '<div class="tgop-form-row">'
            + '<div class="tgop-field" data-req="email"><input class="tgop-input" name="email" type="email" placeholder="' + esc(t('email')) + '" autocomplete="email"><span class="tgop-field-err">' + esc(t('validEmail')) + '</span></div>'
            + '<div class="tgop-field"><input class="tgop-input" name="phone" type="tel" placeholder="' + esc(t('phone')) + '" autocomplete="tel"></div>'
          + '</div>'
          + '<div class="tgop-form-row">'
            + '<div class="tgop-field"><input class="tgop-input" name="month" placeholder="' + esc(t('preferredMonth')) + '"></div>'
            + '<div class="tgop-field"><select class="tgop-input" name="travellers"><option value="">' + esc(t('travellers')) + '</option><option>' + esc(t('traveller1')) + '</option><option selected>' + esc(t('travellers2')) + '</option><option>' + esc(t('adultsChildren')) + '</option><option>' + esc(t('travellers3plus')) + '</option></select></div>'
          + '</div>'
          + '<div class="tgop-field"><textarea class="tgop-input" name="message" placeholder="' + esc(t('messagePlaceholder')) + '"></textarea></div>'
          + '<input class="tgop-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
          + '<button type="submit" class="tgop-submit">' + esc(t('sendEnquiry')) + '</button>'
          + trust
        + '</form>'
      + '</div>';
    }

    _render() {
      this._timers.forEach(clearInterval); this._timers = [];
      if (this._io) { try { this._io.disconnect(); } catch (e) {} this._io = null; }

      // Scheduling: outside its show window the page renders nothing at all, so
      // a stale or early link shows no offer rather than an expired one.
      this._window = offerWindow(this._f('showFrom'), this._f('showUntil'));
      if (!this._window.live) {
        this.shadow.innerHTML = '';
        this.el.setAttribute('data-tg-hidden', this._window.state);
        this.root = null;
        return;
      }
      this.el.removeAttribute('data-tg-hidden');
      this._renderedAt = Date.now();   // used by the enquiry time-trap

      const cfg = this.cfg;
      const t = this.t;
      const d = this._derive();

      const root = document.createElement('div');
      root.className = 'tgop';
      root.setAttribute('data-theme', cfg.theme);
      if (cfg.brandColor) root.style.setProperty('--tgo-brand', cfg.brandColor);
      if (cfg.accentColor) { root.style.setProperty('--tgo-accent', cfg.accentColor); root.style.setProperty('--tgo-accent-hover', cfg.accentColor); }
      if (cfg.radius) root.style.setProperty('--tgo-radius', cfg.radius + 'px');

      const hero = d.images[0];
      const heroBg = hero ? ' style="background-image:url(' + esc(hero) + ')"' : '';
      const heroCls = hero ? '' : ' ph';
      const starsStr = d.stars ? '<span class="tgop-hero-stars">' + '★'.repeat(d.stars) + '</span>' : '';

      // ── Section fragments (assembled differently per template) ──
      const tags = d.tags.length
        ? '<div class="tgop-tags">' + d.tags.map(function (t) { return '<span class="tgop-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
        : '';
      // About prose comes from the description, falling back to the teaser.
      const descParas = String(d.description || d.teaser || '').split(/\n+/).filter(Boolean)
        .map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
      // Only show the About section when there is prose or at least some tags.
      const fAbout = (descParas || tags)
        ? '<div class="tgop-section tgop-reveal"><h2 class="tgop-h2">' + esc(t('aboutHoliday')) + '</h2>'
          + (descParas ? '<div class="tgop-prose">' + descParas + '</div>' : '')
          + tags + '</div>'
        : '';

      const fIncludes = d.includes.length
        ? '<div class="tgop-section tgop-reveal"><h2 class="tgop-h2">' + esc(t('whatsIncluded')) + '</h2><ul class="tgop-incl">'
          + d.includes.map(function (x) { return '<li><span class="tick">' + I.check + '</span>' + esc(x) + '</li>'; }).join('')
          + '</ul></div>'
        : '';

      const fGallery = d.images.length > 1
        ? '<div class="tgop-section tgop-reveal"><h2 class="tgop-h2">' + esc(t('photos')) + '</h2><div class="tgop-gallery" data-gallery>'
          + d.images.slice(0, 5).map(function (src, i) { return '<button type="button" class="g" data-idx="' + i + '" style="background-image:url(' + esc(src) + ')" aria-label="' + esc(t('openPhoto', { n: i + 1 })) + '"></button>'; }).join('')
          + '</div></div>'
        : '';

      const fVideo = d.video
        ? '<div class="tgop-section tgop-reveal"><h2 class="tgop-h2">' + esc(t('takeALook')) + '</h2><div class="tgop-video">' + videoEmbed(d.video) + '</div></div>'
        : '';

      // Map placeholder — TGMapsWidget is mounted into [data-map] in _bind().
      const fMap = d.map
        ? '<div class="tgop-section tgop-reveal"><h2 class="tgop-h2">' + esc(t('whereYoullBe')) + '</h2>'
          + (d.map.address ? '<p class="tgop-map-addr">' + I.pin + esc(d.map.address) + '</p>' : '')
          + '<div class="tgop-map" data-map></div></div>'
        : '';

      const detailRows = this._detailTable(d);
      const fDetail = detailRows
        ? '<div class="tgop-section tgop-reveal"><h2 class="tgop-h2">' + esc(t('theDetail')) + '</h2><table class="tgop-table"><tbody>' + detailRows + '</tbody></table></div>'
        : '';

      const fBar = '<div class="tgop-bar" data-bar><div class="tgop-bar-inner">'
        + '<span class="tgop-bar-title">' + esc(d.title) + '</span><span class="tgop-bar-spacer"></span>'
        + (d.price ? '<span class="tgop-bar-price">' + d.price + ' <small>' + esc(d.basis || '') + '</small></span>' : '')
        + '<button type="button" class="tgop-btn accent sm" data-enquire>' + esc(t('enquireNow')) + '</button>'
      + '</div></div>';

      // Overlay hero (classic + editorial)
      const fHero = '<div class="tgop-hero">'
        + '<div class="tgop-hero-img' + heroCls + '"' + heroBg + '></div>'
        + '<div class="tgop-hero-inner"><div>'
          + this._heroBadges(d)
          + (d.eyebrow ? '<div class="tgop-eyebrow">' + esc(d.eyebrow) + '</div>' : '')
          + '<h1 class="tgop-h1">' + esc(d.title) + '</h1>'
          + '<div class="tgop-hero-meta">'
            + (d.loc ? '<span class="tgop-hero-loc">' + I.pin + esc(d.loc) + '</span>' : '') + starsStr
          + '</div>'
        + '</div></div>'
        + '<div class="tgop-scroll-cue">' + I.chevDown + '</div>'
      + '</div>';

      // Split hero (immersive): image one side, content panel the other
      const fHeroSplit = '<div class="tgop-hero tgop-hero--split">'
        + '<div class="tgop-hsplit-img' + heroCls + '"' + heroBg + '></div>'
        + '<div class="tgop-hsplit-panel"><div class="tgop-hsplit-inner">'
          + this._heroBadges(d, true)
          + (d.eyebrow ? '<div class="tgop-eyebrow alt">' + esc(d.eyebrow) + '</div>' : '')
          + '<h1 class="tgop-h1 alt">' + esc(d.title) + '</h1>'
          + '<div class="tgop-hero-meta alt">'
            + (d.loc ? '<span class="tgop-hero-loc">' + I.pin + esc(d.loc) + '</span>' : '') + starsStr
          + '</div>'
          + (d.teaser ? '<p class="tgop-hsplit-teaser">' + esc(d.teaser) + '</p>' : '')
          + '<div class="tgop-hsplit-buy">'
            + (d.price ? '<div class="tgop-hsplit-price"><span>' + esc(t('from')) + '</span> ' + d.price + (d.basis ? ' <small>' + esc(d.basis) + '</small>' : '') + '</div>' : '')
            + '<button type="button" class="tgop-btn accent" data-enquire>' + esc(t('enquireNow')) + ' ' + I.arrow + '</button>'
          + '</div>'
        + '</div></div>'
      + '</div>';

      const factsHtml = this._facts(d);
      const fFacts = factsHtml ? '<div class="tgop-wrap tgop-facts-wrap"><div class="tgop-facts">' + factsHtml + '</div></div>' : '';

      const footTrust = [];
      if (d.atol) footTrust.push('ATOL protected');
      if (d.abta) footTrust.push('ABTA member');

      const fCta = '<div class="tgop-cta-band"><div class="tgop-cta-inner">'
        + '<div><h3>' + esc(t('readyWhenYouAre')) + '</h3><p>' + esc(t('ctaCopy')) + '</p></div>'
        + '<span class="tgop-cta-spacer"></span>'
        + '<button type="button" class="tgop-btn primary" data-enquire>' + esc(t('enquireNow')) + ' ' + I.arrow + '</button>'
        + (d.enquiryPhone ? '<a class="tgop-btn ghost" href="tel:' + esc(d.enquiryPhone.replace(/\s/g, '')) + '">' + I.phone + ' ' + esc(d.enquiryPhone) + '</a>' : '')
      + '</div></div>';

      const fFooter = '<div class="tgop-foot"><div class="tgop-foot-inner">'
        + (footTrust.length ? '<span class="tgop-foot-trust">' + I.shield + esc(footTrust.join(' · ')) + '</span>' : '')
        + (d.reference ? '<span>' + esc(t('offerRef')) + ' ' + esc(d.reference) + '</span>' : '')
        + (this.cfg.agencyName ? '<span>' + esc(this.cfg.agencyName) + '</span>' : '')
        + '<span class="tgop-bar-spacer"></span><span>' + esc(t('poweredBy')) + '</span>'
      + '</div></div>';

      const fLightbox = '<div class="tgop-lb" data-lb><button type="button" class="tgop-lb-btn close" data-lb-close>' + I.x + '</button>'
        + '<button type="button" class="tgop-lb-btn prev" data-lb-prev>' + I.chevDown + '</button>'
        + '<img class="tgop-lb-img" data-lb-img alt="">'
        + '<button type="button" class="tgop-lb-btn next" data-lb-next>' + I.chevDown + '</button></div>';

      // Main column content order (shared by classic + immersive)
      const mainCol = fAbout + fIncludes + fVideo + fGallery + fMap + fDetail;

      // ── Assemble by template ──
      let html;
      if (cfg.template === 'editorial') {
        html = fBar + fHero + fFacts
          + '<div class="tgop-wrap tgop-editorial">' + fAbout + fIncludes + fGallery + fVideo + fMap + fDetail + '</div>'
          + '<div class="tgop-enqband"><div class="tgop-wrap tgop-enqband-inner">'
            + '<div class="tgop-enqband-copy"><h2 class="tgop-h2">' + esc(t('likeTheLook')) + '</h2><p>' + esc(t('enqBandCopy')) + '</p></div>'
            + '<div class="tgop-enqband-card">' + this._bookCard(d) + '</div>'
          + '</div></div>'
          + fCta + fFooter + fLightbox;
      } else if (cfg.template === 'immersive') {
        html = fBar + fHeroSplit + fFacts
          + '<div class="tgop-wrap"><div class="tgop-body">'
            + '<div class="tgop-main">' + mainCol + '</div>'
            + '<aside class="tgop-aside">' + this._bookCard(d) + '</aside>'
          + '</div></div>'
          + fCta + fFooter + fLightbox;
      } else { // classic
        html = fBar + fHero + fFacts
          + '<div class="tgop-wrap"><div class="tgop-body">'
            + '<div class="tgop-main">' + mainCol + '</div>'
            + '<aside class="tgop-aside">' + this._bookCard(d) + '</aside>'
          + '</div></div>'
          + fCta + fFooter + fLightbox;
      }

      root.setAttribute('data-template', cfg.template);
      root.innerHTML = html;

      this.shadow.innerHTML = '<style>' + STYLES + '</style>';
      this.shadow.appendChild(root);
      this.root = root;
      this._bind(d);
    }

    _bind(d) {
      const root = this.root;

      // Sticky bar: show once hero is mostly scrolled past
      const hero = root.querySelector('.tgop-hero');
      const bar = root.querySelector('[data-bar]');
      const onScroll = function () {
        const past = hero.getBoundingClientRect().bottom < 80;
        bar.classList.toggle('show', past);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      this._onScroll = onScroll;
      onScroll();

      // Reveal on scroll — only animate when supported and motion is allowed.
      // Without data-anim the sections render fully visible (no hidden content).
      const reveals = root.querySelectorAll('.tgop-reveal');
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if ('IntersectionObserver' in window && !reduce) {
        root.setAttribute('data-anim', '1');
        this._io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); } });
        }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
        reveals.forEach((el) => this._io.observe(el));
      }

      // Enquire buttons → scroll to form, focus first field
      const form = root.querySelector('.tgop-form');
      root.querySelectorAll('[data-enquire]').forEach((b) => b.addEventListener('click', function () {
        const aside = root.querySelector('.tgop-aside');
        (aside || form).scrollIntoView({ behavior: 'smooth', block: 'start' });
        const first = form && form.querySelector('input[name="name"]');
        if (first) setTimeout(function () { first.focus(); }, 420);
      }));

      // Countdown to book-by
      this._initCountdown(d);

      // Gallery lightbox
      this._initLightbox(d);

      // Map (delegates to the shared TGMapsWidget)
      this._mountMap(d);

      // Enquiry submit
      if (form) form.addEventListener('submit', (e) => { e.preventDefault(); this._submitEnquiry(form, d); });
    }

    _mountMap(d) {
      if (!d.map) return;
      const holder = this.root.querySelector('[data-map]');
      if (!holder) return;
      const accent = this.cfg.accentColor || '#0891B2';
      const mapCfg = {
        mapStyle: d.map.style || 'streets',
        zoom: 13,
        autoFit: false,
        center: { lat: d.map.lat, lng: d.map.lng },
        height: 360,
        accent: accent,
        theme: this.cfg.theme,
        showList: 'never',
        scrollWheel: false,
        directionsButton: true,
        showInfoCard: false,
        locations: [{
          title: d.property || d.title,
          address: d.map.address || d.loc,
          lat: d.map.lat,
          lng: d.map.lng,
          color: accent
        }]
      };
      const mount = function (W) {
        try {
          const div = document.createElement('div');
          holder.innerHTML = '';
          holder.appendChild(div);
          new W(div, mapCfg);
        } catch (e) { /* leave the address text as the fallback */ }
      };
      if (window.TGMapsWidget) { mount(window.TGMapsWidget); return; }
      ensureMaps().then(function () { if (window.TGMapsWidget) mount(window.TGMapsWidget); })
        .catch(function () { holder.classList.add('tgop-map-failed'); });
    }

    _initCountdown(d) {
      const t = this.t;
      const el = this.root.querySelector('[data-countdown]');
      if (!el || !d.bookby) return;
      const target = new Date(d.bookby);
      if (isNaN(target.getTime())) {
        el.hidden = false;
        el.textContent = t('bookByPrefix') + ' ' + d.bookby;
        return;
      }
      const tick = function () {
        const diff = target.getTime() - Date.now();
        if (diff <= 0) { el.textContent = t('endsToday'); return; }
        const days = Math.floor(diff / 86400000);
        const hrs = Math.floor((diff % 86400000) / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        el.innerHTML = '⏳ ' + esc(t('endsIn', { days: days, hours: hrs, mins: mins }));
      };
      el.hidden = false;
      tick();
      this._timers.push(setInterval(tick, 60000));
    }

    _initLightbox(d) {
      const root = this.root;
      const lb = root.querySelector('[data-lb]');
      const img = root.querySelector('[data-lb-img]');
      const gallery = root.querySelector('[data-gallery]');
      if (!lb || !gallery) return;
      const imgs = d.images;
      let idx = 0;
      const show = function (i) { idx = (i + imgs.length) % imgs.length; img.src = imgs[idx]; };
      const open = function (i) { show(i); lb.classList.add('open'); };
      const close = function () { lb.classList.remove('open'); img.src = ''; };
      gallery.querySelectorAll('.g').forEach((g) => g.addEventListener('click', function () { open(parseInt(g.dataset.idx, 10) || 0); }));
      root.querySelector('[data-lb-close]').addEventListener('click', close);
      root.querySelector('[data-lb-prev]').addEventListener('click', function () { show(idx - 1); });
      root.querySelector('[data-lb-next]').addEventListener('click', function () { show(idx + 1); });
      lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
      const onKey = function (e) {
        if (!lb.classList.contains('open')) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') show(idx - 1);
        else if (e.key === 'ArrowRight') show(idx + 1);
      };
      window.addEventListener('keydown', onKey);
      this._onKey = onKey;
      // rotate the prev arrow to point left, next stays as down-rotated-right
      root.querySelector('[data-lb-prev]').style.transform = 'translateY(-50%) rotate(90deg)';
      root.querySelector('[data-lb-next]').style.transform = 'translateY(-50%) rotate(-90deg)';
    }

    _submitEnquiry(form, d) {
      let ok = true;
      form.querySelectorAll('.tgop-field').forEach(function (f) { f.classList.remove('bad'); });
      const nameF = form.querySelector('[data-req="name"]');
      const emailF = form.querySelector('[data-req="email"]');
      if (!form.name.value.trim()) { nameF.classList.add('bad'); ok = false; }
      if (!isEmail(form.email.value)) { emailF.classList.add('bad'); ok = false; }
      if (!ok) {
        const bad = form.querySelector('.tgop-field.bad input');
        if (bad) bad.focus();
        return;
      }
      const detail = {
        offerTitle: d.title,
        offerReference: d.reference || '',
        to: d.enquiryEmail || '',
        enquiry: {
          name: form.name.value.trim(),
          email: form.email.value.trim(),
          phone: form.phone.value.trim(),
          month: form.month.value.trim(),
          travellers: form.travellers.value,
          message: form.message.value.trim()
        }
      };
      this.el.dispatchEvent(new CustomEvent('tg-offer-enquiry', { bubbles: true, composed: true, detail: detail }));

      // Send the enquiry to the agency (resolved server-side from the offer).
      try {
        fetch(this.cfg.enquiryEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offerId: this.cfg.offerId,
            name: detail.enquiry.name, email: detail.enquiry.email, phone: detail.enquiry.phone,
            month: detail.enquiry.month, travellers: detail.enquiry.travellers, message: detail.enquiry.message,
            offerTitle: d.title, offerReference: d.reference || '',
            website: (form.website && form.website.value) || '',
            ts: this._renderedAt || 0
          })
        }).catch(function () {});
      } catch (e) { /* never block the thank-you on the network */ }

      const card = form.closest('.tgop-book');
      form.outerHTML =
        '<div class="tgop-enq-success"><div class="tick">' + I.check + '</div>'
        + '<h4>' + esc(this.t('enquirySent')) + '</h4><p>' + esc(this.t('thanksName', { name: detail.enquiry.name.split(' ')[0] })) + '</p></div>';
      void card;
    }

    update(config) {
      this.destroy();
      this.cfg = this._defaults(Object.assign({}, this.cfg, config));
      this.t = makeT(this.cfg);
      this.lo = this._localizedOffer(this.cfg.offer);
      this._render();
    }

    destroy() {
      this._timers.forEach(clearInterval); this._timers = [];
      if (this._io) { try { this._io.disconnect(); } catch (e) {} this._io = null; }
      if (this._onScroll) window.removeEventListener('scroll', this._onScroll);
      if (this._onKey) window.removeEventListener('keydown', this._onKey);
    }
  }

  // ── Auto-init ───────────────────────────────────────────────────────────────
  async function loadConfigFromApi(widgetId) {
    try {
      const res = await fetch(API_BASE + '?id=' + encodeURIComponent(widgetId));
      if (!res.ok) throw new Error('Config load failed: ' + res.status);
      const data = await res.json();
      if (data && data.config) return Object.assign({}, data.config, { _widgetId: widgetId });
      throw new Error('No config returned');
    } catch (err) { console.error('[TGOfferPage] Config load error:', err); return null; }
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="offer-page"]');
    for (const el of containers) {
      if (el._tgInitialised || el.shadowRoot) continue;
      el._tgInitialised = true;
      let config = null;
      const inline = el.getAttribute('data-tg-config');
      const offerAttr = el.getAttribute('data-tg-offer');
      const widgetId = el.getAttribute('data-tg-id');
      if (inline) {
        try { config = JSON.parse(inline); } catch (e) { console.error('[TGOfferPage] Invalid inline config:', e); continue; }
      } else if (widgetId) {
        config = await loadConfigFromApi(widgetId);
        if (!config) continue;
      } else { config = {}; }
      if (offerAttr && !config.offer) {
        try { config.offer = JSON.parse(offerAttr); } catch (e) { console.error('[TGOfferPage] Invalid data-tg-offer:', e); }
      }
      new TGOfferPageWidget(el, config);
    }
  }

  if (typeof window !== 'undefined') {
    window.TGOfferPageWidget = TGOfferPageWidget;
    window.TGOfferPageWidget.version = VERSION;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
