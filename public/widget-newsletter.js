/**
 * Travelgenix Newsletter Signup Widget v1.0.0
 * Self-contained, embeddable widget with 5 layouts:
 *   - inline    (horizontal email + button)
 *   - card      (vertical card with optional name field, consent, success state)
 *   - popup     (button or text-link trigger that opens a modal)
 *   - footer    (sticky bar pinned to bottom of viewport)
 *   - vertical  (slim side tab on left or right edge that pops out a card)
 *
 * Zero dependencies. Shadow DOM. Posts leads to /api/newsletter-submit
 * which routes them through the unified lead-routing pipeline (Mailchimp,
 * Brevo, MailerLite, Constant Contact, Klaviyo, plus webhook/sheets/email).
 *
 * Usage:
 *   <div data-tg-widget="newsletter" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-newsletter.js"></script>
 *
 * Public API on the widget instance:
 *   widget.open()      — open modal (popup) or expand panel (vertical)
 *   widget.close()     — close modal/panel
 *   widget.toggle()    — toggle
 *   widget.isOpen()    — boolean
 *   widget.update(cfg) — replace config and re-render
 *   widget.destroy()   — tear down
 */
(function () {
  'use strict';

    /**
   * Resolve the API base URL.
   *
   * BACKGROUND: This widget script is hosted on widgets.travelify.io and
   * embedded on customer sites. The widget must call back to its host
   * (widgets.travelify.io/api/widget-config) — NOT to the customer's
   * site. A relative '/api/...' URL resolves to the customer's origin
   * and 404s.
   *
   * Resolution order:
   *   1. window.__TG_WIDGET_API__ — explicit opt-in for advanced embeds
   *   2. Origin of document.currentScript at module-init time
   *   3. Scan script tags for the widget filename (handles async/defer)
   *   4. Relative URL — last resort, only works on same-origin pages
   */
  function resolveApiBase() {
    if (typeof window === 'undefined') return '/api/widget-config';
    if (window.__TG_WIDGET_API__) return window.__TG_WIDGET_API__;
    try {
      const me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/widget-config';
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        const s = scripts[i].src || '';
        if (/\/widget\-newsletter\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/widget-config';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/widget-config';
  }

  const API_BASE = resolveApiBase();
  const SUBMIT_BASE = (function () {
    /* Resolve the SUBMIT_BASE URL. Yesterday's fix patched widget-config but this
       secondary API was left with a relative default ('/api/newsletter-submit'), which
       on customer sites resolves to the customer's domain and 404s. Same
       resolution strategy as the API_BASE resolver above. */
    if (typeof window === 'undefined') return '/api/newsletter-submit';
    if (window.__TG_NEWSLETTER_SUBMIT__) return window.__TG_NEWSLETTER_SUBMIT__;
    try {
      var me = document.currentScript;
      if (me && me.src) return new URL(me.src).origin + '/api/newsletter-submit';
      var scripts = document.getElementsByTagName('script');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i].src || '';
        if (/\/widget\-newsletter\.js(\?|$|#)/.test(s)) {
          return new URL(s).origin + '/api/newsletter-submit';
        }
      }
    } catch (e) { /* fall through */ }
    return '/api/newsletter-submit';
  })();
  const VERSION = '1.0.2';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only: validation / error / status messages, plus the
  // author-overridable default labels (button, placeholders, success copy and
  // so on) shown when the author has not supplied their own. English is the
  // source + fallback. Author-supplied copy is never translated.
  const MESSAGES = {
    en: {
      invalidEmail: 'Please enter a valid email address.',
      consentRequired: 'Please tick the consent box to continue.',
      genericError: 'Something went wrong. Please try again.',
      alreadySubscribed: "You're already subscribed.",
      ariaEmail: 'Email address',
      ariaFirstName: 'First name',
      ariaClose: 'Close',
      ariaDismiss: 'Dismiss',
      privacyPolicy: 'Privacy policy',
      // Author-overridable defaults
      title: 'Get travel inspiration in your inbox',
      subtitle: 'Hand-picked destinations and exclusive offers. One thoughtful email a month.',
      emailPlaceholder: 'your@email.com',
      firstNamePlaceholder: 'First name',
      buttonLabel: 'Subscribe',
      successTitle: "You're in!",
      successMessage: 'Check your inbox for a welcome email.',
      consentLabel: 'I agree to receive travel inspiration emails.',
      triggerLabel: 'Subscribe to our newsletter',
      tabLabel: 'Newsletter',
    },
    fr: {
      invalidEmail: 'Veuillez saisir une adresse e-mail valide.',
      consentRequired: 'Veuillez cocher la case de consentement pour continuer.',
      genericError: "Une erreur s'est produite. Veuillez réessayer.",
      alreadySubscribed: 'Vous êtes déjà abonné.',
      ariaEmail: 'Adresse e-mail',
      ariaFirstName: 'Prénom',
      ariaClose: 'Fermer',
      ariaDismiss: 'Fermer',
      privacyPolicy: 'Politique de confidentialité',
      title: 'Recevez l\'inspiration voyage dans votre boîte mail',
      subtitle: 'Des destinations triées sur le volet et des offres exclusives. Un e-mail soigné par mois.',
      emailPlaceholder: 'votre@email.com',
      firstNamePlaceholder: 'Prénom',
      buttonLabel: "S'abonner",
      successTitle: "C'est fait !",
      successMessage: 'Consultez votre boîte mail pour un e-mail de bienvenue.',
      consentLabel: "J'accepte de recevoir des e-mails d'inspiration voyage.",
      triggerLabel: 'Abonnez-vous à notre newsletter',
      tabLabel: 'Newsletter',
    },
    de: {
      invalidEmail: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
      consentRequired: 'Bitte kreuzen Sie das Einwilligungskästchen an, um fortzufahren.',
      genericError: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
      alreadySubscribed: 'Sie sind bereits abonniert.',
      ariaEmail: 'E-Mail-Adresse',
      ariaFirstName: 'Vorname',
      ariaClose: 'Schließen',
      ariaDismiss: 'Schließen',
      privacyPolicy: 'Datenschutzerklärung',
      title: 'Reiseinspiration in Ihrem Postfach',
      subtitle: 'Handverlesene Reiseziele und exklusive Angebote. Eine durchdachte E-Mail pro Monat.',
      emailPlaceholder: 'ihre@email.de',
      firstNamePlaceholder: 'Vorname',
      buttonLabel: 'Abonnieren',
      successTitle: 'Geschafft!',
      successMessage: 'Schauen Sie in Ihr Postfach für eine Willkommens-E-Mail.',
      consentLabel: 'Ich bin damit einverstanden, Reiseinspirations-E-Mails zu erhalten.',
      triggerLabel: 'Abonnieren Sie unseren Newsletter',
      tabLabel: 'Newsletter',
    },
    es: {
      invalidEmail: 'Introduce una dirección de correo electrónico válida.',
      consentRequired: 'Marca la casilla de consentimiento para continuar.',
      genericError: 'Algo salió mal. Inténtalo de nuevo.',
      alreadySubscribed: 'Ya estás suscrito.',
      ariaEmail: 'Correo electrónico',
      ariaFirstName: 'Nombre',
      ariaClose: 'Cerrar',
      ariaDismiss: 'Cerrar',
      privacyPolicy: 'Política de privacidad',
      title: 'Recibe inspiración de viajes en tu bandeja de entrada',
      subtitle: 'Destinos seleccionados y ofertas exclusivas. Un correo cuidado al mes.',
      emailPlaceholder: 'tu@email.com',
      firstNamePlaceholder: 'Nombre',
      buttonLabel: 'Suscribirse',
      successTitle: '¡Listo!',
      successMessage: 'Revisa tu bandeja de entrada para ver el correo de bienvenida.',
      consentLabel: 'Acepto recibir correos de inspiración de viajes.',
      triggerLabel: 'Suscríbete a nuestra newsletter',
      tabLabel: 'Newsletter',
    },
    it: {
      invalidEmail: 'Inserisci un indirizzo email valido.',
      consentRequired: 'Spunta la casella di consenso per continuare.',
      genericError: 'Qualcosa è andato storto. Riprova.',
      alreadySubscribed: 'Sei già iscritto.',
      ariaEmail: 'Indirizzo email',
      ariaFirstName: 'Nome',
      ariaClose: 'Chiudi',
      ariaDismiss: 'Chiudi',
      privacyPolicy: 'Informativa sulla privacy',
      title: 'Ricevi ispirazione di viaggio nella tua casella di posta',
      subtitle: 'Destinazioni selezionate e offerte esclusive. Una email curata al mese.',
      emailPlaceholder: 'tua@email.com',
      firstNamePlaceholder: 'Nome',
      buttonLabel: 'Iscriviti',
      successTitle: 'Fatto!',
      successMessage: 'Controlla la tua casella di posta per l\'email di benvenuto.',
      consentLabel: 'Acconsento a ricevere email di ispirazione di viaggio.',
      triggerLabel: 'Iscriviti alla nostra newsletter',
      tabLabel: 'Newsletter',
    },
    ro: {
      invalidEmail: 'Introduceți o adresă de e-mail validă.',
      consentRequired: 'Bifați caseta de consimțământ pentru a continua.',
      genericError: 'Ceva nu a funcționat. Încercați din nou.',
      alreadySubscribed: 'Sunteți deja abonat.',
      ariaEmail: 'Adresă de e-mail',
      ariaFirstName: 'Prenume',
      ariaClose: 'Închide',
      ariaDismiss: 'Închide',
      privacyPolicy: 'Politica de confidențialitate',
      title: 'Primiți inspirație de călătorie în căsuța de e-mail',
      subtitle: 'Destinații alese cu grijă și oferte exclusive. Un e-mail bine gândit pe lună.',
      emailPlaceholder: 'tu@email.com',
      firstNamePlaceholder: 'Prenume',
      buttonLabel: 'Abonează-te',
      successTitle: 'Gata!',
      successMessage: 'Verificați căsuța de e-mail pentru un mesaj de bun venit.',
      consentLabel: 'Sunt de acord să primesc e-mailuri cu inspirație de călătorie.',
      triggerLabel: 'Abonați-vă la newsletterul nostru',
      tabLabel: 'Newsletter',
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

  // ---------- Helpers ----------
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isEmail(s) {
    if (typeof s !== 'string') return false;
    const v = s.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
  }

  function safeFontFamily(name) {
    // Whitelist of safe font tokens; everything else falls back to system
    const ALLOWED = ['Inter', 'system-ui', 'Arial', 'Helvetica', 'Georgia', 'Roboto', 'Open Sans', 'Lato', 'Poppins', 'Nunito', 'Montserrat', 'Source Sans Pro', 'Source Sans 3', 'Work Sans', 'Plus Jakarta Sans', 'DM Sans'];
    if (typeof name !== 'string') return 'Inter, system-ui, sans-serif';
    if (ALLOWED.includes(name)) return `'${name}', system-ui, sans-serif`;
    return 'Inter, system-ui, sans-serif';
  }

  function lighten(hex, pct) {
    // Naive hex lightening for hover states (fallback if color-mix unsupported)
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return hex || '#1B2B5B';
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = Math.min(255, parseInt(h.slice(0, 2), 16) + Math.round(255 * pct));
    const g = Math.min(255, parseInt(h.slice(2, 4), 16) + Math.round(255 * pct));
    const b = Math.min(255, parseInt(h.slice(4, 6), 16) + Math.round(255 * pct));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function svgIcon(name, size) {
    const s = size || 16;
    const SVGS = {
      mail:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>`,
      check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="20 6 9 17 4 12"/></svg>`,
      close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" width="${s}" height="${s}"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      spinner: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="${s}" height="${s}" style="animation:tgnl-spin 0.8s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>`,
    };
    return SVGS[name] || '';
  }

  // ---------- Styles ----------
  const STYLES = `
    :host {
      all: initial;
      display: block;
      font-family: var(--tgnl-font, 'Inter', system-ui, sans-serif);
      color: var(--tgnl-text, #0F172A);
      line-height: 1.5;
      letter-spacing: -0.005em;
      -webkit-font-smoothing: antialiased;
      box-sizing: border-box;
    }
    *, *::before, *::after { box-sizing: border-box; }

    .tgnl-root {
      --tgnl-brand: #1B2B5B;
      --tgnl-brand-text: #FFFFFF;
      --tgnl-brand-hover: #2A3F7A;
      --tgnl-accent: #00B4D8;
      --tgnl-card: #FFFFFF;
      --tgnl-text: #0F172A;
      --tgnl-text-2: #475569;
      --tgnl-text-3: #94A3B8;
      --tgnl-border: #E2E8F0;
      --tgnl-border-input: #E2E8F0;
      --tgnl-success: #10B981;
      --tgnl-success-bg: #ECFDF5;
      --tgnl-success-border: #A7F3D0;
      --tgnl-success-text: #047857;
      --tgnl-error: #EF4444;
      --tgnl-error-bg: #FEF2F2;
      --tgnl-error-border: #FECACA;
      --tgnl-error-text: #B91C1C;
      --tgnl-radius: 14px;
      --tgnl-radius-input: 10px;
      --tgnl-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.04);
      --tgnl-shadow-lg: 0 24px 60px -12px rgba(15, 23, 42, 0.25), 0 8px 20px -4px rgba(15, 23, 42, 0.1);
    }
    .tgnl-root[data-theme="dark"] {
      --tgnl-card: #1E293B;
      --tgnl-text: #F1F5F9;
      --tgnl-text-2: #CBD5E1;
      --tgnl-text-3: #64748B;
      --tgnl-border: #334155;
      --tgnl-border-input: #334155;
      --tgnl-shadow: 0 4px 14px -2px rgba(0, 0, 0, 0.45);
      --tgnl-shadow-lg: 0 24px 60px -12px rgba(0, 0, 0, 0.6);
      --tgnl-success-bg: rgba(16, 185, 129, 0.12);
      --tgnl-success-border: rgba(16, 185, 129, 0.3);
      --tgnl-success-text: #34D399;
      --tgnl-error-bg: rgba(239, 68, 68, 0.12);
      --tgnl-error-border: rgba(239, 68, 68, 0.3);
      --tgnl-error-text: #FCA5A5;
    }

    @keyframes tgnl-spin { to { transform: rotate(360deg); } }
    @keyframes tgnl-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes tgnl-modal-in {
      from { opacity: 0; transform: translateY(8px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* ============= Shared form bits ============= */
    .tgnl-input {
      appearance: none;
      width: 100%;
      border: 1px solid var(--tgnl-border-input);
      background: var(--tgnl-card);
      color: var(--tgnl-text);
      font-family: inherit;
      font-size: 14px;
      padding: 12px 14px;
      border-radius: var(--tgnl-radius-input);
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }
    .tgnl-input::placeholder { color: var(--tgnl-text-3); }
    .tgnl-input:focus {
      outline: none;
      border-color: var(--tgnl-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgnl-accent) 22%, transparent);
    }
    .tgnl-input[aria-invalid="true"] {
      border-color: var(--tgnl-error);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgnl-error) 22%, transparent);
    }

    .tgnl-btn {
      appearance: none;
      border: 0;
      background: var(--tgnl-brand);
      color: var(--tgnl-brand-text);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 12px 22px;
      border-radius: var(--tgnl-radius-input);
      cursor: pointer;
      transition: background 150ms ease, transform 100ms ease;
      letter-spacing: -0.005em;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 44px;
    }
    .tgnl-btn:hover { background: var(--tgnl-brand-hover); }
    .tgnl-btn:active { transform: scale(0.98); }
    .tgnl-btn:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--tgnl-accent) 50%, transparent);
      outline-offset: 2px;
    }
    .tgnl-btn[disabled] {
      opacity: 0.7;
      cursor: not-allowed;
      transform: none;
    }
    .tgnl-btn-spinner { display: inline-flex; }

    .tgnl-checkbox {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 6px 0 4px;
      font-size: 12.5px;
      color: var(--tgnl-text-2);
      cursor: pointer;
      line-height: 1.45;
    }
    .tgnl-checkbox input { margin-top: 2px; cursor: pointer; flex-shrink: 0; }
    .tgnl-checkbox a { color: var(--tgnl-text-2); text-decoration: underline; }

    .tgnl-error-msg {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
      padding: 10px 14px;
      background: var(--tgnl-error-bg);
      border: 1px solid var(--tgnl-error-border);
      border-radius: var(--tgnl-radius-input);
      color: var(--tgnl-error-text);
      font-size: 13px;
      animation: tgnl-fade-in 200ms ease;
    }
    .tgnl-error-msg svg { flex-shrink: 0; }

    .tgnl-consent-text {
      margin-top: 10px;
      font-size: 12px;
      color: var(--tgnl-text-3);
      line-height: 1.5;
    }
    .tgnl-consent-text a { color: var(--tgnl-text-2); text-decoration: underline; }

    /* ============= Inline layout ============= */
    .tgnl-inline-form {
      display: flex;
      align-items: stretch;
      gap: 8px;
      width: 100%;
      max-width: 640px;
    }
    .tgnl-inline-form .tgnl-input { flex: 1; min-width: 0; }
    .tgnl-inline-form .tgnl-btn { flex-shrink: 0; }

    .tgnl-inline-success {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 18px;
      background: var(--tgnl-success-bg);
      border: 1px solid var(--tgnl-success-border);
      border-radius: var(--tgnl-radius-input);
      color: var(--tgnl-success-text);
      font-size: 14px;
      font-weight: 500;
      max-width: 640px;
      animation: tgnl-fade-in 220ms ease;
    }
    .tgnl-inline-success svg { flex-shrink: 0; color: var(--tgnl-success); }
    .tgnl-inline-success-strong { font-weight: 700; }

    /* ============= Card layout ============= */
    .tgnl-card {
      background: var(--tgnl-card);
      border: 1px solid var(--tgnl-border);
      border-radius: var(--tgnl-radius);
      padding: 36px 32px;
      max-width: 440px;
      box-shadow: var(--tgnl-shadow);
    }
    .tgnl-card-icon {
      width: 48px; height: 48px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--tgnl-brand), var(--tgnl-brand-hover));
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      color: var(--tgnl-brand-text);
    }
    .tgnl-card-title {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 8px;
      letter-spacing: -0.02em;
      line-height: 1.25;
      color: var(--tgnl-text);
    }
    .tgnl-card-sub {
      font-size: 14px;
      color: var(--tgnl-text-2);
      margin: 0 0 24px;
      line-height: 1.55;
    }
    .tgnl-card-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .tgnl-card-form .tgnl-btn { margin-top: 4px; padding-top: 14px; padding-bottom: 14px; }

    .tgnl-card-success {
      text-align: center;
      padding: 16px 0 8px;
      animation: tgnl-fade-in 240ms ease;
    }
    .tgnl-card-success-icon {
      width: 56px; height: 56px;
      border-radius: 50%;
      background: var(--tgnl-success-bg);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      color: var(--tgnl-success);
    }
    .tgnl-card-success-title {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 6px;
      letter-spacing: -0.015em;
      color: var(--tgnl-text);
    }
    .tgnl-card-success-sub {
      font-size: 13.5px;
      color: var(--tgnl-text-2);
      margin: 0;
    }

    /* ============= Popup trigger + modal ============= */
    .tgnl-popup-trigger {
      appearance: none;
      border: 0;
      background: var(--tgnl-brand);
      color: var(--tgnl-brand-text);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 12px 22px;
      border-radius: var(--tgnl-radius-input);
      cursor: pointer;
      transition: background 150ms ease, transform 100ms ease;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.005em;
    }
    .tgnl-popup-trigger:hover { background: var(--tgnl-brand-hover); }
    .tgnl-popup-trigger:active { transform: scale(0.98); }
    .tgnl-popup-trigger.is-link {
      background: transparent;
      color: var(--tgnl-brand);
      padding: 8px 4px;
      text-decoration: underline;
      text-underline-offset: 4px;
    }
    .tgnl-popup-trigger.is-link:hover { color: var(--tgnl-brand-hover); background: transparent; }

    .tgnl-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 9000;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      visibility: hidden;
      transition: opacity 200ms ease, visibility 0ms linear 200ms;
    }
    .tgnl-modal-overlay[data-open="true"] {
      opacity: 1;
      visibility: visible;
      transition: opacity 200ms ease, visibility 0ms linear 0ms;
    }
    .tgnl-modal {
      background: var(--tgnl-card);
      border-radius: var(--tgnl-radius);
      width: 100%;
      max-width: 420px;
      padding: 36px 32px;
      box-shadow: var(--tgnl-shadow-lg);
      position: relative;
      transform: translateY(8px) scale(0.96);
      opacity: 0;
      transition: transform 220ms cubic-bezier(.2,.8,.2,1), opacity 200ms ease;
    }
    .tgnl-modal-overlay[data-open="true"] .tgnl-modal {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
    .tgnl-modal-close {
      position: absolute;
      top: 14px; right: 14px;
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--tgnl-text-3);
      width: 32px; height: 32px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 150ms ease, color 150ms ease;
    }
    .tgnl-modal-close:hover { background: color-mix(in srgb, var(--tgnl-text-3) 12%, transparent); color: var(--tgnl-text); }

    /* ============= Footer bar ============= */
    .tgnl-footer {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 9000;
      background: var(--tgnl-brand);
      color: var(--tgnl-brand-text);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 20px;
      box-shadow: 0 -4px 16px -4px rgba(15, 23, 42, 0.16);
      transform: translateY(100%);
      transition: transform 320ms cubic-bezier(.2,.8,.2,1);
    }
    .tgnl-footer[data-show="true"] { transform: translateY(0); }
    /* Consent checkbox sits in the footer text column — inherit the bar's light
       text so it stays readable on the brand background. */
    .tgnl-footer .tgnl-checkbox { color: var(--tgnl-brand-text); font-size: 11.5px; margin: 6px 0 0; opacity: .95; }
    .tgnl-footer .tgnl-checkbox a { color: var(--tgnl-brand-text); }
    .tgnl-footer-text { flex: 1; min-width: 0; }
    .tgnl-footer-title {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 2px;
      letter-spacing: -0.005em;
    }
    .tgnl-footer-sub {
      font-size: 12.5px;
      margin: 0;
      opacity: 0.78;
      line-height: 1.4;
    }
    .tgnl-footer-form {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    .tgnl-footer-input {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.1);
      color: #FFFFFF;
      font-family: inherit;
      font-size: 13px;
      padding: 10px 14px;
      border-radius: var(--tgnl-radius-input);
      width: 240px;
      min-height: 40px;
      transition: background 150ms ease, border-color 150ms ease;
    }
    .tgnl-footer-input::placeholder { color: rgba(255, 255, 255, 0.6); }
    .tgnl-footer-input:focus {
      outline: none;
      background: rgba(255, 255, 255, 0.18);
      border-color: var(--tgnl-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgnl-accent) 30%, transparent);
    }
    .tgnl-footer-btn {
      appearance: none;
      border: 0;
      background: var(--tgnl-accent);
      color: #0F172A;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      padding: 10px 18px;
      border-radius: var(--tgnl-radius-input);
      cursor: pointer;
      white-space: nowrap;
      transition: background 150ms ease, transform 100ms ease;
      letter-spacing: -0.005em;
      min-height: 40px;
    }
    .tgnl-footer-btn:hover { background: color-mix(in srgb, var(--tgnl-accent) 80%, white); }
    .tgnl-footer-btn:active { transform: scale(0.98); }
    .tgnl-footer-close {
      appearance: none;
      border: 0;
      background: transparent;
      color: rgba(255, 255, 255, 0.7);
      width: 32px; height: 32px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 150ms ease, color 150ms ease;
    }
    .tgnl-footer-close:hover { background: rgba(255, 255, 255, 0.1); color: #FFFFFF; }
    .tgnl-footer-success {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      font-weight: 500;
    }

    /* ----- Footer in dark mode: swap brand bar for near-black card colour
       so the mode pill actually does something visible. Light mode keeps
       the brand-coloured bar (which already adapts to brand text contrast). */
    .tgnl-root[data-theme="dark"] .tgnl-footer {
      background: #0F172A;
      color: #F1F5F9;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 -4px 24px -4px rgba(0, 0, 0, 0.6);
    }
    .tgnl-root[data-theme="dark"] .tgnl-footer-input {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.14);
      color: #F1F5F9;
    }
    .tgnl-root[data-theme="dark"] .tgnl-footer-input::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }
    .tgnl-root[data-theme="dark"] .tgnl-footer-btn {
      background: var(--tgnl-brand);
      color: var(--tgnl-brand-text);
    }
    .tgnl-root[data-theme="dark"] .tgnl-footer-btn:hover {
      background: var(--tgnl-brand-hover);
    }
    .tgnl-root[data-theme="dark"] .tgnl-footer-close {
      color: rgba(255, 255, 255, 0.55);
    }
    .tgnl-root[data-theme="dark"] .tgnl-footer-close:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #F1F5F9;
    }

    @media (max-width: 700px) {
      .tgnl-footer { flex-wrap: wrap; padding: 14px 18px; gap: 12px; }
      .tgnl-footer-text { flex-basis: 100%; }
      .tgnl-footer-form { flex: 1; }
      .tgnl-footer-input { flex: 1; width: auto; }
    }

    /* ============= Vertical tab ============= */
    .tgnl-vertical {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      z-index: 9000;
      display: flex;
      align-items: center;
      pointer-events: none;
    }
    .tgnl-vertical[data-side="right"] { right: 0; flex-direction: row-reverse; }
    .tgnl-vertical[data-side="left"]  { left: 0;  flex-direction: row; }
    .tgnl-vertical > * { pointer-events: auto; }

    .tgnl-tab {
      appearance: none;
      border: 0;
      background: var(--tgnl-brand);
      color: var(--tgnl-brand-text);
      cursor: pointer;
      padding: 18px 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      transition: padding 220ms cubic-bezier(.2,.8,.2,1), background 150ms ease;
      font-family: inherit;
      position: relative;
    }
    .tgnl-vertical[data-side="right"] .tgnl-tab {
      border-radius: 14px 0 0 14px;
      box-shadow: -4px 0 14px rgba(15, 23, 42, 0.12);
    }
    .tgnl-vertical[data-side="left"] .tgnl-tab {
      border-radius: 0 14px 14px 0;
      box-shadow: 4px 0 14px rgba(15, 23, 42, 0.12);
    }
    .tgnl-tab:hover { padding-left: 16px; padding-right: 16px; background: var(--tgnl-brand-hover); }
    .tgnl-tab:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--tgnl-accent) 50%, transparent);
      outline-offset: -3px;
    }

    .tgnl-tab-label {
      writing-mode: vertical-rl;
      text-orientation: mixed;
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    /* Left side: flip text so it reads bottom-to-top */
    .tgnl-vertical[data-side="left"] .tgnl-tab-label {
      writing-mode: vertical-lr;
      transform: rotate(180deg);
    }

    .tgnl-vertical-panel {
      background: var(--tgnl-card);
      border-radius: var(--tgnl-radius);
      padding: 28px 26px;
      width: 340px;
      max-width: calc(100vw - 100px);
      margin: 0 8px;
      box-shadow: var(--tgnl-shadow-lg);
      position: relative;
    }
    .tgnl-vertical-panel-close {
      position: absolute;
      top: 10px; right: 10px;
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--tgnl-text-3);
      width: 28px; height: 28px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 150ms ease, color 150ms ease;
    }
    .tgnl-vertical-panel-close:hover { background: color-mix(in srgb, var(--tgnl-text-3) 12%, transparent); color: var(--tgnl-text); }
    .tgnl-vertical-panel .tgnl-card-title {
      font-size: 18px;
      margin-bottom: 6px;
      padding-right: 24px;
    }
    .tgnl-vertical-panel .tgnl-card-sub {
      font-size: 13px;
      margin-bottom: 18px;
    }

    @media (prefers-reduced-motion: reduce) {
      .tgnl-modal, .tgnl-modal-overlay, .tgnl-footer, .tgnl-tab, .tgnl-btn,
      .tgnl-card-success, .tgnl-inline-success, .tgnl-error-msg {
        transition: none !important;
        animation: none !important;
      }
      .tgnl-btn:active, .tgnl-tab:hover { transform: none; padding: 18px 12px; }
    }
  `;

  // ---------- Widget Class ----------
  class TGNewsletterWidget {
    constructor(container, config) {
      if (!container || container.__tgInited) return;
      container.__tgInited = true;

      this.el = container;
      this.c = this._defaults(config || {});
      this.t = makeT(this.c);
      this.shadow = container.attachShadow({ mode: 'open' });
      this._open = false;
      this._submitting = false;
      this._succeeded = false;
      this._dismissed = false;
      this._errorMsg = null;
      this._docKeyHandler = null;
      this._dismissKey = `tgnl_dismissed_${this.c.widgetId || 'anon'}`;

      // Restore footer dismissal from localStorage
      if (this.c.layout === 'footer' && this.c.footerRememberDismiss) {
        try {
          if (window.localStorage && window.localStorage.getItem(this._dismissKey) === '1') {
            this._dismissed = true;
          }
        } catch (e) { /* ignore */ }
      }

      this._render();

      // Footer slides up after a short delay so it doesn't fight the page render.
      // Latch _footerShown so later re-renders (validation error, submit state)
      // keep the bar on-screen instead of rebuilding it hidden — otherwise a
      // mistyped email slides the whole widget, error and all, out of view.
      if (this.c.layout === 'footer' && !this._dismissed) {
        setTimeout(() => {
          this._footerShown = true;
          const bar = this.shadow.querySelector('.tgnl-footer');
          if (bar) bar.setAttribute('data-show', 'true');
        }, this.c.footerDelay * 1000);
      }
    }

    // ─── Defaults & validation ───────────────────────────────────────────
    _defaults(c) {
      const validLayouts = ['inline', 'card', 'popup', 'footer', 'vertical'];
      const layout = validLayouts.includes(c.layout) ? c.layout : 'card';

      // Vertical only supports 'left' or 'right'
      let side = c.verticalSide || 'right';
      if (side !== 'left' && side !== 'right') side = 'right';

      // Popup trigger style
      const triggerStyle = c.triggerStyle === 'link' ? 'link' : 'button';

      return {
        widgetId: typeof c.widgetId === 'string' ? c.widgetId : '',
        layout,
        // Content — author-overridable. Localised defaults are filled at the
        // use-site (this.c.X || this.t('key')) so the viewer's language shows
        // when the author has not supplied their own copy.
        title: typeof c.title === 'string' ? c.title : '',
        subtitle: typeof c.subtitle === 'string' ? c.subtitle : '',
        emailPlaceholder: c.emailPlaceholder || '',
        firstNamePlaceholder: c.firstNamePlaceholder || '',
        buttonLabel: c.buttonLabel || '',
        successTitle: c.successTitle || '',
        successMessage: c.successMessage || '',
        consentLabel: typeof c.consentLabel === 'string' ? c.consentLabel : '',
        consentBlurb: typeof c.consentBlurb === 'string' ? c.consentBlurb : '',
        privacyUrl: typeof c.privacyUrl === 'string' ? c.privacyUrl : '',

        // Form options
        showFirstName: !!c.showFirstName,
        showConsent: c.showConsent !== false, // default ON
        consentRequired: c.consentRequired !== false, // default ON
        showIcon: c.showIcon !== false, // default ON for card
        showConsentBlurb: !!c.consentBlurb,

        // Popup-specific
        triggerLabel: c.triggerLabel || '',
        triggerStyle,

        // Footer-specific
        footerDelay: typeof c.footerDelay === 'number' ? Math.max(0, Math.min(60, c.footerDelay)) : 1.5,
        footerRememberDismiss: c.footerRememberDismiss !== false, // default ON

        // Vertical-specific
        tabLabel: c.tabLabel || '',
        verticalSide: side,

        // Theming
        fontFamily: c.fontFamily || 'Inter',
        theme: {
          mode: (c.theme && c.theme.mode === 'dark') ? 'dark' : 'light',
          brand: (c.theme && /^#[0-9a-f]{3,8}$/i.test(c.theme.brand)) ? c.theme.brand : '#1B2B5B',
          accent: (c.theme && /^#[0-9a-f]{3,8}$/i.test(c.theme.accent)) ? c.theme.accent : '#00B4D8',
          radius: (c.theme && Number.isFinite(c.theme.radius)) ? Math.max(0, Math.min(40, c.theme.radius)) : 14,
        },

        // Tags applied to the lead at submission time (passed to ESPs)
        tags: Array.isArray(c.tags) ? c.tags.filter(t => typeof t === 'string').slice(0, 20) : [],
      };
    }

    _themeStyle() {
      const t = this.c.theme;
      const brand = t.brand;
      const brandHover = lighten(brand, 0.10);
      const accent = t.accent;
      // Pick a contrasting brand text colour (white on dark brand, dark on light brand)
      const brandText = this._isDark(brand) ? '#FFFFFF' : '#0F172A';
      const radius = t.radius;
      return [
        `--tgnl-brand: ${brand}`,
        `--tgnl-brand-hover: ${brandHover}`,
        `--tgnl-brand-text: ${brandText}`,
        `--tgnl-accent: ${accent}`,
        `--tgnl-radius: ${radius}px`,
        `--tgnl-radius-input: ${Math.max(4, radius - 4)}px`,
        `--tgnl-font: ${safeFontFamily(this.c.fontFamily)}`,
      ].join('; ');
    }

    _isDark(hex) {
      const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{6})$/i);
      if (!m) return true;
      const r = parseInt(m[1].slice(0, 2), 16);
      const g = parseInt(m[1].slice(2, 4), 16);
      const b = parseInt(m[1].slice(4, 6), 16);
      // Perceived brightness (ITU-R BT.601)
      return (r * 299 + g * 587 + b * 114) / 1000 < 160;
    }

    // ─── Render ──────────────────────────────────────────────────────────
    _render() {
      const cfg = this.c;
      const themeStyle = this._themeStyle();
      let inner = '';
      if (cfg.layout === 'inline')   inner = this._renderInline();
      else if (cfg.layout === 'card') inner = this._renderCard();
      else if (cfg.layout === 'popup') inner = this._renderPopup();
      else if (cfg.layout === 'footer') inner = this._renderFooter();
      else if (cfg.layout === 'vertical') inner = this._renderVertical();

      this.shadow.innerHTML = `
        <style>${STYLES}</style>
        <div class="tgnl-root" data-theme="${cfg.theme.mode}" style="${themeStyle}">
          ${inner}
        </div>
      `;
      this._bind();
    }

    _renderConsentBlock() {
      const cfg = this.c;
      if (!cfg.showConsent) return '';
      const link = cfg.privacyUrl
        ? ` <a href="${esc(cfg.privacyUrl)}" target="_blank" rel="noopener noreferrer">${esc(this.t('privacyPolicy'))}</a>`
        : '';
      // Never pre-tick: a pre-ticked marketing opt-in is not valid consent under
      // UK GDPR/PECR. The visitor ticks it themselves; when consent is required,
      // submit is blocked until they do.
      return `
        <label class="tgnl-checkbox">
          <input type="checkbox" id="consent" />
          <span>${esc(cfg.consentLabel || this.t('consentLabel'))}${link}</span>
        </label>
      `;
    }

    _renderConsentBlurb() {
      const cfg = this.c;
      if (!cfg.consentBlurb) return '';
      const link = cfg.privacyUrl
        ? ` <a href="${esc(cfg.privacyUrl)}" target="_blank" rel="noopener noreferrer">${esc(this.t('privacyPolicy'))}</a>.`
        : '';
      return `<p class="tgnl-consent-text">${esc(cfg.consentBlurb)}${link}</p>`;
    }

    _renderErrorBlock() {
      if (!this._errorMsg) return '';
      return `
        <div class="tgnl-error-msg" role="alert">
          ${svgIcon('alert', 16)}
          <span>${esc(this._errorMsg)}</span>
        </div>
      `;
    }

    _renderInline() {
      const cfg = this.c;
      if (this._succeeded) {
        return `
          <div class="tgnl-inline-success" role="status" aria-live="polite">
            ${svgIcon('check', 20)}
            <span><strong class="tgnl-inline-success-strong">${esc(cfg.successTitle || this.t('successTitle'))}</strong> ${esc(cfg.successMessage || this.t('successMessage'))}</span>
          </div>
        `;
      }
      return `
        <form class="tgnl-inline-form" id="form" novalidate>
          <input class="tgnl-input" type="email" id="email" placeholder="${esc(cfg.emailPlaceholder || this.t('emailPlaceholder'))}" autocomplete="email" required aria-label="${esc(this.t('ariaEmail'))}" />
          <button class="tgnl-btn" type="submit" id="submitBtn">
            <span class="tgnl-btn-label">${esc(cfg.buttonLabel || this.t('buttonLabel'))}</span>
          </button>
        </form>
        ${this._renderConsentBlock()}
        ${this._renderErrorBlock()}
        ${this._renderConsentBlurb()}
      `;
    }

    _renderCard() {
      const cfg = this.c;
      if (this._succeeded) {
        return `
          <div class="tgnl-card">
            <div class="tgnl-card-success" role="status" aria-live="polite">
              <div class="tgnl-card-success-icon">${svgIcon('check', 28)}</div>
              <h3 class="tgnl-card-success-title">${esc(cfg.successTitle || this.t('successTitle'))}</h3>
              <p class="tgnl-card-success-sub">${esc(cfg.successMessage || this.t('successMessage'))}</p>
            </div>
          </div>
        `;
      }
      const icon = cfg.showIcon ? `<div class="tgnl-card-icon">${svgIcon('mail', 22)}</div>` : '';
      const firstName = cfg.showFirstName
        ? `<input class="tgnl-input" type="text" id="firstName" placeholder="${esc(cfg.firstNamePlaceholder || this.t('firstNamePlaceholder'))}" autocomplete="given-name" aria-label="${esc(this.t('ariaFirstName'))}" />`
        : '';
      return `
        <div class="tgnl-card">
          ${icon}
          <h3 class="tgnl-card-title">${esc(cfg.title || this.t('title'))}</h3>
          <p class="tgnl-card-sub">${esc(cfg.subtitle || this.t('subtitle'))}</p>
          <form class="tgnl-card-form" id="form" novalidate>
            ${firstName}
            <input class="tgnl-input" type="email" id="email" placeholder="${esc(cfg.emailPlaceholder || this.t('emailPlaceholder'))}" autocomplete="email" required aria-label="${esc(this.t('ariaEmail'))}" />
            ${this._renderConsentBlock()}
            ${this._renderErrorBlock()}
            <button class="tgnl-btn" type="submit" id="submitBtn">
              <span class="tgnl-btn-label">${esc(cfg.buttonLabel || this.t('buttonLabel'))}</span>
            </button>
          </form>
        </div>
      `;
    }

    _renderPopup() {
      const cfg = this.c;
      const triggerClass = cfg.triggerStyle === 'link' ? 'tgnl-popup-trigger is-link' : 'tgnl-popup-trigger';
      const triggerLabel = cfg.triggerLabel || this.t('triggerLabel');
      const triggerInner = cfg.triggerStyle === 'link'
        ? esc(triggerLabel)
        : `${svgIcon('mail', 14)}<span>${esc(triggerLabel)}</span>`;
      return `
        <button class="${triggerClass}" type="button" id="trigger" aria-haspopup="dialog" aria-expanded="${this._open}">${triggerInner}</button>
        <div class="tgnl-modal-overlay" id="overlay" data-open="${this._open}" role="dialog" aria-modal="true" aria-label="${esc(cfg.title || this.t('title'))}" aria-hidden="${!this._open}">
          <div class="tgnl-modal" id="modal">
            <button class="tgnl-modal-close" type="button" id="modalClose" aria-label="${esc(this.t('ariaClose'))}">${svgIcon('close', 18)}</button>
            ${this._renderModalBody()}
          </div>
        </div>
      `;
    }

    _renderModalBody() {
      const cfg = this.c;
      if (this._succeeded) {
        return `
          <div class="tgnl-card-success" role="status" aria-live="polite">
            <div class="tgnl-card-success-icon">${svgIcon('check', 28)}</div>
            <h3 class="tgnl-card-success-title">${esc(cfg.successTitle || this.t('successTitle'))}</h3>
            <p class="tgnl-card-success-sub">${esc(cfg.successMessage || this.t('successMessage'))}</p>
          </div>
        `;
      }
      const firstName = cfg.showFirstName
        ? `<input class="tgnl-input" type="text" id="firstName" placeholder="${esc(cfg.firstNamePlaceholder || this.t('firstNamePlaceholder'))}" autocomplete="given-name" aria-label="${esc(this.t('ariaFirstName'))}" />`
        : '';
      return `
        <h3 class="tgnl-card-title">${esc(cfg.title || this.t('title'))}</h3>
        <p class="tgnl-card-sub">${esc(cfg.subtitle || this.t('subtitle'))}</p>
        <form class="tgnl-card-form" id="form" novalidate>
          ${firstName}
          <input class="tgnl-input" type="email" id="email" placeholder="${esc(cfg.emailPlaceholder || this.t('emailPlaceholder'))}" autocomplete="email" required aria-label="${esc(this.t('ariaEmail'))}" />
          ${this._renderConsentBlock()}
          ${this._renderErrorBlock()}
          <button class="tgnl-btn" type="submit" id="submitBtn">
            <span class="tgnl-btn-label">${esc(cfg.buttonLabel || this.t('buttonLabel'))}</span>
          </button>
        </form>
      `;
    }

    _renderFooter() {
      const cfg = this.c;
      if (this._dismissed) return '';
      if (this._succeeded) {
        return `
          <div class="tgnl-footer" data-show="true" role="region" aria-label="${esc(cfg.title || this.t('title'))}">
            <div class="tgnl-footer-success" role="status" aria-live="polite">
              ${svgIcon('check', 18)}
              <span><strong>${esc(cfg.successTitle || this.t('successTitle'))}</strong> ${esc(cfg.successMessage || this.t('successMessage'))}</span>
            </div>
            <button class="tgnl-footer-close" type="button" id="footerClose" aria-label="${esc(this.t('ariaDismiss'))}">${svgIcon('close', 16)}</button>
          </div>
        `;
      }
      return `
        <div class="tgnl-footer" data-show="${(this._footerShown || this._errorMsg) ? 'true' : 'false'}" role="region" aria-label="${esc(cfg.title || this.t('title'))}">
          <div class="tgnl-footer-text">
            <p class="tgnl-footer-title">${esc(cfg.title || this.t('title'))}</p>
            <p class="tgnl-footer-sub">${esc(cfg.subtitle || this.t('subtitle'))}</p>
            ${this._renderConsentBlock()}
          </div>
          <form class="tgnl-footer-form" id="form" novalidate>
            <input class="tgnl-footer-input" type="email" id="email" placeholder="${esc(cfg.emailPlaceholder || this.t('emailPlaceholder'))}" autocomplete="email" required aria-label="${esc(this.t('ariaEmail'))}" />
            <button class="tgnl-footer-btn" type="submit" id="submitBtn">${esc(cfg.buttonLabel || this.t('buttonLabel'))}</button>
          </form>
          ${this._errorMsg ? `<div class="tgnl-error-msg" role="alert" style="position:absolute;bottom:100%;right:24px;margin-bottom:8px;background:#FEE2E2;color:#991B1B;border-color:#FCA5A5">${svgIcon('alert', 14)}<span>${esc(this._errorMsg)}</span></div>` : ''}
          <button class="tgnl-footer-close" type="button" id="footerClose" aria-label="${esc(this.t('ariaDismiss'))}">${svgIcon('close', 16)}</button>
        </div>
      `;
    }

    _renderVertical() {
      const cfg = this.c;
      const tabLabel = cfg.tabLabel || this.t('tabLabel');
      const tabHTML = `
        <button class="tgnl-tab" type="button" id="tab" aria-haspopup="dialog" aria-expanded="${this._open}" aria-label="${esc(tabLabel)}">
          ${svgIcon('mail', 22)}
          <span class="tgnl-tab-label">${esc(tabLabel)}</span>
        </button>
      `;
      return `
        <div class="tgnl-vertical" data-side="${cfg.verticalSide}">
          ${this._open ? `
            <div class="tgnl-vertical-panel" role="dialog" aria-label="${esc(cfg.title || this.t('title'))}">
              <button class="tgnl-vertical-panel-close" type="button" id="panelClose" aria-label="${esc(this.t('ariaClose'))}">${svgIcon('close', 16)}</button>
              ${this._renderModalBody()}
            </div>
          ` : ''}
          ${tabHTML}
        </div>
      `;
    }

    // ─── Bindings ────────────────────────────────────────────────────────
    _bind() {
      const cfg = this.c;
      const root = this.shadow.querySelector('.tgnl-root');
      if (!root) return;

      // Form submit (inline / card / footer / popup-modal / vertical-panel)
      const form = this.shadow.querySelector('#form');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          this._handleSubmit();
        });
      }

      // Popup trigger
      const trigger = this.shadow.querySelector('#trigger');
      if (trigger) {
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          this.open();
        });
      }
      const modalClose = this.shadow.querySelector('#modalClose');
      if (modalClose) {
        modalClose.addEventListener('click', () => this.close());
      }
      const overlay = this.shadow.querySelector('#overlay');
      if (overlay) {
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) this.close();
        });
      }

      // Vertical tab
      const tab = this.shadow.querySelector('#tab');
      if (tab) {
        tab.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggle();
        });
      }
      const panelClose = this.shadow.querySelector('#panelClose');
      if (panelClose) {
        panelClose.addEventListener('click', () => this.close());
      }

      // Footer dismiss
      const footerClose = this.shadow.querySelector('#footerClose');
      if (footerClose) {
        footerClose.addEventListener('click', () => this._dismissFooter());
      }

      // Escape to close modal/panel
      this._unbindDoc();
      if (cfg.layout === 'popup' || cfg.layout === 'vertical') {
        this._docKeyHandler = (e) => {
          if ((e.key === 'Escape' || e.key === 'Esc') && this._open) {
            this.close();
          }
        };
        document.addEventListener('keydown', this._docKeyHandler);
      }
    }

    _unbindDoc() {
      if (this._docKeyHandler) {
        document.removeEventListener('keydown', this._docKeyHandler);
        this._docKeyHandler = null;
      }
    }

    // ─── Submission ──────────────────────────────────────────────────────
    async _handleSubmit() {
      if (this._submitting || this._succeeded) return;
      const cfg = this.c;

      const emailEl = this.shadow.querySelector('#email');
      const firstNameEl = this.shadow.querySelector('#firstName');
      const consentEl = this.shadow.querySelector('#consent');

      const email = (emailEl && emailEl.value || '').trim();
      const firstName = (firstNameEl && firstNameEl.value || '').trim();
      const consent = consentEl ? !!consentEl.checked : true; // implicit consent if no checkbox shown

      // Validation
      if (!isEmail(email)) {
        if (emailEl) emailEl.setAttribute('aria-invalid', 'true');
        this._errorMsg = this.t('invalidEmail');
        this._render();
        return;
      }
      if (cfg.showConsent && cfg.consentRequired && !consent) {
        this._errorMsg = this.t('consentRequired');
        this._render();
        return;
      }
      this._errorMsg = null;
      if (emailEl) emailEl.removeAttribute('aria-invalid');

      // Submit
      this._submitting = true;
      this._setButtonLoading(true);

      try {
        const payload = {
          widgetId: cfg.widgetId,
          email,
          firstName: firstName || undefined,
          consent,
          tags: cfg.tags,
          sourceUrl: (typeof window !== 'undefined') ? window.location.href : '',
          referrer: (typeof document !== 'undefined') ? document.referrer : '',
        };

        const resp = await fetch(SUBMIT_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          let errText = this.t('genericError');
          try {
            const data = await resp.json();
            if (data && (data.alreadySubscribed || data.code === 'already_subscribed')) {
              errText = this.t('alreadySubscribed');
            } else if (data && data.error) {
              errText = data.error;
            }
          } catch (e) { /* ignore */ }
          throw new Error(errText);
        }

        this._succeeded = true;
        this._submitting = false;
        this._render();
      } catch (err) {
        this._submitting = false;
        this._errorMsg = (err && err.message) || this.t('genericError');
        this._render();
      }
    }

    _setButtonLoading(isLoading) {
      const btn = this.shadow.querySelector('#submitBtn');
      if (!btn) return;
      if (isLoading) {
        btn.setAttribute('disabled', 'true');
        const label = btn.querySelector('.tgnl-btn-label');
        if (label) {
          label.dataset.originalText = label.textContent;
          label.innerHTML = `<span class="tgnl-btn-spinner">${svgIcon('spinner', 14)}</span>`;
        } else {
          // Footer button doesn't have .tgnl-btn-label — replace inner text
          btn.dataset.originalText = btn.textContent;
          btn.innerHTML = svgIcon('spinner', 14);
        }
      }
    }

    _dismissFooter() {
      this._dismissed = true;
      try {
        if (this.c.footerRememberDismiss && window.localStorage) {
          window.localStorage.setItem(this._dismissKey, '1');
        }
      } catch (e) { /* ignore */ }
      this._render();
    }

    // ─── Public API ──────────────────────────────────────────────────────
    /** Open modal (popup) or expand panel (vertical). No-op for inline/card/footer. */
    open() {
      if (this.c.layout !== 'popup' && this.c.layout !== 'vertical') return;
      if (this._open) return;
      this._open = true;
      if (this.c.layout === 'popup') {
        const overlay = this.shadow.querySelector('#overlay');
        const trigger = this.shadow.querySelector('#trigger');
        if (overlay) overlay.setAttribute('data-open', 'true');
        if (overlay) overlay.setAttribute('aria-hidden', 'false');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        // Focus the email field
        setTimeout(() => {
          const email = this.shadow.querySelector('#email');
          if (email) try { email.focus(); } catch(e) {}
        }, 50);
      } else {
        // Vertical: full re-render to include the panel
        this._render();
        setTimeout(() => {
          const email = this.shadow.querySelector('#email');
          if (email) try { email.focus(); } catch(e) {}
        }, 50);
      }
    }

    close() {
      if (this.c.layout !== 'popup' && this.c.layout !== 'vertical') return;
      if (!this._open) return;
      this._open = false;
      if (this.c.layout === 'popup') {
        const overlay = this.shadow.querySelector('#overlay');
        const trigger = this.shadow.querySelector('#trigger');
        if (overlay) overlay.setAttribute('data-open', 'false');
        if (overlay) overlay.setAttribute('aria-hidden', 'true');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      } else {
        this._render();
      }
    }

    toggle() { this._open ? this.close() : this.open(); }
    isOpen() { return !!this._open; }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      this.t = makeT(this.c);
      this._open = false;
      this._succeeded = false;
      this._errorMsg = null;
      this._render();
    }

    destroy() {
      this._unbindDoc();
      if (this.shadow) this.shadow.innerHTML = '';
    }
  }

  // ---------- Auto-initializer ----------
  async function init() {
    if (typeof document === 'undefined') return;
    const containers = document.querySelectorAll('[data-tg-widget="newsletter"]');
    for (const el of containers) {
      if (el.__tgInited) continue;

      const inline = el.getAttribute('data-tg-config');
      if (inline) {
        try {
          const cfg = JSON.parse(inline);
          new TGNewsletterWidget(el, cfg);
          continue;
        } catch (e) {
          console.warn('[TG Newsletter] invalid data-tg-config', e);
        }
      }

      const widgetId = el.getAttribute('data-tg-id');
      if (!widgetId) {
        console.warn('[TG Newsletter] mount has no data-tg-id and no inline data-tg-config — skipping');
        continue;
      }

      try {
        const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(widgetId)}&type=newsletter`);
        if (!resp.ok) {
          console.warn(`[TG Newsletter] config fetch ${resp.status} for ${widgetId}`);
          continue;
        }
        const data = await resp.json();
        const cfg = (data && (data.config || data)) || {};
        cfg.widgetId = widgetId;
        new TGNewsletterWidget(el, cfg);
      } catch (e) {
        console.warn(`[TG Newsletter] config fetch failed for ${widgetId}`, e);
      }
    }
  }

  // Expose class globally so dashboards / editors can construct directly
  if (typeof window !== 'undefined') {
    window.TGNewsletterWidget = TGNewsletterWidget;
    window.TGNewsletterVersion = VERSION;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
