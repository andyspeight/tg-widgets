/**
 * Travelgenix Appointment / Callback Scheduler Widget v2.0.0
 * A Calendly-style booking widget: month-view calendar, timezone detection and
 * switching, 12/24h times, multiple event types, per-day availability, blackout
 * dates, custom questions and Add to Calendar. Self-contained, zero
 * dependencies, Shadow DOM, accessible, CSP-clean (no inline handlers).
 *
 * Availability is defined in the host timezone; slots are real instants that are
 * displayed in the visitor's chosen timezone. This is a scheduling REQUEST form:
 * it captures a preferred slot and hands it to a human. Live free/busy sync and
 * persistent reschedule/cancel are a backend follow-up; the request payload
 * already carries everything those need.
 *
 * Usage (remote config):
 *   <div data-tg-widget="appointment" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-appointment.js"></script>
 *
 * Usage (inline config):
 *   <div data-tg-widget="appointment" data-tg-config='{"heading":"Book a call"}'></div>
 *   <script src="https://tg-widgets.vercel.app/widget-appointment.js"></script>
 *
 * © Travelgenix. All rights reserved.
 */
(function () {
  'use strict';

  const VERSION = '2.0.4';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (step labels, field labels, buttons, validation and
  // status messages). Author content (heading, subheading, question labels,
  // consent text, success copy, event/service names) stays as configured.
  // English is the source + fallback. Month and weekday names are produced by
  // Intl.DateTimeFormat from the resolved language's locale, not catalogued.
  const MESSAGES = {
    en: {
      chooseMeeting: 'Choose a meeting', meetings: 'Meetings',
      selectDateTime: 'Select a date & time',
      prevMonth: 'Previous month', nextMonth: 'Next month',
      timezone: 'Timezone', timeFormat: 'Time format',
      fmt12: '12h', fmt24: '24h',
      minUnit: '{n} min',
      noTimesLeft: 'No times left on this day.',
      noneAvailable: 'No times available right now.',
      back: 'Back', name: 'Name', email: 'Email', phone: 'Phone', message: 'Message',
      namePlaceholder: 'Your name', emailPlaceholder: 'you@example.com', phonePlaceholder: 'Your number',
      pleaseChoose: 'Please choose…',
      at: '{date} at {time}',
      checkFields: 'Please check the highlighted fields.',
      validEmail: 'Please enter a valid email address.',
      tickConsent: 'Please tick the box to say we can contact you.',
      somethingWrong: 'Something went wrong. Please try again.',
      networkError: 'Network error. Please try again.',
      sending: 'Sending…',
      addGoogle: 'Add to Google', downloadIcs: 'Download .ics',
      manageBooking: 'Manage or cancel this booking', needDifferent: 'Need a different time?',
      confirmBooking: 'Confirm booking',
      moveBooking: 'Move your booking to this time.', confirmNewTime: 'Confirm new time',
      moving: 'Moving…', bookingMoved: 'Your booking has been moved',
      bookingMovedBody: 'We have updated your appointment to the new time.',
      couldNotMove: 'Could not move the booking.',
      modeCallback: 'Phone callback', modePhone: 'Phone call', modeVideo: 'Video call', modeInperson: 'In person',
    },
    fr: {
      chooseMeeting: 'Choisissez un rendez-vous', meetings: 'Rendez-vous',
      selectDateTime: 'Choisissez une date et une heure',
      prevMonth: 'Mois précédent', nextMonth: 'Mois suivant',
      timezone: 'Fuseau horaire', timeFormat: 'Format de l’heure',
      fmt12: '12h', fmt24: '24h',
      minUnit: '{n} min',
      noTimesLeft: 'Aucun horaire disponible ce jour-là.',
      noneAvailable: 'Aucun horaire disponible pour le moment.',
      back: 'Retour', name: 'Nom', email: 'E-mail', phone: 'Téléphone', message: 'Message',
      namePlaceholder: 'Votre nom', emailPlaceholder: 'vous@exemple.com', phonePlaceholder: 'Votre numéro',
      pleaseChoose: 'Veuillez choisir…',
      at: '{date} à {time}',
      checkFields: 'Veuillez vérifier les champs en surbrillance.',
      validEmail: 'Veuillez saisir une adresse e-mail valide.',
      tickConsent: 'Veuillez cocher la case pour autoriser que l’on vous contacte.',
      somethingWrong: 'Une erreur est survenue. Veuillez réessayer.',
      networkError: 'Erreur réseau. Veuillez réessayer.',
      sending: 'Envoi…',
      addGoogle: 'Ajouter à Google', downloadIcs: 'Télécharger .ics',
      manageBooking: 'Gérer ou annuler cette réservation', needDifferent: 'Besoin d’un autre horaire ?',
      confirmBooking: 'Confirmer la réservation',
      moveBooking: 'Déplacez votre réservation à cet horaire.', confirmNewTime: 'Confirmer le nouvel horaire',
      moving: 'Déplacement…', bookingMoved: 'Votre réservation a été déplacée',
      bookingMovedBody: 'Nous avons mis à jour votre rendez-vous à ce nouvel horaire.',
      couldNotMove: 'Impossible de déplacer la réservation.',
      modeCallback: 'Rappel téléphonique', modePhone: 'Appel téléphonique', modeVideo: 'Appel vidéo', modeInperson: 'En personne',
    },
    de: {
      chooseMeeting: 'Termin wählen', meetings: 'Termine',
      selectDateTime: 'Datum und Uhrzeit wählen',
      prevMonth: 'Vorheriger Monat', nextMonth: 'Nächster Monat',
      timezone: 'Zeitzone', timeFormat: 'Zeitformat',
      fmt12: '12 h', fmt24: '24 h',
      minUnit: '{n} Min.',
      noTimesLeft: 'An diesem Tag sind keine Zeiten mehr verfügbar.',
      noneAvailable: 'Derzeit sind keine Zeiten verfügbar.',
      back: 'Zurück', name: 'Name', email: 'E-Mail', phone: 'Telefon', message: 'Nachricht',
      namePlaceholder: 'Ihr Name', emailPlaceholder: 'sie@beispiel.de', phonePlaceholder: 'Ihre Nummer',
      pleaseChoose: 'Bitte wählen…',
      at: '{date} um {time}',
      checkFields: 'Bitte überprüfen Sie die markierten Felder.',
      validEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
      tickConsent: 'Bitte kreuzen Sie das Kästchen an, damit wir Sie kontaktieren dürfen.',
      somethingWrong: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
      networkError: 'Netzwerkfehler. Bitte versuchen Sie es erneut.',
      sending: 'Senden…',
      addGoogle: 'Zu Google hinzufügen', downloadIcs: '.ics herunterladen',
      manageBooking: 'Buchung verwalten oder stornieren', needDifferent: 'Eine andere Uhrzeit?',
      confirmBooking: 'Buchung bestätigen',
      moveBooking: 'Verschieben Sie Ihre Buchung auf diese Uhrzeit.', confirmNewTime: 'Neue Uhrzeit bestätigen',
      moving: 'Wird verschoben…', bookingMoved: 'Ihre Buchung wurde verschoben',
      bookingMovedBody: 'Wir haben Ihren Termin auf die neue Uhrzeit aktualisiert.',
      couldNotMove: 'Buchung konnte nicht verschoben werden.',
      modeCallback: 'Telefonischer Rückruf', modePhone: 'Telefonanruf', modeVideo: 'Videoanruf', modeInperson: 'Persönlich',
    },
    es: {
      chooseMeeting: 'Elige una cita', meetings: 'Citas',
      selectDateTime: 'Selecciona una fecha y una hora',
      prevMonth: 'Mes anterior', nextMonth: 'Mes siguiente',
      timezone: 'Zona horaria', timeFormat: 'Formato de hora',
      fmt12: '12 h', fmt24: '24 h',
      minUnit: '{n} min',
      noTimesLeft: 'No quedan horarios para este día.',
      noneAvailable: 'No hay horarios disponibles ahora mismo.',
      back: 'Atrás', name: 'Nombre', email: 'Correo electrónico', phone: 'Teléfono', message: 'Mensaje',
      namePlaceholder: 'Tu nombre', emailPlaceholder: 'tu@ejemplo.com', phonePlaceholder: 'Tu número',
      pleaseChoose: 'Elige una opción…',
      at: '{date} a las {time}',
      checkFields: 'Revisa los campos resaltados.',
      validEmail: 'Introduce una dirección de correo electrónico válida.',
      tickConsent: 'Marca la casilla para que podamos contactarte.',
      somethingWrong: 'Algo ha salido mal. Inténtalo de nuevo.',
      networkError: 'Error de red. Inténtalo de nuevo.',
      sending: 'Enviando…',
      addGoogle: 'Añadir a Google', downloadIcs: 'Descargar .ics',
      manageBooking: 'Gestionar o cancelar esta reserva', needDifferent: '¿Necesitas otra hora?',
      confirmBooking: 'Confirmar la reserva',
      moveBooking: 'Mueve tu reserva a esta hora.', confirmNewTime: 'Confirmar la nueva hora',
      moving: 'Moviendo…', bookingMoved: 'Tu reserva se ha movido',
      bookingMovedBody: 'Hemos actualizado tu cita a la nueva hora.',
      couldNotMove: 'No se pudo mover la reserva.',
      modeCallback: 'Devolución de llamada', modePhone: 'Llamada telefónica', modeVideo: 'Videollamada', modeInperson: 'En persona',
    },
    it: {
      chooseMeeting: 'Scegli un appuntamento', meetings: 'Appuntamenti',
      selectDateTime: 'Scegli una data e un orario',
      prevMonth: 'Mese precedente', nextMonth: 'Mese successivo',
      timezone: 'Fuso orario', timeFormat: 'Formato orario',
      fmt12: '12h', fmt24: '24h',
      minUnit: '{n} min',
      noTimesLeft: 'Nessun orario disponibile in questo giorno.',
      noneAvailable: 'Nessun orario disponibile al momento.',
      back: 'Indietro', name: 'Nome', email: 'Email', phone: 'Telefono', message: 'Messaggio',
      namePlaceholder: 'Il tuo nome', emailPlaceholder: 'tu@esempio.com', phonePlaceholder: 'Il tuo numero',
      pleaseChoose: 'Scegli…',
      at: '{date} alle {time}',
      checkFields: 'Controlla i campi evidenziati.',
      validEmail: 'Inserisci un indirizzo email valido.',
      tickConsent: 'Spunta la casella per autorizzarci a contattarti.',
      somethingWrong: 'Qualcosa è andato storto. Riprova.',
      networkError: 'Errore di rete. Riprova.',
      sending: 'Invio…',
      addGoogle: 'Aggiungi a Google', downloadIcs: 'Scarica .ics',
      manageBooking: 'Gestisci o annulla questa prenotazione', needDifferent: 'Serve un altro orario?',
      confirmBooking: 'Conferma la prenotazione',
      moveBooking: 'Sposta la tua prenotazione a questo orario.', confirmNewTime: 'Conferma il nuovo orario',
      moving: 'Spostamento…', bookingMoved: 'La tua prenotazione è stata spostata',
      bookingMovedBody: 'Abbiamo aggiornato il tuo appuntamento al nuovo orario.',
      couldNotMove: 'Impossibile spostare la prenotazione.',
      modeCallback: 'Richiamata telefonica', modePhone: 'Chiamata telefonica', modeVideo: 'Videochiamata', modeInperson: 'Di persona',
    },
    ro: {
      chooseMeeting: 'Alege o întâlnire', meetings: 'Întâlniri',
      selectDateTime: 'Alege o dată și o oră',
      prevMonth: 'Luna anterioară', nextMonth: 'Luna următoare',
      timezone: 'Fus orar', timeFormat: 'Format oră',
      fmt12: '12h', fmt24: '24h',
      minUnit: '{n} min',
      noTimesLeft: 'Niciun interval disponibil în această zi.',
      noneAvailable: 'Niciun interval disponibil momentan.',
      back: 'Înapoi', name: 'Nume', email: 'E-mail', phone: 'Telefon', message: 'Mesaj',
      namePlaceholder: 'Numele dvs.', emailPlaceholder: 'tu@exemplu.com', phonePlaceholder: 'Numărul dvs.',
      pleaseChoose: 'Alegeți…',
      at: '{date} la {time}',
      checkFields: 'Verificați câmpurile evidențiate.',
      validEmail: 'Introduceți o adresă de e-mail validă.',
      tickConsent: 'Bifați caseta pentru a ne permite să vă contactăm.',
      somethingWrong: 'Ceva nu a mers bine. Încercați din nou.',
      networkError: 'Eroare de rețea. Încercați din nou.',
      sending: 'Se trimite…',
      addGoogle: 'Adaugă în Google', downloadIcs: 'Descarcă .ics',
      manageBooking: 'Gestionați sau anulați această rezervare', needDifferent: 'Aveți nevoie de altă oră?',
      confirmBooking: 'Confirmă rezervarea',
      moveBooking: 'Mutați rezervarea la această oră.', confirmNewTime: 'Confirmați noua oră',
      moving: 'Se mută…', bookingMoved: 'Rezervarea dvs. a fost mutată',
      bookingMovedBody: 'Am actualizat programarea la noua oră.',
      couldNotMove: 'Rezervarea nu a putut fi mutată.',
      modeCallback: 'Apel de revenire', modePhone: 'Apel telefonic', modeVideo: 'Apel video', modeInperson: 'În persoană',
    },
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

  // Resolve the BCP-47 locale for a language code, so Intl produces month and
  // weekday names matching the chosen UI language.
  function localeOf(lang) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.localeOf === 'function') {
      try { const l = window.TGi18n.localeOf(lang); if (l) return l; } catch (e) { /* noop */ }
    }
    return ({ en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', ro: 'ro-RO' })[lang] || 'en-GB';
  }

  function resolveOrigin() {
    if (typeof window === 'undefined') return '';
    try { const me = document.currentScript; if (me && me.src) return new URL(me.src).origin; } catch (e) { /* noop */ }
    return '';
  }
  const SCRIPT_ORIGIN = resolveOrigin();
  const API_BASE = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (SCRIPT_ORIGIN + '/api/widget-config');

  // ─── Helpers ────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function safeColor(c, fb) { return (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) ? c.trim() : fb; }
  function safeFont(f) { return (typeof f === 'string' && /^[\w \-]{1,40}$/.test(f.trim())) ? f.trim() : 'DM Sans'; }
  function clampNum(v, min, max, fb) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb; }
  function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()) && String(v).length <= 150; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function inkFor(hex) {
    let h = (hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.5 ? '#0F172A' : '#FFFFFF';
  }

  // English fallbacks. Live month/weekday names come from Intl, localised to the
  // resolved UI language (see localeNames below).
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Build localised month/weekday name arrays for a given locale, indexed the
  // same way as the English fallbacks above (weekday 0=Sun..6=Sat, month 0=Jan).
  // Any failure falls back to the English arrays so layout never breaks.
  function localeNames(locale) {
    const out = { weekdays: WEEKDAYS, weekdaysLong: WEEKDAYS_LONG, months: MONTHS, monthsLong: MONTHS_LONG };
    try {
      const wdShort = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
      const wdLong = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
      const moShort = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
      const moLong = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
      const weekdays = [], weekdaysLong = [];
      for (let i = 0; i < 7; i++) {
        // 2024-01-07 is a Sunday (UTC); add i days for Sun..Sat.
        const d = new Date(Date.UTC(2024, 0, 7 + i));
        weekdays.push(wdShort.format(d)); weekdaysLong.push(wdLong.format(d));
      }
      const months = [], monthsLong = [];
      for (let m = 0; m < 12; m++) {
        const d = new Date(Date.UTC(2024, m, 15));
        months.push(moShort.format(d)); monthsLong.push(moLong.format(d));
      }
      out.weekdays = weekdays; out.weekdaysLong = weekdaysLong; out.months = months; out.monthsLong = monthsLong;
    } catch (e) { /* keep English fallback */ }
    return out;
  }

  // Curated timezone list for the switcher (label, IANA id).
  const TZ_LIST = [
    ['UK · London', 'Europe/London'], ['Ireland · Dublin', 'Europe/Dublin'],
    ['Western Europe · Paris', 'Europe/Paris'], ['Central Europe · Berlin', 'Europe/Berlin'],
    ['Eastern Europe · Athens', 'Europe/Athens'], ['UAE · Dubai', 'Asia/Dubai'],
    ['India · Mumbai', 'Asia/Kolkata'], ['Singapore', 'Asia/Singapore'],
    ['Hong Kong', 'Asia/Hong_Kong'], ['Japan · Tokyo', 'Asia/Tokyo'],
    ['Australia · Sydney', 'Australia/Sydney'], ['US Eastern · New York', 'America/New_York'],
    ['US Central · Chicago', 'America/Chicago'], ['US Mountain · Denver', 'America/Denver'],
    ['US Pacific · Los Angeles', 'America/Los_Angeles'], ['Brazil · São Paulo', 'America/Sao_Paulo'],
    ['UTC', 'UTC'],
  ];

  function detectTz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'; }
    catch (e) { return 'Europe/London'; }
  }
  // Offset in minutes such that UTC + offset = wall-clock time in `tz` for `date`.
  function tzOffset(date, tz) {
    try {
      const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const p = dtf.formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
      const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      return Math.round((asUTC - date.getTime()) / 60000);
    } catch (e) { return 0; }
  }
  // The instant at which the wall-clock y-m-d hh:mm occurs in `tz` (DST-aware).
  function wallToInstant(y, m, d, hh, mm, tz) {
    const guess = Date.UTC(y, m, d, hh, mm, 0);
    let off = tzOffset(new Date(guess), tz);
    let inst = guess - off * 60000;
    off = tzOffset(new Date(inst), tz);
    inst = guess - off * 60000;
    return new Date(inst);
  }
  // Format an instant as a time string in `tz`.
  function fmtTimeTz(inst, tz, hour12) {
    try {
      // hourCycle (not hour12): 'en-GB' + hour12:true resolves to the h11 cycle
      // on some ICU builds, showing noon/midnight as "0:00pm"/"0:00am". h12 pins
      // the 1–12 clock; h23 is the 24-hour view (00:00–23:00).
      return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hourCycle: hour12 ? 'h12' : 'h23' }).format(inst)
        .replace(/[  \s]/g, '').toLowerCase();
    } catch (e) { return ''; }
  }
  // The y/m/d of an instant within `tz`, for cross-midnight detection.
  function ymdInTz(inst, tz) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(inst).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
      return { y: +p.year, m: +p.month, d: +p.day };
    } catch (e) { return null; }
  }
  function todayYmdInTz(tz) { return ymdInTz(new Date(), tz) || { y: 2026, m: 1, d: 1 }; }
  function dateKey(y, m0, d) { return y + '-' + pad2(m0 + 1) + '-' + pad2(d); }       // m0 = 0-based month
  function weekdayOf(y, m0, d) { return new Date(Date.UTC(y, m0, d)).getUTCDay(); }
  function parseHM(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? { h: clampNum(m[1], 0, 23, 9), m: clampNum(m[2], 0, 59, 0) } : null; }
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (/^\s*javascript:/i.test(s)) return '';
    if (/^(https?:|mailto:|tel:|\/|#|\.)/i.test(s)) return s;
    return '';
  }

  const MODE_ICONS = {
    callback: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.27a2 2 0 0 1 2.11-.45c.74.34 1.53.57 2.34.7A2 2 0 0 1 22 16.92z"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 2.08 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.27a2 2 0 0 1 2.11-.45c.74.34 1.53.57 2.34.7A2 2 0 0 1 22 16.92z"/>',
    video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    inperson: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  };
  const DUR_ICON = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';

  const DEFAULTS = {
    heading: 'Book a free consultation',
    subheading: 'Pick a time that suits you and one of our travel experts will be in touch.',
    // Event types (Calendly-style). At least one.
    eventTypes: [
      { id: 'consult', label: 'Travel consultation', mins: 30, mode: 'callback', description: 'A friendly chat about where you fancy going.' },
    ],
    // Availability — host timezone, ranges per weekday (0=Sun..6=Sat)
    timezone: 'Europe/London',
    availability: {
      1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']],
      4: [['09:00', '17:00']], 5: [['09:00', '17:00']],
    },
    blackoutDates: [],          // ['2026-12-25', ...] host dates
    dateRangeDays: 30,          // how far ahead bookable
    minNoticeHours: 4,          // earliest from now
    slotInterval: 0,            // 0 = step by event duration; else minutes
    bufferBefore: 0,            // minutes kept clear before a meeting (connected calendars)
    bufferAfter: 0,             // minutes kept clear after a meeting
    dailyCap: 0,                // max bookings per day (0 = unlimited)
    timeFormat: '12',           // '12' | '24'
    // Intake
    askPhone: true,
    phoneRequired: false,
    questions: [                // custom questions beyond name + email + phone
      { id: 'topic', label: 'What is it about?', type: 'select', required: false, options: ['Tailor-made holiday', 'Cruise', 'Honeymoon', 'Family holiday', 'Something else'] },
      { id: 'notes', label: 'Anything we should know? (optional)', type: 'textarea', required: false },
    ],
    requireConsent: true,
    consentText: 'I am happy to be contacted about my enquiry.',
    // Confirmation
    buttonLabel: '',            // '' = localised default ('Confirm booking' in en)
    successTitle: 'You are booked in',
    successBody: 'We have your time and will be in touch to confirm. A calendar invite is below.',
    addToCalendar: true,
    company: 'our travel team',
    location: '',               // 'Phone call' / video link / address
    // Style
    accent: '#0891B2',
    bg: '#FFFFFF',
    textColor: '#0F172A',
    radius: 16,
    font: 'DM Sans',
    // Submit
    submitUrl: '',              // '' = <script origin>/api/contact
    previewMode: false,
  };

  // True when at least one weekday carries at least one parseable time range.
  // Anything less is a scheduler no one can ever book — never intentional, so
  // it is treated as "unset" and rebuilt (an availability of {} previously
  // slipped past the missing-object check and produced a dead calendar).
  function hasUsableAvailability(av) {
    if (!av || typeof av !== 'object') return false;
    return Object.keys(av).some(k =>
      Array.isArray(av[k]) && av[k].some(r => Array.isArray(r) && parseHM(r[0]) && parseHM(r[1])));
  }

  // Bring a v1 config forward to the v2 shape without losing anything.
  function migrate(cfg) {
    const c = Object.assign({}, cfg || {});
    if (!Array.isArray(c.eventTypes) || !c.eventTypes.length) {
      c.eventTypes = [{ id: 'consult', label: c.heading || 'Consultation', mins: clampNum(c.slotMins, 5, 240, 30), mode: c.mode || 'callback', description: '' }];
    }
    if (!hasUsableAvailability(c.availability)) {
      const wd = Array.isArray(c.workingDays) && c.workingDays.length ? c.workingDays.map(Number) : [1, 2, 3, 4, 5];
      const start = pad2(clampNum(c.startHour, 0, 23, 9)) + ':00';
      const end = pad2(clampNum(c.endHour, 1, 24, 17) % 24) + ':00';
      const av = {}; wd.forEach(d => { av[d] = [[start, end === '00:00' ? '23:59' : end]]; });
      c.availability = av;
    }
    if (c.dateRangeDays == null && c.daysAhead != null) c.dateRangeDays = c.daysAhead;
    if (c.minNoticeHours == null && c.leadTimeHours != null) c.minNoticeHours = c.leadTimeHours;
    if (!Array.isArray(c.questions)) {
      const qs = [];
      if (c.askTopic !== false && Array.isArray(c.topics) && c.topics.length) qs.push({ id: 'topic', label: 'What is it about?', type: 'select', required: false, options: c.topics });
      if (c.askNotes !== false) qs.push({ id: 'notes', label: 'Anything we should know? (optional)', type: 'textarea', required: false });
      if (qs.length) c.questions = qs;
    }
    return c;
  }

  function styles() {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .tga {
        font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: var(--tga-bg, #fff); color: var(--tga-ink, #0F172A);
        border: 1px solid color-mix(in srgb, var(--tga-ink, #0F172A) 12%, transparent);
        border-radius: var(--tga-radius, 16px); overflow: hidden;
        max-width: 840px; box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 14px 44px rgba(15,23,42,.08);
      }
      .tga-grid { display: grid; grid-template-columns: 240px 1fr; min-height: 460px; }
      .tga-aside { padding: 22px 22px 20px; border-right: 1px solid color-mix(in srgb, var(--tga-ink,#0F172A) 10%, transparent); }
      .tga-main { padding: 22px 24px 24px; }
      .tga-badge { width: 40px; height: 40px; border-radius: 11px; margin-bottom: 13px;
        background: color-mix(in srgb, var(--tga-accent, #0891B2) 14%, transparent);
        display: inline-flex; align-items: center; justify-content: center; }
      .tga-badge svg { width: 20px; height: 20px; fill: none; stroke: var(--tga-accent, #0891B2); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .tga-org { font-size: 12.5px; font-weight: 600; opacity: .6; }
      .tga-title { font-size: 19px; font-weight: 700; letter-spacing: -.01em; margin: 3px 0 8px; }
      .tga-sub { font-size: 13px; line-height: 1.5; opacity: .72; margin-bottom: 16px; }
      .tga-meta { font-size: 12.5px; display: flex; flex-direction: column; gap: 9px; opacity: .82; }
      .tga-meta-row { display: flex; gap: 9px; align-items: center; }
      .tga-meta-row svg { width: 15px; height: 15px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; opacity: .7; }

      .tga-events { display: flex; flex-direction: column; gap: 9px; }
      .tga-event { text-align: left; border: 1.5px solid color-mix(in srgb, var(--tga-ink,#0F172A) 13%, transparent);
        background: transparent; color: inherit; font: inherit; border-radius: 12px; padding: 13px 14px; cursor: pointer;
        transition: border-color .14s ease, background .14s ease; }
      .tga-event:hover { background: color-mix(in srgb, var(--tga-ink,#0F172A) 4%, transparent); }
      .tga-event-name { font-size: 14.5px; font-weight: 700; }
      .tga-event-meta { font-size: 12.5px; opacity: .65; margin-top: 3px; display: flex; gap: 7px; align-items: center; }
      .tga-event-desc { font-size: 12.5px; opacity: .7; margin-top: 6px; line-height: 1.45; }

      .tga-step-h { font-size: 15px; font-weight: 700; margin: 0 0 14px; }
      .tga-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .tga-cal-month { font-size: 14.5px; font-weight: 700; }
      .tga-navbtn { width: 30px; height: 30px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--tga-ink,#0F172A) 14%, transparent);
        background: transparent; color: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
      .tga-navbtn:hover:not(:disabled) { background: color-mix(in srgb, var(--tga-ink,#0F172A) 5%, transparent); }
      .tga-navbtn:disabled { opacity: .3; cursor: not-allowed; }
      .tga-navbtn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .tga-dow { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 4px; }
      .tga-dow span { text-align: center; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; opacity: .45; padding: 4px 0; }
      .tga-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
      .tga-cell { aspect-ratio: 1 / 1; min-height: 38px; display: flex; align-items: center; justify-content: center; }
      .tga-day { width: 100%; height: 100%; border-radius: 10px; border: 0; background: transparent; color: inherit; font: inherit;
        font-size: 13.5px; font-weight: 600; cursor: pointer; position: relative; transition: background .14s ease, color .14s ease; }
      .tga-day.avail { background: color-mix(in srgb, var(--tga-accent,#0891B2) 12%, transparent); color: var(--tga-accent, #0891B2); font-weight: 700; }
      .tga-day.avail:hover { background: color-mix(in srgb, var(--tga-accent,#0891B2) 22%, transparent); }
      .tga-day.is-on { background: var(--tga-accent, #0891B2); color: var(--tga-accent-ink, #fff); }
      .tga-day.muted { opacity: .32; cursor: default; }
      .tga-day.today::after { content: ''; position: absolute; left: 50%; bottom: 5px; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 999px; background: currentColor; }

      .tga-times-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px; gap: 8px; }
      .tga-times-date { font-size: 13.5px; font-weight: 700; }
      .tga-fmt { display: inline-flex; border: 1px solid color-mix(in srgb, var(--tga-ink,#0F172A) 14%, transparent); border-radius: 8px; overflow: hidden; }
      .tga-fmt button { border: 0; background: transparent; color: inherit; font: inherit; font-size: 11.5px; font-weight: 700; padding: 5px 9px; cursor: pointer; opacity: .6; }
      .tga-fmt button.is-on { background: color-mix(in srgb, var(--tga-accent,#0891B2) 16%, transparent); color: var(--tga-accent, #0891B2); opacity: 1; }
      .tga-times { display: flex; flex-direction: column; gap: 8px; max-height: 296px; overflow-y: auto; padding-right: 4px; }
      .tga-slot { padding: 11px; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 700; text-align: center;
        border: 1.5px solid color-mix(in srgb, var(--tga-accent,#0891B2) 45%, transparent); background: transparent; color: var(--tga-accent, #0891B2); cursor: pointer;
        transition: background .14s ease, color .14s ease; }
      .tga-slot:hover { background: color-mix(in srgb, var(--tga-accent,#0891B2) 10%, transparent); }
      .tga-slot.is-on { background: var(--tga-accent, #0891B2); color: var(--tga-accent-ink, #fff); border-color: var(--tga-accent, #0891B2); }
      .tga-empty { font-size: 13px; opacity: .6; padding: 18px 0; text-align: center; }

      .tga-tz { margin-top: 16px; font-size: 12px; opacity: .7; display: flex; gap: 7px; align-items: center; }
      .tga-tz svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; }
      .tga-tz select { font: inherit; font-size: 12px; color: inherit; background: transparent; border: 0; border-bottom: 1px dashed currentColor; padding: 1px 2px; cursor: pointer; max-width: 200px; }
      .tga-tz select option { color: #0F172A; }

      .tga-back { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; color: inherit; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; opacity: .7; margin-bottom: 12px; padding: 0; }
      .tga-back:hover { opacity: 1; }
      .tga-back svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .tga-chosen { font-size: 13.5px; padding: 11px 13px; border-radius: 10px; margin-bottom: 16px;
        background: color-mix(in srgb, var(--tga-accent,#0891B2) 10%, transparent); }
      .tga-chosen strong { font-weight: 700; }

      .tga-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
      .tga-field { display: flex; flex-direction: column; gap: 5px; }
      .tga-field.full { grid-column: 1 / -1; }
      .tga-field label { font-size: 12px; font-weight: 600; opacity: .75; }
      .tga-field input, .tga-field select, .tga-field textarea {
        width: 100%; padding: 9px 11px; font: inherit; font-size: 13.5px;
        border: 1px solid color-mix(in srgb, var(--tga-ink, #0F172A) 16%, transparent);
        border-radius: 9px; background: var(--tga-bg, #fff); color: inherit; }
      .tga-field textarea { resize: vertical; min-height: 62px; line-height: 1.5; }
      .tga-field input:focus, .tga-field select:focus, .tga-field textarea:focus {
        outline: none; border-color: var(--tga-accent, #0891B2);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--tga-accent, #0891B2) 22%, transparent); }
      .tga-field.has-err input, .tga-field.has-err select, .tga-field.has-err textarea { border-color: #DC2626; }
      .tga-req { color: #DC2626; }
      .tga-consent { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; line-height: 1.45; opacity: .85; margin-top: 14px; }
      .tga-consent input { margin-top: 2px; flex: 0 0 auto; width: 16px; height: 16px; accent-color: var(--tga-accent, #0891B2); }
      .tga-submit { margin-top: 16px; width: 100%; padding: 13px 18px; border: 0; border-radius: 11px; cursor: pointer;
        font: inherit; font-size: 15px; font-weight: 700; background: var(--tga-accent, #0891B2); color: var(--tga-accent-ink, #fff);
        transition: filter .16s ease, transform .16s ease; }
      .tga-submit:hover:not(:disabled) { filter: brightness(1.05); transform: translateY(-1px); }
      .tga-submit:disabled { opacity: .55; cursor: not-allowed; }
      .tga-form-err { margin-top: 11px; font-size: 13px; color: #DC2626; display: none; }
      .tga-form-err.is-shown { display: block; }

      .tga-success { text-align: center; padding: 34px 24px; max-width: 520px; margin: 0 auto; }
      .tga-success-ico { width: 56px; height: 56px; border-radius: 999px; margin: 0 auto 16px;
        background: color-mix(in srgb, var(--tga-accent, #0891B2) 14%, transparent);
        display: inline-flex; align-items: center; justify-content: center; }
      .tga-success-ico svg { width: 28px; height: 28px; fill: none; stroke: var(--tga-accent, #0891B2); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .tga-success h3 { font-size: 19px; font-weight: 700; margin: 0 0 8px; }
      .tga-success p { font-size: 14px; line-height: 1.55; opacity: .75; margin: 0; }
      .tga-when { margin-top: 14px; font-weight: 700; font-size: 15px; }
      .tga-when small { display: block; font-weight: 500; font-size: 12.5px; opacity: .65; margin-top: 3px; }
      .tga-cal-actions { display: flex; gap: 10px; justify-content: center; margin-top: 18px; flex-wrap: wrap; }
      .tga-cal-btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 15px; border-radius: 9px; cursor: pointer; text-decoration: none;
        font: inherit; font-size: 13px; font-weight: 600; border: 1.5px solid color-mix(in srgb, var(--tga-ink,#0F172A) 16%, transparent); color: inherit; background: transparent; }
      .tga-cal-btn:hover { background: color-mix(in srgb, var(--tga-ink,#0F172A) 5%, transparent); }
      .tga-cal-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .tga-change { margin-top: 16px; }
      .tga-change button { background: transparent; border: 0; color: var(--tga-accent, #0891B2); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: underline; }

      .tga-hidden { display: none !important; }
      @media (max-width: 620px) {
        .tga-grid { grid-template-columns: 1fr; }
        .tga-aside { border-right: 0; border-bottom: 1px solid color-mix(in srgb, var(--tga-ink,#0F172A) 10%, transparent); }
        .tga-fields { grid-template-columns: 1fr; }
      }
    `;
  }

  class TGAppointmentWidget {
    constructor(container, config) {
      this.el = container;
      this.cfg = Object.assign({}, DEFAULTS, migrate(config || {}));
      this.t = makeT(this.cfg);                 // resolve viewer language + UI strings
      this.names = localeNames(localeOf(this.t.lang)); // localised month/weekday names
      this.shadow = container.shadowRoot || (container.attachShadow ? container.attachShadow({ mode: 'open' }) : container);
      this.viewTz = detectTz();
      this.hour12 = this.cfg.timeFormat !== '24';
      this.widgetId = (container.getAttribute && container.getAttribute('data-tg-id')) || this.cfg.widgetId || '';
      this.rescheduleToken = this.cfg.rescheduleToken || '';
      this.adminRescheduleRef = this.cfg.adminRescheduleRef || '';
      this.rescheduleMode = !!(this.rescheduleToken || this.adminRescheduleRef);
      this.backend = !!this.widgetId && !this.cfg.previewMode;
      this.eventIdx = this._initialEventIdx();
      this.viewMonth = null;          // {y, m0}
      this.selectedKey = null;        // host date key 'YYYY-MM-DD'
      this.selectedSlot = null;       // { inst:Date }
      this._build();
    }

    _initialEventIdx() {
      if (this.rescheduleToken || this.adminRescheduleRef) {
        const i = this.cfg.eventTypes.findIndex(e => e.id === this.cfg.rescheduleEventId);
        return i >= 0 ? i : 0;
      }
      return (this.cfg.eventTypes.length === 1) ? 0 : -1;
    }

    _hostDateKey(iso) {
      const v = ymdInTz(new Date(iso), this._hostTz());
      return v ? dateKey(v.y, v.m - 1, v.d) : '';
    }

    // In backend mode, fetch real free/busy slots from the server and rebuild
    // the calendar from them. Falls back silently to the client-side baseline.
    async _fetchServerSlots() {
      try {
        const ev = this._event();
        const from = new Date().toISOString();
        const to = new Date(Date.now() + clampNum(this.cfg.dateRangeDays, 1, 120, 30) * 86400000).toISOString();
        const url = (SCRIPT_ORIGIN || '') + '/api/appointment/availability?widgetId=' + encodeURIComponent(this.widgetId) +
          '&eventId=' + encodeURIComponent(ev.id || '') + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
        const r = await fetch(url, { credentials: 'omit' });
        if (!r.ok) return false;
        const d = await r.json();
        if (!d || !Array.isArray(d.slots)) return false;
        if (d.timezone) this.cfg.timezone = d.timezone;
        const map = {};
        d.slots.forEach(s => { const k = this._hostDateKey(s.startISO); if (k) (map[k] = map[k] || []).push({ inst: new Date(s.startISO) }); });
        this.slotsByDate = map;
        this.availableKeys = Object.keys(map).sort();
        return true;
      } catch (e) { return false; }
    }

    _event() { return this.cfg.eventTypes[this.eventIdx] || this.cfg.eventTypes[0]; }
    _hostTz() { return this.cfg.timezone || 'Europe/London'; }

    // Build slotsByDate for the whole window for the active event type.
    _computeSlots() {
      const c = this.cfg, ev = this._event();
      const hostTz = this._hostTz();
      const dur = clampNum(ev.mins, 5, 480, 30);
      const step = clampNum(c.slotInterval, 0, 240, 0) || dur;
      const rangeDays = clampNum(c.dateRangeDays, 1, 120, 30);
      const notice = Math.max(0, Number(c.minNoticeHours) || 0);
      const earliest = Date.now() + notice * 3600 * 1000;
      const blackout = new Set(Array.isArray(c.blackoutDates) ? c.blackoutDates : []);
      const av = c.availability || {};

      const map = {};
      const t = todayYmdInTz(hostTz);
      let cur = new Date(Date.UTC(t.y, t.m - 1, t.d));
      for (let off = 0; off <= rangeDays; off++) {
        const y = cur.getUTCFullYear(), m0 = cur.getUTCMonth(), d = cur.getUTCDate();
        const wd = weekdayOf(y, m0, d);
        const key = dateKey(y, m0, d);
        cur.setUTCDate(cur.getUTCDate() + 1);
        if (blackout.has(key)) continue;
        const ranges = av[wd] || av[String(wd)] || [];
        if (!ranges.length) continue;
        const slots = [];
        ranges.forEach(r => {
          const a = parseHM(r[0]), b = parseHM(r[1]);
          if (!a || !b) return;
          const startMin = a.h * 60 + a.m, endMin = b.h * 60 + b.m;
          for (let mins = startMin; mins + dur <= endMin; mins += step) {
            const inst = wallToInstant(y, m0, d, Math.floor(mins / 60), mins % 60, hostTz);
            if (inst.getTime() >= earliest) slots.push({ inst });
          }
        });
        if (slots.length) map[key] = slots;
      }
      this.slotsByDate = map;
      this.availableKeys = Object.keys(map).sort();
    }

    _build() {
      const c = this.cfg;
      const accent = safeColor(c.accent, '#0891B2');
      const vars = [
        `--tga-accent:${accent}`,
        `--tga-accent-ink:${inkFor(accent)}`,
        `--tga-bg:${safeColor(c.bg, '#FFFFFF')}`,
        `--tga-ink:${safeColor(c.textColor, '#0F172A')}`,
        `--tga-radius:${clampNum(c.radius, 0, 30, 16)}px`,
        `font-family:'${safeFont(c.font || c.fontFamily)}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
      ].join(';');

      this.shadow.innerHTML = `<style>${styles()}</style>
        <section class="tga" style="${vars}" role="region" aria-label="${esc(c.heading)}">
          <div id="tga-root"></div>
        </section>`;
      this.root = this.shadow.getElementById('tga-root');

      if (this.eventIdx < 0) this._renderEventPicker();
      else { this._computeSlots(); this._renderScheduler(); }
    }

    _asideHtml(showMeta) {
      const c = this.cfg, ev = this._event();
      let meta = '';
      if (showMeta && ev) {
        const icon = MODE_ICONS[ev.mode] || MODE_ICONS.callback;
        meta = `<div class="tga-meta">
          <div class="tga-meta-row"><svg viewBox="0 0 24 24">${DUR_ICON}</svg> ${esc(this.t('minUnit', { n: ev.mins }))}</div>
          <div class="tga-meta-row"><svg viewBox="0 0 24 24">${icon}</svg> ${esc(this._modeLabel(ev.mode))}</div>
          ${c.location ? `<div class="tga-meta-row"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc(c.location)}</div>` : ''}
        </div>`;
      }
      const badgeIcon = (showMeta && ev && MODE_ICONS[ev.mode]) ? MODE_ICONS[ev.mode] : '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>';
      return `<aside class="tga-aside">
        <span class="tga-badge" aria-hidden="true"><svg viewBox="0 0 24 24">${badgeIcon}</svg></span>
        <div class="tga-org">${esc(c.company || '')}</div>
        <div class="tga-title">${esc(showMeta && ev ? ev.label : c.heading)}</div>
        <div class="tga-sub">${esc(showMeta && ev && ev.description ? ev.description : c.subheading)}</div>
        ${meta}
      </aside>`;
    }

    _modeLabel(mode) {
      return ({ callback: this.t('modeCallback'), phone: this.t('modePhone'), video: this.t('modeVideo'), inperson: this.t('modeInperson') })[mode] || this.t('modeCallback');
    }

    // ── Step 0: choose an event type ──
    _renderEventPicker() {
      const c = this.cfg;
      const items = c.eventTypes.map((ev, i) => `<button type="button" class="tga-event" data-ev="${i}">
        <div class="tga-event-name">${esc(ev.label)}</div>
        <div class="tga-event-meta"><svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2">${DUR_ICON}</svg> ${esc(this.t('minUnit', { n: ev.mins }))} · ${esc(this._modeLabel(ev.mode))}</div>
        ${ev.description ? `<div class="tga-event-desc">${esc(ev.description)}</div>` : ''}
      </button>`).join('');
      this.root.innerHTML = `<div class="tga-grid">
        ${this._asideHtml(false)}
        <div class="tga-main">
          <h3 class="tga-step-h" tabindex="-1">${esc(this.t('chooseMeeting'))}</h3>
          <div class="tga-events">${items}</div>
        </div>
      </div>`;
      this.root.querySelector('.tga-events').addEventListener('click', (e) => {
        const b = e.target.closest('[data-ev]'); if (!b) return;
        this._interacted = true;
        this.eventIdx = parseInt(b.getAttribute('data-ev'), 10);
        this.selectedKey = null; this.selectedSlot = null; this.viewMonth = null;
        this._computeSlots(); this._renderScheduler();
      });
      if (this._interacted) this._moveFocus('.tga-step-h');
    }

    // ── Step 1+2: calendar + times ──
    _renderScheduler() {
      const c = this.cfg;
      // No bookable days at all (blackouts, a short range, or the server reports
      // fully booked): show an explicit empty state rather than a dead calendar.
      if (!this.availableKeys || !this.availableKeys.length) {
        this._renderNoAvailability();
        if (this.backend && !this._serverLoaded) this._refineFromServer();
        return;
      }
      if (!this.viewMonth) {
        const first = this.availableKeys[0];
        if (first) { const [y, m] = first.split('-'); this.viewMonth = { y: +y, m0: +m - 1 }; }
        else { const t = todayYmdInTz(this._hostTz()); this.viewMonth = { y: t.y, m0: t.m - 1 }; }
      }
      const multi = c.eventTypes.length > 1;
      this.root.innerHTML = `<div class="tga-grid">
        ${this._asideHtml(true)}
        <div class="tga-main">
          ${multi ? `<button type="button" class="tga-back" id="tga-back-ev"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg> ${esc(this.t('meetings'))}</button>` : ''}
          <div class="tga-sched">
            <div class="tga-cal-wrap">
              <h3 class="tga-step-h" tabindex="-1">${esc(this.t('selectDateTime'))}</h3>
              <div class="tga-cal-head">
                <button type="button" class="tga-navbtn" id="tga-prev" aria-label="${esc(this.t('prevMonth'))}"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
                <span class="tga-cal-month" id="tga-month"></span>
                <button type="button" class="tga-navbtn" id="tga-next" aria-label="${esc(this.t('nextMonth'))}"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>
              </div>
              <div class="tga-dow">${[1,2,3,4,5,6,0].map(wd => `<span>${esc(this.names.weekdays[wd])}</span>`).join('')}</div>
              <div class="tga-cal" id="tga-cal"></div>
              <div class="tga-tz">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20"/></svg>
                <select id="tga-tz" aria-label="${esc(this.t('timezone'))}"></select>
              </div>
            </div>
            <div class="tga-times-wrap tga-hidden" id="tga-times-wrap" aria-live="polite">
              <div class="tga-times-head">
                <span class="tga-times-date" id="tga-times-date" tabindex="-1"></span>
                <span class="tga-fmt" role="group" aria-label="${esc(this.t('timeFormat'))}">
                  <button type="button" data-fmt="12">${esc(this.t('fmt12'))}</button>
                  <button type="button" data-fmt="24">${esc(this.t('fmt24'))}</button>
                </span>
              </div>
              <div class="tga-times" id="tga-times"></div>
            </div>
          </div>
        </div>
      </div>`;

      // Layout: calendar + times side by side inside main
      const sched = this.root.querySelector('.tga-sched');
      sched.style.display = 'grid';
      sched.style.gridTemplateColumns = '1fr';
      sched.style.gap = '20px';

      this._fillTz();
      this._renderMonth();
      this._wireScheduler();
      if (this.selectedKey) this._renderTimes();
      // Only pull focus on a real user-driven step change, never on first mount.
      if (this._interacted) this._moveFocus('.tga-step-h');

      // Backend mode: refine the calendar with real free/busy from the server.
      if (this.backend && !this._serverLoaded) this._refineFromServer();
    }

    // Pull real free/busy from the server and re-paint. Shared by the calendar
    // and the empty state so a fully-booked baseline still gets refined, and a
    // zero-slot server response lands on the empty state instead of crashing.
    _refineFromServer() {
      this._fetchServerSlots().then(ok => {
        this._serverLoaded = ok;
        if (!ok) return;
        if (!this.availableKeys.length) { this._renderNoAvailability(); return; }
        // Keep the current month if it still has availability, else jump to the first open one.
        const cur = this.viewMonth ? (this.viewMonth.y * 100 + this.viewMonth.m0) : -1;
        const hasInView = this.availableKeys.some(k => { const [y, m] = k.split('-'); return (+y * 100 + (+m - 1)) === cur; });
        if (!this.viewMonth || !hasInView) { const [y, m] = this.availableKeys[0].split('-'); this.viewMonth = { y: +y, m0: +m - 1 }; }
        // Was showing the empty state (no calendar mounted): build it now.
        if (!this.shadow.getElementById('tga-cal')) { this._renderScheduler(); return; }
        this._renderMonth();
        if (this.selectedKey && this.slotsByDate[this.selectedKey]) this._renderTimes();
      });
    }

    // Dead-end guard: no bookable days. Explain it and keep an escape (back to
    // the meetings list) reachable even for a single event type.
    _renderNoAvailability() {
      this.root.innerHTML = `<div class="tga-grid">
        ${this._asideHtml(true)}
        <div class="tga-main">
          <button type="button" class="tga-back" id="tga-back-ev"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg> ${esc(this.t('meetings'))}</button>
          <h3 class="tga-step-h" tabindex="-1">${esc(this.t('selectDateTime'))}</h3>
          <div class="tga-empty" role="status" aria-live="polite">${esc(this.t('noneAvailable'))}</div>
        </div>
      </div>`;
      const back = this.shadow.getElementById('tga-back-ev');
      if (back) back.addEventListener('click', () => { this._interacted = true; this.eventIdx = -1; this.viewMonth = null; this.selectedKey = null; this.selectedSlot = null; this._renderEventPicker(); });
      if (this._interacted) this._moveFocus('.tga-step-h');
    }

    // Move keyboard focus to a sensible anchor after a re-render, without
    // scrolling the host page. Safe no-op if the target is missing.
    _moveFocus(sel) {
      try {
        const el = this.shadow.getElementById(sel) || this.shadow.querySelector(sel);
        if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
      } catch (e) { /* noop */ }
    }

    _fillTz() {
      const sel = this.shadow.getElementById('tga-tz');
      const list = TZ_LIST.slice();
      if (!list.some(z => z[1] === this.viewTz)) list.unshift(['Your timezone', this.viewTz]);
      sel.innerHTML = list.map(z => `<option value="${esc(z[1])}"${z[1] === this.viewTz ? ' selected' : ''}>${esc(z[0])}</option>`).join('');
    }

    _wireScheduler() {
      const sh = this.shadow;
      const back = sh.getElementById('tga-back-ev');
      if (back) back.addEventListener('click', () => { this._interacted = true; this.eventIdx = -1; this.viewMonth = null; this.selectedKey = null; this.selectedSlot = null; this._renderEventPicker(); });
      sh.getElementById('tga-prev').addEventListener('click', () => this._shiftMonth(-1));
      sh.getElementById('tga-next').addEventListener('click', () => this._shiftMonth(1));
      sh.getElementById('tga-cal').addEventListener('click', (e) => {
        const b = e.target.closest('[data-key]'); if (!b || b.classList.contains('muted')) return;
        this.selectedKey = b.getAttribute('data-key'); this.selectedSlot = null;
        this._renderMonth(); this._renderTimes();
        // Move focus onto the now-revealed times panel so keyboard users are not
        // dropped back to the top of the calendar on every day selection.
        this._moveFocus('tga-times-date');
      });
      sh.getElementById('tga-tz').addEventListener('change', (e) => { this.viewTz = e.target.value; if (this.selectedKey) this._renderTimes(); });
      sh.querySelector('.tga-fmt').addEventListener('click', (e) => {
        const b = e.target.closest('[data-fmt]'); if (!b) return;
        this.hour12 = b.getAttribute('data-fmt') === '12'; this._renderTimes();
      });
    }

    _monthBounds() {
      // First available month and last month within range, to disable nav.
      const hostTz = this._hostTz();
      const t = todayYmdInTz(hostTz);
      const min = { y: t.y, m0: t.m - 1 };
      const last = new Date(Date.UTC(t.y, t.m - 1, t.d));
      last.setUTCDate(last.getUTCDate() + clampNum(this.cfg.dateRangeDays, 1, 120, 30));
      const max = { y: last.getUTCFullYear(), m0: last.getUTCMonth() };
      return { min, max };
    }

    _shiftMonth(dir) {
      const { min, max } = this._monthBounds();
      let { y, m0 } = this.viewMonth; m0 += dir;
      if (m0 < 0) { m0 = 11; y--; } if (m0 > 11) { m0 = 0; y++; }
      const idx = y * 12 + m0, minIdx = min.y * 12 + min.m0, maxIdx = max.y * 12 + max.m0;
      if (idx < minIdx || idx > maxIdx) return;
      this.viewMonth = { y, m0 };
      this._renderMonth();
    }

    _renderMonth() {
      if (!this.viewMonth) { const t = todayYmdInTz(this._hostTz()); this.viewMonth = { y: t.y, m0: t.m - 1 }; }
      const sh = this.shadow, { y, m0 } = this.viewMonth;
      sh.getElementById('tga-month').textContent = this.names.monthsLong[m0] + ' ' + y;
      const { min, max } = this._monthBounds();
      const idx = y * 12 + m0;
      sh.getElementById('tga-prev').disabled = idx <= (min.y * 12 + min.m0);
      sh.getElementById('tga-next').disabled = idx >= (max.y * 12 + max.m0);

      const firstWd = (weekdayOf(y, m0, 1) + 6) % 7;   // Monday-first offset
      const daysIn = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
      const t = todayYmdInTz(this._hostTz());
      const todayKey = dateKey(t.y, t.m - 1, t.d);
      let cells = '';
      for (let i = 0; i < firstWd; i++) cells += '<div class="tga-cell"></div>';
      for (let d = 1; d <= daysIn; d++) {
        const key = dateKey(y, m0, d);
        const has = !!this.slotsByDate[key];
        const cls = ['tga-day'];
        if (has) cls.push('avail'); else cls.push('muted');
        if (key === this.selectedKey) cls.push('is-on');
        if (key === todayKey) cls.push('today');
        cells += `<div class="tga-cell"><button type="button" class="${cls.join(' ')}" data-key="${key}"${has ? '' : ' tabindex="-1" aria-disabled="true"'}>${d}</button></div>`;
      }
      sh.getElementById('tga-cal').innerHTML = cells;
    }

    _renderTimes() {
      const sh = this.shadow;
      const wrap = sh.getElementById('tga-times-wrap');
      const slots = this.slotsByDate[this.selectedKey] || [];
      const [y, m, d] = this.selectedKey.split('-').map(Number);
      const wd = weekdayOf(y, m - 1, d);
      sh.getElementById('tga-times-date').textContent = `${this.names.weekdaysLong[wd]} ${d} ${this.names.months[m - 1]}`;
      sh.querySelectorAll('.tga-fmt [data-fmt]').forEach(b => b.classList.toggle('is-on', (b.getAttribute('data-fmt') === '12') === this.hour12));
      const host = this._hostTz();
      const out = slots.map((s, i) => {
        const label = fmtTimeTz(s.inst, this.viewTz, this.hour12);
        const cross = this._crossDayMark(s.inst, y, m, d);
        const on = this.selectedSlot && this.selectedSlot.inst.getTime() === s.inst.getTime();
        return `<button type="button" class="tga-slot${on ? ' is-on' : ''}" data-i="${i}">${esc(label)}${cross}</button>`;
      }).join('');
      sh.getElementById('tga-times').innerHTML = out || `<div class="tga-empty">${esc(this.t('noTimesLeft'))}</div>`;
      wrap.classList.remove('tga-hidden');
      const timesEl = sh.getElementById('tga-times');
      timesEl.onclick = (e) => {
        const b = e.target.closest('[data-slot], [data-i]'); if (!b) return;
        const s = slots[parseInt(b.getAttribute('data-i'), 10)]; if (!s) return;
        this.selectedSlot = s;
        this._renderConfirm();
      };
      void host;
    }

    _crossDayMark(inst, y, m, d) {
      const v = ymdInTz(inst, this.viewTz);
      if (!v) return '';
      const base = new Date(Date.UTC(y, m - 1, d)).getTime();
      const vDay = new Date(Date.UTC(v.y, v.m - 1, v.d)).getTime();
      const diff = Math.round((vDay - base) / 86400000);
      if (diff === 0) return '';
      return ` <small style="opacity:.6;font-weight:600">${diff > 0 ? '+' : ''}${diff}d</small>`;
    }

    _whenLines() {
      const ev = this._event();
      let startStr;
      try { startStr = new Intl.DateTimeFormat(localeOf(this.t.lang), { timeZone: this.viewTz, weekday: 'long', day: 'numeric', month: 'long' }).format(this.selectedSlot.inst); }
      catch (e) { startStr = new Intl.DateTimeFormat('en-GB', { timeZone: this.viewTz, weekday: 'long', day: 'numeric', month: 'long' }).format(this.selectedSlot.inst); }
      const timeStr = fmtTimeTz(this.selectedSlot.inst, this.viewTz, this.hour12);
      const tzName = (TZ_LIST.find(z => z[1] === this.viewTz) || [this.viewTz])[0];
      return { main: this.t('at', { date: startStr, time: timeStr }), sub: `${this.t('minUnit', { n: ev.mins })} · ${tzName}`, timeStr, startStr };
    }

    // ── Reschedule mode: confirm a new time, no details form ──
    _renderRescheduleConfirm() {
      const when = this._whenLines();
      this.root.innerHTML = `<div class="tga-grid">
        ${this._asideHtml(true)}
        <div class="tga-main">
          <button type="button" class="tga-back" id="tga-back-cal"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg> ${esc(this.t('back'))}</button>
          <div class="tga-chosen"><strong>${esc(when.main)}</strong><br><span style="opacity:.7">${esc(when.sub)}</span></div>
          <p class="tga-sub" style="margin-bottom:14px">${esc(this.t('moveBooking'))}</p>
          <div class="tga-form-err" id="tga-form-err"></div>
          <button type="button" class="tga-submit" id="tga-submit">${esc(this.t('confirmNewTime'))}</button>
        </div>
      </div>`;
      this.shadow.getElementById('tga-back-cal').addEventListener('click', () => { this._interacted = true; this._renderScheduler(); });
      this.shadow.getElementById('tga-submit').addEventListener('click', () => this._submitReschedule());
      // Anchor focus on the Back control so the step change is announced.
      this._moveFocus('tga-back-cal');
    }

    _submitReschedule() {
      const sh = this.shadow, formErr = sh.getElementById('tga-form-err');
      const btn = sh.getElementById('tga-submit');
      const when = this._whenLines();
      const startMs = this.selectedSlot.inst.getTime();
      if (this.cfg.previewMode) { this._showSuccess(when, startMs, startMs + this._event().mins * 60000); return; }
      btn.disabled = true; const orig = btn.textContent; btn.textContent = this.t('moving');
      const admin = !!this.adminRescheduleRef;
      const url = (SCRIPT_ORIGIN || '') + (admin ? '/api/appointment/admin-action' : '/api/appointment/manage');
      const payload = admin
        ? { ref: this.adminRescheduleRef, action: 'reschedule', startISO: this.selectedSlot.inst.toISOString() }
        : { token: this.rescheduleToken, action: 'reschedule', startISO: this.selectedSlot.inst.toISOString() };
      fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: admin ? 'include' : 'omit',
        body: JSON.stringify(payload),
      }).then(r => r.json().then(b => ({ ok: r.ok, body: b })).catch(() => ({ ok: r.ok, body: {} })))
        .then(res => {
          if (res.ok && res.body.ok) this._showSuccess(when, startMs, startMs + this._event().mins * 60000, { title: this.t('bookingMoved'), body: this.t('bookingMovedBody') });
          else { btn.disabled = false; btn.textContent = orig; formErr.textContent = (res.body && res.body.error) || this.t('couldNotMove'); formErr.classList.add('is-shown'); }
        })
        .catch(() => { btn.disabled = false; btn.textContent = orig; formErr.textContent = this.t('networkError'); formErr.classList.add('is-shown'); });
    }

    // ── Step 3: details ──
    _renderConfirm() {
      if (this.rescheduleMode) return this._renderRescheduleConfirm();
      const c = this.cfg, ev = this._event();
      const when = this._whenLines();
      const qFields = (Array.isArray(c.questions) ? c.questions : []).map((q, i) => {
        const id = 'tgq-' + i;
        const req = q.required ? ' <span class="tga-req">*</span>' : '';
        let control = '';
        if (q.type === 'textarea') control = `<textarea id="${id}" maxlength="800"></textarea>`;
        else if (q.type === 'select') {
          const opts = [`<option value="">${esc(this.t('pleaseChoose'))}</option>`].concat((q.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`)).join('');
          control = `<select id="${id}">${opts}</select>`;
        } else control = `<input id="${id}" type="text" maxlength="200">`;
        return `<div class="tga-field full" data-qfield="${i}"><label for="${id}">${esc(q.label)}${req}</label>${control}</div>`;
      }).join('');

      const phoneHtml = c.askPhone ? `<div class="tga-field">
          <label for="tga-phone">${esc(this.t('phone'))}${c.phoneRequired ? ' <span class="tga-req">*</span>' : ''}</label>
          <input id="tga-phone" type="tel" autocomplete="tel" placeholder="${esc(this.t('phonePlaceholder'))}">
        </div>` : '';
      const consentHtml = c.requireConsent ? `<label class="tga-consent"><input type="checkbox" id="tga-consent"><span>${esc(c.consentText)}</span></label>` : '';

      this.root.innerHTML = `<div class="tga-grid">
        ${this._asideHtml(true)}
        <div class="tga-main">
          <button type="button" class="tga-back" id="tga-back-cal"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg> ${esc(this.t('back'))}</button>
          <div class="tga-chosen"><strong>${esc(when.main)}</strong><br><span style="opacity:.7">${esc(when.sub)}</span></div>
          <div class="tga-fields">
            <div class="tga-field"><label for="tga-name">${esc(this.t('name'))} <span class="tga-req">*</span></label><input id="tga-name" type="text" autocomplete="name" placeholder="${esc(this.t('namePlaceholder'))}"></div>
            <div class="tga-field"><label for="tga-email">${esc(this.t('email'))} <span class="tga-req">*</span></label><input id="tga-email" type="email" autocomplete="email" placeholder="${esc(this.t('emailPlaceholder'))}"></div>
            ${phoneHtml}
            ${qFields}
          </div>
          ${consentHtml}
          <div class="tga-form-err" id="tga-form-err"></div>
          <button type="button" class="tga-submit" id="tga-submit">${esc(c.buttonLabel || this.t('confirmBooking'))}</button>
        </div>
      </div>`;
      void ev;
      this.shadow.getElementById('tga-back-cal').addEventListener('click', () => { this._interacted = true; this._renderScheduler(); });
      this.shadow.getElementById('tga-submit').addEventListener('click', () => this._submit());
      // New step: land focus on the first field so the form is announced.
      this._moveFocus('tga-name');
    }

    _fieldErr(id, on) {
      const input = this.shadow.getElementById(id);
      if (input && input.closest('.tga-field')) input.closest('.tga-field').classList.toggle('has-err', !!on);
    }

    _submit() {
      const sh = this.shadow, c = this.cfg, ev = this._event();
      const formErr = sh.getElementById('tga-form-err');
      formErr.classList.remove('is-shown');

      const name = (sh.getElementById('tga-name').value || '').trim();
      const email = (sh.getElementById('tga-email').value || '').trim();
      const phoneEl = sh.getElementById('tga-phone');
      const phone = phoneEl ? (phoneEl.value || '').trim() : '';
      const consentEl = sh.getElementById('tga-consent');

      let bad = false, onlyEmailFormat = false;
      this._fieldErr('tga-name', false); this._fieldErr('tga-email', false);
      if (!name) { this._fieldErr('tga-name', true); bad = true; }
      if (!emailOk(email)) {
        this._fieldErr('tga-email', true);
        // A non-empty but malformed email gets a specific, friendlier message.
        if (email && !bad) onlyEmailFormat = true;
        bad = true;
      }
      if (c.askPhone && c.phoneRequired && !phone) { this._fieldErr('tga-phone', true); bad = true; onlyEmailFormat = false; }

      const answers = {};
      (Array.isArray(c.questions) ? c.questions : []).forEach((q, i) => {
        const el = sh.getElementById('tgq-' + i);
        const v = el ? (el.value || '').trim() : '';
        answers[q.id || ('q' + i)] = v;
        const wrap = sh.querySelector('[data-qfield="' + i + '"]');
        if (wrap) wrap.classList.toggle('has-err', !!(q.required && !v));
        if (q.required && !v) { bad = true; onlyEmailFormat = false; }
      });

      if (bad) { formErr.textContent = onlyEmailFormat ? this.t('validEmail') : this.t('checkFields'); formErr.classList.add('is-shown'); return; }
      if (c.requireConsent && consentEl && !consentEl.checked) { formErr.textContent = this.t('tickConsent'); formErr.classList.add('is-shown'); return; }

      const when = this._whenLines();
      const startMs = this.selectedSlot.inst.getTime();
      const endMs = startMs + ev.mins * 60000;
      const ref = 'apt_' + startMs.toString(36) + Math.random().toString(36).slice(2, 6);

      const lines = [
        'Appointment request via website widget.',
        'Meeting: ' + ev.label + ' (' + ev.mins + ' min, ' + this._modeLabel(ev.mode) + ').',
        'When: ' + when.main + ' (' + this.viewTz + ').',
        'Reference: ' + ref + '.',
      ];
      Object.keys(answers).forEach(k => { if (answers[k]) lines.push(k + ': ' + answers[k]); });

      const payload = {
        name, email, phone, message: lines.join('\n'),
        appointment: {
          ref, eventId: ev.id, eventLabel: ev.label, durationMins: ev.mins, mode: ev.mode,
          startISO: new Date(startMs).toISOString(), endISO: new Date(endMs).toISOString(),
          visitorTimezone: this.viewTz, hostTimezone: this._hostTz(), answers,
        },
        widgetId: (this.el.getAttribute && this.el.getAttribute('data-tg-id')) || '',
        sourceUrl: (typeof window !== 'undefined' && window.location) ? window.location.href : '',
        website: '', ts: this._mountedAt || Date.now(),
      };

      const btn = sh.getElementById('tga-submit');
      if (c.previewMode) { this._showSuccess(when, startMs, endMs); return; }
      btn.disabled = true; const orig = btn.textContent; btn.textContent = this.t('sending');

      // Backend mode posts to the booking endpoint (real calendar, manage link);
      // otherwise it falls back to the generic contact endpoint.
      const backend = this.backend;
      const url = backend ? (SCRIPT_ORIGIN + '/api/appointment/book')
        : ((c.submitUrl && /^https?:\/\//i.test(c.submitUrl)) ? c.submitUrl : (SCRIPT_ORIGIN + '/api/contact'));
      if (backend) { payload.eventId = ev.id; payload.startISO = new Date(startMs).toISOString(); payload.visitorTimezone = this.viewTz; }

      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => r.json().then(b => ({ ok: r.ok, body: b })).catch(() => ({ ok: r.ok, body: {} })))
        .then(res => {
          if (res.ok && (res.body.ok === undefined || res.body.ok)) this._showSuccess(when, startMs, endMs, null, res.body);
          else { btn.disabled = false; btn.textContent = orig; formErr.textContent = (res.body && res.body.error) || this.t('somethingWrong'); formErr.classList.add('is-shown'); }
        })
        .catch(() => { btn.disabled = false; btn.textContent = orig; formErr.textContent = this.t('networkError'); formErr.classList.add('is-shown'); });
    }

    _calTitle() {
      const ev = this._event(), c = this.cfg;
      return (ev.label || 'Appointment') + ' with ' + (c.company || 'us');
    }
    _icsStamp(ms) {
      const d = new Date(ms);
      return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + '00Z';
    }
    _googleUrl(startMs, endMs) {
      const c = this.cfg;
      const p = new URLSearchParams({
        action: 'TEMPLATE', text: this._calTitle(),
        dates: this._icsStamp(startMs) + '/' + this._icsStamp(endMs),
        details: this.cfg.successBody || '', location: c.location || '',
      });
      return 'https://calendar.google.com/calendar/render?' + p.toString();
    }
    _icsUrl(startMs, endMs) {
      const c = this.cfg;
      const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Travelgenix//Appointment//EN', 'BEGIN:VEVENT',
        'UID:' + this._icsStamp(startMs) + '-' + Math.random().toString(36).slice(2) + '@travelgenix',
        'DTSTAMP:' + this._icsStamp(Date.now()),
        'DTSTART:' + this._icsStamp(startMs), 'DTEND:' + this._icsStamp(endMs),
        'SUMMARY:' + this._calTitle().replace(/[,;\\]/g, ' '),
        'DESCRIPTION:' + String(c.successBody || '').replace(/[,;\\]/g, ' ').replace(/\n/g, ' '),
        c.location ? 'LOCATION:' + String(c.location).replace(/[,;\\]/g, ' ') : '',
        'END:VEVENT', 'END:VCALENDAR',
      ].filter(Boolean).join('\r\n');
      try { return URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); }
      catch (e) { return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics); }
    }

    _showSuccess(when, startMs, endMs, override, serverBody) {
      const c = this.cfg;
      const title = (override && override.title) || c.successTitle;
      const bodyText = (override && override.body) || c.successBody;
      let cal = '';
      if (c.addToCalendar && !this.rescheduleMode) {
        const g = safeUrl(this._googleUrl(startMs, endMs));
        const ics = this._icsUrl(startMs, endMs);
        cal = `<div class="tga-cal-actions">
          <a class="tga-cal-btn" href="${esc(g)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${esc(this.t('addGoogle'))}</a>
          <a class="tga-cal-btn" href="${esc(ics)}" download="appointment.ics"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${esc(this.t('downloadIcs'))}</a>
        </div>`;
      }
      // A real backend booking returns a manage link (reschedule / cancel).
      let foot = '';
      const manageUrl = serverBody && safeUrl(serverBody.manageUrl);
      if (manageUrl) foot = `<div class="tga-change"><a href="${esc(manageUrl)}" style="color:var(--tga-accent,#0891B2);font-weight:600;text-decoration:underline;font-size:13px">${esc(this.t('manageBooking'))}</a></div>`;
      else if (!this.rescheduleMode && !this.backend) foot = `<div class="tga-change"><button type="button" id="tga-again">${esc(this.t('needDifferent'))}</button></div>`;

      this.root.innerHTML = `<div class="tga-success" role="status" aria-live="polite">
        <span class="tga-success-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>
        <h3>${esc(title)}</h3>
        <p>${esc(bodyText)}</p>
        <div class="tga-when">${esc(when.main)}<small>${esc(when.sub)}</small></div>
        ${cal}
        ${foot}
      </div>`;
      const again = this.shadow.getElementById('tga-again');
      if (again) again.addEventListener('click', () => { this._interacted = true; this.selectedSlot = null; this._computeSlots(); this._renderScheduler(); });
    }

    update(newConfig) {
      this.cfg = Object.assign({}, DEFAULTS, migrate(newConfig || {}));
      this.t = makeT(this.cfg);
      this.names = localeNames(localeOf(this.t.lang));
      this.viewTz = detectTz();
      this.hour12 = this.cfg.timeFormat !== '24';
      this.widgetId = (this.el.getAttribute && this.el.getAttribute('data-tg-id')) || this.cfg.widgetId || '';
      this.rescheduleToken = this.cfg.rescheduleToken || '';
      this.adminRescheduleRef = this.cfg.adminRescheduleRef || '';
      this.rescheduleMode = !!(this.rescheduleToken || this.adminRescheduleRef);
      this.backend = !!this.widgetId && !this.cfg.previewMode;
      this.eventIdx = this._initialEventIdx();
      this._serverLoaded = false;
      this._interacted = false;
      this.viewMonth = null; this.selectedKey = null; this.selectedSlot = null;
      this._build();
    }

    destroy(keepShadow) { if (!keepShadow && this.shadow) this.shadow.innerHTML = ''; }
  }

  // ─── Boot ───────────────────────────────────────────────────
  async function fetchConfig(id) {
    try {
      const r = await fetch(API_BASE + '?id=' + encodeURIComponent(id), { method: 'GET', credentials: 'omit' });
      if (!r.ok) return null;
      const data = await r.json();
      return data && data.config ? data.config : null;
    } catch (e) { return null; }
  }
  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="appointment"]');
    for (const el of containers) {
      if (el.__tgInited) continue;
      el.__tgInited = true;
      let cfg = null;
      const inline = el.getAttribute('data-tg-config');
      if (inline) { try { cfg = JSON.parse(inline); } catch (e) { cfg = null; } }
      else { const id = el.getAttribute('data-tg-id'); if (id) cfg = await fetchConfig(id); }
      try { const w = new TGAppointmentWidget(el, cfg || {}); w._mountedAt = Date.now(); }
      catch (e) { if (window.console) console.error('[TGAppointment] init failed', e); }
    }
  }

  window.TGAppointmentWidget = TGAppointmentWidget;
  window.__TG_APPOINTMENT_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
