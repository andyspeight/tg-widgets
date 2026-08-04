/**
 * Travelgenix Enquiry Form Widget v1.1.7
 * Self-contained, embeddable form widget — part of the Travelgenix Widget Suite
 * Zero dependencies — works on any website via a single script tag
 *
 * Usage (live embed):
 *   <div data-tg-widget="enquiry" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-enquiry.js"></script>
 *
 * Usage (programmatic, e.g. from the editor preview):
 *   <script src="https://tg-widgets.vercel.app/widget-enquiry.js"></script>
 *   <script>
 *     const widget = new TGEnquiryWidget(mountEl, configObject);
 *     // later, to update:
 *     widget.update(newConfigObject);
 *     // or:
 *     widget.destroy();
 *   </script>
 *
 * The class and auto-mount both exist in parallel — live embeds use auto-mount
 * to fetch config from the API, the editor uses the class to pass config
 * directly so changes render instantly without a network round-trip.
 *
 * CONFIG SHAPE EXPECTED BY THE CLASS
 * -----------------------------------
 * {
 *   formId:       'EF-0001',              // used in submissions
 *   widgetId:     'tgw_123_abc',           // dashboard linkage
 *   name:         'Holiday Enquiry Form',
 *   header:       { title, subtitle },
 *   submitText:   'Send my enquiry',
 *   thankYou:     { mode, message, redirectUrl },
 *   branding:     { buttonColour, accentColour, theme },
 *   fieldsJSON:   '[{type, ...}, ...]',    // or array already
 *   security:     { honeypot, turnstile, turnstileSiteKey },
 * }
 */
(function () {
  'use strict';

  var WIDGET_VERSION = '1.1.12';
  var VISITOR_ID_KEY = 'tg_visitor_id_v1';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only (field labels, placeholders, validation, buttons,
  // states, aria-labels). Author content (the visitor's own typed data, custom
  // field options, brand/place names, ATOL/ABTA wording) is never translated.
  // English is the source + fallback. Author-overridable defaults (form title,
  // intro, submit label, per-field labels, success message) resolve through
  // these keys only when the author has not supplied their own value.
  var MESSAGES = {
    en: {
      formUnavailable: 'Form unavailable',
      loadingForm: 'Loading form…',
      unableToLoad: 'Unable to load this form.',
      unableToReach: 'Unable to reach the Travelgenix widget service. Please try again later.',
      headerTitle: 'Tell us about your dream holiday',
      headerSubtitle: 'Share a few details and one of our travel specialists will come back within 24 hours.',
      submitText: 'Send my enquiry',
      thankYouMessage: "Thanks {firstName} — we're on it",
      thankYouFallback: 'Thanks{firstName} — we’re on it',
      thankYouBody: "One of our travel specialists will be in touch within 24 hours. We've also sent a confirmation to your email.",
      reference: 'Reference {ref}',
      back: 'Back',
      continue: 'Continue',
      sending: 'Sending…',
      looksGood: ' Looks good!',
      secure: 'Secure',
      gdpr: 'GDPR',
      reply24hr: '24hr reply',
      poweredBy: 'Powered by ',
      noFieldsStep: 'No fields on this step.',
      stepN: 'Step {n}',
      securityCheck: 'Security check',
      securityMisconfigured: 'Security check misconfigured — please contact support.',
      securityIncomplete: 'Please complete the security check above before submitting.',
      genericError: 'Something went wrong. Please try again.',
      fixOneField: 'Please fix the highlighted field above before continuing.',
      fixNFields: 'Please fix the {count} highlighted fields above before continuing.',
      checkNFields: 'Please check the {count} highlighted fields above and try again.',
      // Destination field
      label_destination: 'Where are you dreaming of?',
      dest_placeholder: 'Search countries, cities, resorts...',
      dest_searchAria: 'Search destinations',
      dest_remove: 'Remove {name}',
      dest_help: 'Add one, or multiple for a twin-centre trip.',
      dest_country: 'Country',
      dest_city: 'City',
      dest_cityIn: 'City · {country}',
      dest_resort: 'Resort',
      dest_resortIn: 'Resort · {place}',
      dest_cantFind: "Can't find it?",
      dest_useTyped: 'Use "{text}"',
      dest_submitAsTyped: 'Submit as typed',
      dest_startTyping: 'Start typing a country, city, or resort…',
      dest_keepTyping: 'Keep typing…',
      dest_searching: 'Searching…',
      dest_noMatches: 'No matches — try a different term',
      dest_searchUnavailable: 'Search is temporarily unavailable.',
      dest_required: 'Please add at least one destination.',
      // Airport field
      label_airport: 'Departure airport',
      airport_optCount: '(pick up to {n})',
      airport_placeholder: 'Search airports (e.g. Heathrow, LHR, Manchester)...',
      airport_searchAria: 'Search airports',
      airport_remove: 'Remove {name}',
      airport_flexibleChip: 'Flexible',
      airport_flexibleGroup: 'Flexible',
      airport_flexibleOption: "I'm flexible on airport",
      airport_any: 'Any',
      airport_max: 'You can pick up to {n} airports.',
      airport_noMatches: 'No matches — try a different term',
      airport_noMore: 'No more airports to pick',
      airport_help: 'Add one or more airports — or pick "flexible" if you don’t mind.',
      airport_required: 'Please pick at least one departure airport.',
      // Date range field
      departOn: 'Depart on',
      returnOn: 'Return on',
      flexAria: 'Flexible by a week either side',
      flexLabel: "I'm flexible by a week either side",
      date_required: 'Please choose a departure date.',
      interests_required: 'Please pick at least one option.',
      date_returnAfter: 'Return date must be after departure.',
      // Duration field
      label_duration: 'Duration',
      duration_options: 'Duration options',
      duration_nights: '{n} nights',
      // Travellers field
      label_travellers: "Who's travelling?",
      childAgesAria: 'Children ages',
      childAgesTitle: 'How old will each child be when they travel?',
      childN: 'Child {n}',
      ageYoungest: '{age} (youngest)',
      ageOldest: '{age} (oldest)',
      decrease: 'Decrease {label} (currently {n})',
      increase: 'Increase {label} (currently {n})',
      adults: 'Adults',
      adultsSub: 'Age 16+',
      children: 'Children',
      childrenSub: 'Age 2–15',
      infants: 'Infants',
      infantsSub: 'Under 2',
      trav_required: 'At least one adult required.',
      // Budget field
      label_budget: 'Approximate total budget',
      budgetAria: 'Budget per person',
      budget_amountAria: '{amount} per person',
      perPerson: 'per person',
      // Stars field
      label_stars: 'Star rating preference',
      stars_options: 'Star rating options',
      stars_cardAria: '{stars}-star — {label}. {desc}',
      // Board field
      star3_label: 'Comfortable', star3_desc: '3-star. Great value.',
      star4_label: 'Superior', star4_desc: '4-star. The sweet spot.',
      star5_label: 'Luxury', star5_desc: '5-star. The full treatment.',
      label_board: 'Board basis',
      board_RO: 'Room only', board_BB: 'B&B', board_HB: 'Half board', board_FB: 'Full board', board_AI: 'All inclusive',
      board_options: 'Board basis options',
      // Interests field
      label_interests: 'Interests',
      interests_pickMany: '(pick as many as apply)',
      int_beach: 'Beach', int_city: 'City', int_culture: 'Culture', int_food: 'Food & wine', int_adventure: 'Adventure', int_family: 'Family', int_wellness: 'Wellness', int_honeymoon: 'Honeymoon',
      interests_options: 'Interest options',
      // Name field
      firstName: 'First name',
      lastName: 'Last name',
      firstName_ph: 'Jane',
      lastName_ph: 'Smith',
      firstName_required: 'First name required.',
      lastName_required: 'Last name required.',
      // Contact field
      emailAddress: 'Email address',
      phone: 'Phone',
      phoneAria: 'Phone number',
      email_ph: 'jane@example.com',
      phone_ph: '07700 900000',
      phone_required: 'Please add a phone number.',
      optional: '(optional)',
      email_required: 'Email required.',
      email_invalid: 'Please enter a valid email address.',
      // Notes field
      label_notes: 'Anything else we should know?',
      notesAria: 'Notes',
      notes_ph: 'Dietary requirements, accessibility needs, special occasions, specific resorts or hotels you have had your eye on...',
      // Consent field
      consent_agreeAria: 'Agree to be contacted',
      consent_marketingAria: 'Receive marketing updates',
      consent_contactLabel: 'I agree to be contacted about this enquiry. ',
      consent_contactSub: "We'll only use your details to respond to your enquiry.",
      consent_marketingLabel: 'Send me occasional holiday inspiration and exclusive offers.',
      consent_required: 'Please tick the consent box to continue.'
    },
    fr: {
      formUnavailable: 'Formulaire indisponible',
      loadingForm: 'Chargement du formulaire…',
      unableToLoad: 'Impossible de charger ce formulaire.',
      unableToReach: 'Impossible de joindre le service de widgets Travelgenix. Veuillez réessayer plus tard.',
      headerTitle: 'Parlez-nous de vos vacances de rêve',
      headerSubtitle: 'Donnez-nous quelques détails et un de nos spécialistes du voyage vous recontactera sous 24 heures.',
      submitText: 'Envoyer ma demande',
      thankYouMessage: 'Merci {firstName} — nous nous en occupons',
      thankYouFallback: 'Merci{firstName} — nous nous en occupons',
      thankYouBody: 'Un de nos spécialistes du voyage vous contactera sous 24 heures. Nous avons aussi envoyé une confirmation à votre adresse e-mail.',
      reference: 'Référence {ref}',
      back: 'Retour',
      continue: 'Suivant',
      sending: 'Envoi…',
      looksGood: ' Parfait !',
      secure: 'Sécurisé',
      gdpr: 'RGPD',
      reply24hr: 'Réponse 24 h',
      poweredBy: 'Propulsé par ',
      noFieldsStep: 'Aucun champ à cette étape.',
      stepN: 'Étape {n}',
      securityCheck: 'Contrôle de sécurité',
      securityMisconfigured: 'Contrôle de sécurité mal configuré — veuillez contacter le support.',
      securityIncomplete: 'Veuillez effectuer le contrôle de sécurité ci-dessus avant d’envoyer.',
      genericError: 'Une erreur s’est produite. Veuillez réessayer.',
      fixOneField: 'Veuillez corriger le champ en surbrillance ci-dessus avant de continuer.',
      fixNFields: 'Veuillez corriger les {count} champs en surbrillance ci-dessus avant de continuer.',
      checkNFields: 'Veuillez vérifier les {count} champs en surbrillance ci-dessus et réessayer.',
      label_destination: 'Où rêvez-vous d’aller ?',
      dest_placeholder: 'Rechercher des pays, villes, stations...',
      dest_searchAria: 'Rechercher des destinations',
      dest_remove: 'Retirer {name}',
      dest_help: 'Ajoutez-en une, ou plusieurs pour un séjour multi-destinations.',
      dest_country: 'Pays',
      dest_city: 'Ville',
      dest_cityIn: 'Ville · {country}',
      dest_resort: 'Station',
      dest_resortIn: 'Station · {place}',
      dest_cantFind: 'Vous ne la trouvez pas ?',
      dest_useTyped: 'Utiliser « {text} »',
      dest_submitAsTyped: 'Envoyer tel quel',
      dest_startTyping: 'Commencez à taper un pays, une ville ou une station…',
      dest_keepTyping: 'Continuez à taper…',
      dest_searching: 'Recherche…',
      dest_noMatches: 'Aucun résultat — essayez un autre terme',
      dest_searchUnavailable: 'La recherche est momentanément indisponible.',
      dest_required: 'Veuillez ajouter au moins une destination.',
      label_airport: 'Aéroport de départ',
      airport_optCount: '(jusqu’à {n})',
      airport_placeholder: 'Rechercher des aéroports (ex. Heathrow, LHR, Manchester)...',
      airport_searchAria: 'Rechercher des aéroports',
      airport_remove: 'Retirer {name}',
      airport_flexibleChip: 'Flexible',
      airport_flexibleGroup: 'Flexible',
      airport_flexibleOption: 'Je suis flexible sur l’aéroport',
      airport_any: 'Tous',
      airport_max: 'Vous pouvez choisir jusqu’à {n} aéroports.',
      airport_noMatches: 'Aucun résultat — essayez un autre terme',
      airport_noMore: 'Plus aucun aéroport à choisir',
      airport_help: 'Ajoutez un ou plusieurs aéroports — ou choisissez « flexible » si cela vous est égal.',
      airport_required: 'Veuillez choisir au moins un aéroport de départ.',
      departOn: 'Départ le',
      returnOn: 'Retour le',
      flexAria: 'Flexible d’une semaine de part et d’autre',
      flexLabel: 'Je suis flexible d’une semaine de part et d’autre',
      date_required: 'Veuillez choisir une date de départ.',
      interests_required: 'Veuillez choisir au moins une option.',
      date_returnAfter: 'La date de retour doit être après le départ.',
      label_duration: 'Durée',
      duration_options: 'Options de durée',
      duration_nights: '{n} nuits',
      label_travellers: 'Qui voyage ?',
      childAgesAria: 'Âges des enfants',
      childAgesTitle: 'Quel âge aura chaque enfant au moment du voyage ?',
      childN: 'Enfant {n}',
      ageYoungest: '{age} (le plus jeune)',
      ageOldest: '{age} (le plus âgé)',
      decrease: 'Diminuer {label} (actuellement {n})',
      increase: 'Augmenter {label} (actuellement {n})',
      adults: 'Adultes',
      adultsSub: '16 ans et plus',
      children: 'Enfants',
      childrenSub: '2 à 15 ans',
      infants: 'Bébés',
      infantsSub: 'Moins de 2 ans',
      trav_required: 'Au moins un adulte est requis.',
      label_budget: 'Budget total approximatif',
      budgetAria: 'Budget par personne',
      budget_amountAria: '{amount} par personne',
      perPerson: 'par personne',
      label_stars: 'Préférence de catégorie',
      stars_options: 'Options de catégorie',
      stars_cardAria: '{stars} étoiles — {label}. {desc}',
      star3_label: 'Confortable', star3_desc: '3 étoiles. Excellent rapport qualité-prix.',
      star4_label: 'Supérieur', star4_desc: '4 étoiles. Le juste équilibre.',
      star5_label: 'Luxe', star5_desc: '5 étoiles. Le grand jeu.',
      label_board: 'Formule de restauration',
      board_RO: 'Sans repas', board_BB: 'Petit-déjeuner', board_HB: 'Demi-pension', board_FB: 'Pension complète', board_AI: 'Tout compris',
      board_options: 'Options de formule',
      label_interests: 'Centres d’intérêt',
      interests_pickMany: '(choisissez-en autant que vous voulez)',
      int_beach: 'Plage', int_city: 'Ville', int_culture: 'Culture', int_food: 'Gastronomie et vins', int_adventure: 'Aventure', int_family: 'Famille', int_wellness: 'Bien-être', int_honeymoon: 'Lune de miel',
      interests_options: 'Options de centres d’intérêt',
      firstName: 'Prénom',
      lastName: 'Nom',
      firstName_ph: 'Jeanne',
      lastName_ph: 'Dupont',
      firstName_required: 'Le prénom est requis.',
      lastName_required: 'Le nom est requis.',
      emailAddress: 'Adresse e-mail',
      phone: 'Téléphone',
      phoneAria: 'Numéro de téléphone',
      email_ph: 'jeanne@exemple.com',
      phone_ph: '06 12 34 56 78',
      optional: '(facultatif)',
      email_required: 'L’e-mail est requis.',
      email_invalid: 'Veuillez saisir une adresse e-mail valide.',
      label_notes: 'Autre chose à nous dire ?',
      notesAria: 'Notes',
      notes_ph: 'Régimes alimentaires, besoins d’accessibilité, occasions spéciales, stations ou hôtels précis que vous avez en tête...',
      consent_agreeAria: 'Accepter d’être contacté',
      consent_marketingAria: 'Recevoir des actualités marketing',
      consent_contactLabel: 'J’accepte d’être contacté au sujet de cette demande. ',
      consent_contactSub: 'Nous n’utiliserons vos coordonnées que pour répondre à votre demande.',
      consent_marketingLabel: 'Envoyez-moi de temps en temps des idées de vacances et des offres exclusives.',
      consent_required: 'Veuillez cocher la case de consentement pour continuer.'
    },
    de: {
      formUnavailable: 'Formular nicht verfügbar',
      loadingForm: 'Formular wird geladen…',
      unableToLoad: 'Dieses Formular kann nicht geladen werden.',
      unableToReach: 'Der Travelgenix-Widget-Dienst ist nicht erreichbar. Bitte versuchen Sie es später erneut.',
      headerTitle: 'Erzählen Sie uns von Ihrem Traumurlaub',
      headerSubtitle: 'Teilen Sie uns ein paar Details mit und einer unserer Reisespezialisten meldet sich innerhalb von 24 Stunden.',
      submitText: 'Anfrage senden',
      thankYouMessage: 'Vielen Dank {firstName} — wir kümmern uns darum',
      thankYouFallback: 'Vielen Dank{firstName} — wir kümmern uns darum',
      thankYouBody: 'Einer unserer Reisespezialisten meldet sich innerhalb von 24 Stunden. Eine Bestätigung haben wir auch an Ihre E-Mail-Adresse gesendet.',
      reference: 'Referenz {ref}',
      back: 'Zurück',
      continue: 'Weiter',
      sending: 'Wird gesendet…',
      looksGood: ' Sieht gut aus!',
      secure: 'Sicher',
      gdpr: 'DSGVO',
      reply24hr: 'Antwort in 24 Std.',
      poweredBy: 'Bereitgestellt von ',
      noFieldsStep: 'Keine Felder in diesem Schritt.',
      stepN: 'Schritt {n}',
      securityCheck: 'Sicherheitsprüfung',
      securityMisconfigured: 'Sicherheitsprüfung falsch konfiguriert — bitte kontaktieren Sie den Support.',
      securityIncomplete: 'Bitte führen Sie zuerst die Sicherheitsprüfung oben durch.',
      genericError: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
      fixOneField: 'Bitte korrigieren Sie das hervorgehobene Feld oben, bevor Sie fortfahren.',
      fixNFields: 'Bitte korrigieren Sie die {count} hervorgehobenen Felder oben, bevor Sie fortfahren.',
      checkNFields: 'Bitte prüfen Sie die {count} hervorgehobenen Felder oben und versuchen Sie es erneut.',
      label_destination: 'Wovon träumen Sie?',
      dest_placeholder: 'Länder, Städte, Resorts suchen...',
      dest_searchAria: 'Reiseziele suchen',
      dest_remove: '{name} entfernen',
      dest_help: 'Fügen Sie eines hinzu, oder mehrere für eine Zweizentrenreise.',
      dest_country: 'Land',
      dest_city: 'Stadt',
      dest_cityIn: 'Stadt · {country}',
      dest_resort: 'Resort',
      dest_resortIn: 'Resort · {place}',
      dest_cantFind: 'Nicht gefunden?',
      dest_useTyped: '„{text}“ verwenden',
      dest_submitAsTyped: 'Wie eingegeben senden',
      dest_startTyping: 'Geben Sie ein Land, eine Stadt oder ein Resort ein…',
      dest_keepTyping: 'Weiter tippen…',
      dest_searching: 'Suche läuft…',
      dest_noMatches: 'Keine Treffer — versuchen Sie einen anderen Begriff',
      dest_searchUnavailable: 'Die Suche ist vorübergehend nicht verfügbar.',
      dest_required: 'Bitte fügen Sie mindestens ein Reiseziel hinzu.',
      label_airport: 'Abflughafen',
      airport_optCount: '(bis zu {n})',
      airport_placeholder: 'Flughäfen suchen (z. B. Heathrow, LHR, Manchester)...',
      airport_searchAria: 'Flughäfen suchen',
      airport_remove: '{name} entfernen',
      airport_flexibleChip: 'Flexibel',
      airport_flexibleGroup: 'Flexibel',
      airport_flexibleOption: 'Ich bin beim Flughafen flexibel',
      airport_any: 'Alle',
      airport_max: 'Sie können bis zu {n} Flughäfen auswählen.',
      airport_noMatches: 'Keine Treffer — versuchen Sie einen anderen Begriff',
      airport_noMore: 'Keine weiteren Flughäfen verfügbar',
      airport_help: 'Fügen Sie einen oder mehrere Flughäfen hinzu — oder wählen Sie „flexibel“, wenn es Ihnen egal ist.',
      airport_required: 'Bitte wählen Sie mindestens einen Abflughafen.',
      departOn: 'Hinflug am',
      returnOn: 'Rückflug am',
      flexAria: 'Flexibel um eine Woche in beide Richtungen',
      flexLabel: 'Ich bin um eine Woche in beide Richtungen flexibel',
      date_required: 'Bitte wählen Sie ein Abflugdatum.',
      interests_required: 'Bitte wählen Sie mindestens eine Option.',
      date_returnAfter: 'Das Rückflugdatum muss nach dem Hinflug liegen.',
      label_duration: 'Dauer',
      duration_options: 'Dauer-Optionen',
      duration_nights: '{n} Nächte',
      label_travellers: 'Wer reist?',
      childAgesAria: 'Alter der Kinder',
      childAgesTitle: 'Wie alt ist jedes Kind zum Reisezeitpunkt?',
      childN: 'Kind {n}',
      ageYoungest: '{age} (jüngstes)',
      ageOldest: '{age} (ältestes)',
      decrease: '{label} verringern (aktuell {n})',
      increase: '{label} erhöhen (aktuell {n})',
      adults: 'Erwachsene',
      adultsSub: 'Ab 16 Jahren',
      children: 'Kinder',
      childrenSub: '2 bis 15 Jahre',
      infants: 'Kleinkinder',
      infantsSub: 'Unter 2',
      trav_required: 'Mindestens ein Erwachsener erforderlich.',
      label_budget: 'Ungefähres Gesamtbudget',
      budgetAria: 'Budget pro Person',
      budget_amountAria: '{amount} pro Person',
      perPerson: 'pro Person',
      label_stars: 'Sterne-Präferenz',
      stars_options: 'Sterne-Optionen',
      stars_cardAria: '{stars} Sterne — {label}. {desc}',
      star3_label: 'Komfortabel', star3_desc: '3 Sterne. Tolles Preis-Leistungs-Verhältnis.',
      star4_label: 'Superior', star4_desc: '4 Sterne. Der ideale Mittelweg.',
      star5_label: 'Luxus', star5_desc: '5 Sterne. Rundum verwöhnt.',
      label_board: 'Verpflegung',
      board_RO: 'Nur Übernachtung', board_BB: 'Übernachtung mit Frühstück', board_HB: 'Halbpension', board_FB: 'Vollpension', board_AI: 'All-inclusive',
      board_options: 'Verpflegungsoptionen',
      label_interests: 'Interessen',
      interests_pickMany: '(wählen Sie so viele wie zutreffen)',
      int_beach: 'Strand', int_city: 'Stadt', int_culture: 'Kultur', int_food: 'Essen & Wein', int_adventure: 'Abenteuer', int_family: 'Familie', int_wellness: 'Wellness', int_honeymoon: 'Flitterwochen',
      interests_options: 'Interessen-Optionen',
      firstName: 'Vorname',
      lastName: 'Nachname',
      firstName_ph: 'Anna',
      lastName_ph: 'Müller',
      firstName_required: 'Vorname erforderlich.',
      lastName_required: 'Nachname erforderlich.',
      emailAddress: 'E-Mail-Adresse',
      phone: 'Telefon',
      phoneAria: 'Telefonnummer',
      email_ph: 'anna@beispiel.de',
      phone_ph: '0151 23456789',
      optional: '(optional)',
      email_required: 'E-Mail erforderlich.',
      email_invalid: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
      label_notes: 'Sonst noch etwas?',
      notesAria: 'Notizen',
      notes_ph: 'Ernährungswünsche, Barrierefreiheit, besondere Anlässe, bestimmte Resorts oder Hotels, die Sie im Auge haben...',
      consent_agreeAria: 'Kontaktaufnahme zustimmen',
      consent_marketingAria: 'Marketing-Updates erhalten',
      consent_contactLabel: 'Ich bin damit einverstanden, zu dieser Anfrage kontaktiert zu werden. ',
      consent_contactSub: 'Wir verwenden Ihre Daten nur, um auf Ihre Anfrage zu antworten.',
      consent_marketingLabel: 'Senden Sie mir gelegentlich Urlaubsinspiration und exklusive Angebote.',
      consent_required: 'Bitte kreuzen Sie das Einwilligungsfeld an, um fortzufahren.'
    },
    es: {
      formUnavailable: 'Formulario no disponible',
      loadingForm: 'Cargando formulario…',
      unableToLoad: 'No se puede cargar este formulario.',
      unableToReach: 'No se puede contactar con el servicio de widgets de Travelgenix. Inténtalo de nuevo más tarde.',
      headerTitle: 'Cuéntanos sobre tus vacaciones soñadas',
      headerSubtitle: 'Comparte unos datos y uno de nuestros especialistas en viajes te responderá en 24 horas.',
      submitText: 'Enviar mi consulta',
      thankYouMessage: 'Gracias {firstName} — nos ponemos con ello',
      thankYouFallback: 'Gracias{firstName} — nos ponemos con ello',
      thankYouBody: 'Uno de nuestros especialistas en viajes se pondrá en contacto contigo en 24 horas. También hemos enviado una confirmación a tu correo electrónico.',
      reference: 'Referencia {ref}',
      back: 'Atrás',
      continue: 'Siguiente',
      sending: 'Enviando…',
      looksGood: ' ¡Perfecto!',
      secure: 'Seguro',
      gdpr: 'RGPD',
      reply24hr: 'Respuesta en 24 h',
      poweredBy: 'Con la tecnología de ',
      noFieldsStep: 'No hay campos en este paso.',
      stepN: 'Paso {n}',
      securityCheck: 'Comprobación de seguridad',
      securityMisconfigured: 'Comprobación de seguridad mal configurada — ponte en contacto con soporte.',
      securityIncomplete: 'Completa la comprobación de seguridad de arriba antes de enviar.',
      genericError: 'Algo salió mal. Inténtalo de nuevo.',
      fixOneField: 'Corrige el campo resaltado de arriba antes de continuar.',
      fixNFields: 'Corrige los {count} campos resaltados de arriba antes de continuar.',
      checkNFields: 'Revisa los {count} campos resaltados de arriba e inténtalo de nuevo.',
      label_destination: '¿Con qué destino sueñas?',
      dest_placeholder: 'Buscar países, ciudades, complejos...',
      dest_searchAria: 'Buscar destinos',
      dest_remove: 'Quitar {name}',
      dest_help: 'Añade uno, o varios para un viaje a varios destinos.',
      dest_country: 'País',
      dest_city: 'Ciudad',
      dest_cityIn: 'Ciudad · {country}',
      dest_resort: 'Complejo',
      dest_resortIn: 'Complejo · {place}',
      dest_cantFind: '¿No lo encuentras?',
      dest_useTyped: 'Usar «{text}»',
      dest_submitAsTyped: 'Enviar tal cual',
      dest_startTyping: 'Empieza a escribir un país, ciudad o complejo…',
      dest_keepTyping: 'Sigue escribiendo…',
      dest_searching: 'Buscando…',
      dest_noMatches: 'Sin resultados — prueba con otro término',
      dest_searchUnavailable: 'La búsqueda no está disponible temporalmente.',
      dest_required: 'Añade al menos un destino.',
      label_airport: 'Aeropuerto de salida',
      airport_optCount: '(hasta {n})',
      airport_placeholder: 'Buscar aeropuertos (p. ej. Heathrow, LHR, Manchester)...',
      airport_searchAria: 'Buscar aeropuertos',
      airport_remove: 'Quitar {name}',
      airport_flexibleChip: 'Flexible',
      airport_flexibleGroup: 'Flexible',
      airport_flexibleOption: 'Soy flexible con el aeropuerto',
      airport_any: 'Cualquiera',
      airport_max: 'Puedes elegir hasta {n} aeropuertos.',
      airport_noMatches: 'Sin resultados — prueba con otro término',
      airport_noMore: 'No hay más aeropuertos para elegir',
      airport_help: 'Añade uno o más aeropuertos — o elige «flexible» si te da igual.',
      airport_required: 'Elige al menos un aeropuerto de salida.',
      departOn: 'Salida el',
      returnOn: 'Regreso el',
      flexAria: 'Flexible una semana arriba o abajo',
      flexLabel: 'Soy flexible una semana arriba o abajo',
      date_required: 'Elige una fecha de salida.',
      interests_required: 'Elige al menos una opción.',
      date_returnAfter: 'La fecha de regreso debe ser posterior a la de salida.',
      label_duration: 'Duración',
      duration_options: 'Opciones de duración',
      duration_nights: '{n} noches',
      label_travellers: '¿Quién viaja?',
      childAgesAria: 'Edades de los niños',
      childAgesTitle: '¿Qué edad tendrá cada niño al viajar?',
      childN: 'Niño {n}',
      ageYoungest: '{age} (el más pequeño)',
      ageOldest: '{age} (el mayor)',
      decrease: 'Reducir {label} (actualmente {n})',
      increase: 'Aumentar {label} (actualmente {n})',
      adults: 'Adultos',
      adultsSub: '16 años o más',
      children: 'Niños',
      childrenSub: '2 a 15 años',
      infants: 'Bebés',
      infantsSub: 'Menos de 2',
      trav_required: 'Se requiere al menos un adulto.',
      label_budget: 'Presupuesto total aproximado',
      budgetAria: 'Presupuesto por persona',
      budget_amountAria: '{amount} por persona',
      perPerson: 'por persona',
      label_stars: 'Preferencia de categoría',
      stars_options: 'Opciones de categoría',
      stars_cardAria: '{stars} estrellas — {label}. {desc}',
      star3_label: 'Cómodo', star3_desc: '3 estrellas. Gran relación calidad-precio.',
      star4_label: 'Superior', star4_desc: '4 estrellas. El punto justo.',
      star5_label: 'Lujo', star5_desc: '5 estrellas. El trato completo.',
      label_board: 'Régimen',
      board_RO: 'Solo alojamiento', board_BB: 'Alojamiento y desayuno', board_HB: 'Media pensión', board_FB: 'Pensión completa', board_AI: 'Todo incluido',
      board_options: 'Opciones de régimen',
      label_interests: 'Intereses',
      interests_pickMany: '(elige tantos como quieras)',
      int_beach: 'Playa', int_city: 'Ciudad', int_culture: 'Cultura', int_food: 'Gastronomía y vino', int_adventure: 'Aventura', int_family: 'Familia', int_wellness: 'Bienestar', int_honeymoon: 'Luna de miel',
      interests_options: 'Opciones de intereses',
      firstName: 'Nombre',
      lastName: 'Apellidos',
      firstName_ph: 'Ana',
      lastName_ph: 'García',
      firstName_required: 'El nombre es obligatorio.',
      lastName_required: 'Los apellidos son obligatorios.',
      emailAddress: 'Correo electrónico',
      phone: 'Teléfono',
      phoneAria: 'Número de teléfono',
      email_ph: 'ana@ejemplo.com',
      phone_ph: '612 34 56 78',
      optional: '(opcional)',
      email_required: 'El correo electrónico es obligatorio.',
      email_invalid: 'Introduce una dirección de correo electrónico válida.',
      label_notes: '¿Algo más que debamos saber?',
      notesAria: 'Notas',
      notes_ph: 'Requisitos dietéticos, necesidades de accesibilidad, ocasiones especiales, complejos u hoteles concretos que tengas en mente...',
      consent_agreeAria: 'Aceptar que me contacten',
      consent_marketingAria: 'Recibir novedades de marketing',
      consent_contactLabel: 'Acepto que me contacten sobre esta consulta. ',
      consent_contactSub: 'Solo usaremos tus datos para responder a tu consulta.',
      consent_marketingLabel: 'Envíame de vez en cuando inspiración de viajes y ofertas exclusivas.',
      consent_required: 'Marca la casilla de consentimiento para continuar.'
    },
    it: {
      formUnavailable: 'Modulo non disponibile',
      loadingForm: 'Caricamento del modulo…',
      unableToLoad: 'Impossibile caricare questo modulo.',
      unableToReach: 'Impossibile raggiungere il servizio widget di Travelgenix. Riprova più tardi.',
      headerTitle: 'Raccontaci la tua vacanza dei sogni',
      headerSubtitle: 'Condividi qualche dettaglio e uno dei nostri specialisti di viaggio ti ricontatterà entro 24 ore.',
      submitText: 'Invia la mia richiesta',
      thankYouMessage: 'Grazie {firstName} — ci pensiamo noi',
      thankYouFallback: 'Grazie{firstName} — ci pensiamo noi',
      thankYouBody: 'Uno dei nostri specialisti di viaggio ti contatterà entro 24 ore. Abbiamo anche inviato una conferma alla tua email.',
      reference: 'Riferimento {ref}',
      back: 'Indietro',
      continue: 'Avanti',
      sending: 'Invio…',
      looksGood: ' Perfetto!',
      secure: 'Sicuro',
      gdpr: 'GDPR',
      reply24hr: 'Risposta in 24 h',
      poweredBy: 'Realizzato con ',
      noFieldsStep: 'Nessun campo in questo passaggio.',
      stepN: 'Passaggio {n}',
      securityCheck: 'Controllo di sicurezza',
      securityMisconfigured: 'Controllo di sicurezza configurato male — contatta l’assistenza.',
      securityIncomplete: 'Completa il controllo di sicurezza qui sopra prima di inviare.',
      genericError: 'Qualcosa è andato storto. Riprova.',
      fixOneField: 'Correggi il campo evidenziato qui sopra prima di continuare.',
      fixNFields: 'Correggi i {count} campi evidenziati qui sopra prima di continuare.',
      checkNFields: 'Controlla i {count} campi evidenziati qui sopra e riprova.',
      label_destination: 'Dove sogni di andare?',
      dest_placeholder: 'Cerca paesi, città, resort...',
      dest_searchAria: 'Cerca destinazioni',
      dest_remove: 'Rimuovi {name}',
      dest_help: 'Aggiungine una, o più di una per un viaggio in più tappe.',
      dest_country: 'Paese',
      dest_city: 'Città',
      dest_cityIn: 'Città · {country}',
      dest_resort: 'Resort',
      dest_resortIn: 'Resort · {place}',
      dest_cantFind: 'Non la trovi?',
      dest_useTyped: 'Usa "{text}"',
      dest_submitAsTyped: 'Invia come scritto',
      dest_startTyping: 'Inizia a digitare un paese, una città o un resort…',
      dest_keepTyping: 'Continua a digitare…',
      dest_searching: 'Ricerca…',
      dest_noMatches: 'Nessun risultato — prova un altro termine',
      dest_searchUnavailable: 'La ricerca è temporaneamente non disponibile.',
      dest_required: 'Aggiungi almeno una destinazione.',
      label_airport: 'Aeroporto di partenza',
      airport_optCount: '(fino a {n})',
      airport_placeholder: 'Cerca aeroporti (es. Heathrow, LHR, Manchester)...',
      airport_searchAria: 'Cerca aeroporti',
      airport_remove: 'Rimuovi {name}',
      airport_flexibleChip: 'Flessibile',
      airport_flexibleGroup: 'Flessibile',
      airport_flexibleOption: 'Sono flessibile sull’aeroporto',
      airport_any: 'Qualsiasi',
      airport_max: 'Puoi scegliere fino a {n} aeroporti.',
      airport_noMatches: 'Nessun risultato — prova un altro termine',
      airport_noMore: 'Nessun altro aeroporto da scegliere',
      airport_help: 'Aggiungi uno o più aeroporti — oppure scegli "flessibile" se non hai preferenze.',
      airport_required: 'Scegli almeno un aeroporto di partenza.',
      departOn: 'Partenza il',
      returnOn: 'Ritorno il',
      flexAria: 'Flessibile di una settimana in entrambe le direzioni',
      flexLabel: 'Sono flessibile di una settimana in entrambe le direzioni',
      date_required: 'Scegli una data di partenza.',
      interests_required: 'Scegli almeno un\'opzione.',
      date_returnAfter: 'La data di ritorno deve essere successiva alla partenza.',
      label_duration: 'Durata',
      duration_options: 'Opzioni di durata',
      duration_nights: '{n} notti',
      label_travellers: 'Chi viaggia?',
      childAgesAria: 'Età dei bambini',
      childAgesTitle: 'Quanti anni avrà ogni bambino al momento del viaggio?',
      childN: 'Bambino {n}',
      ageYoungest: '{age} (il più piccolo)',
      ageOldest: '{age} (il più grande)',
      decrease: 'Riduci {label} (attualmente {n})',
      increase: 'Aumenta {label} (attualmente {n})',
      adults: 'Adulti',
      adultsSub: '16 anni e oltre',
      children: 'Bambini',
      childrenSub: '2-15 anni',
      infants: 'Neonati',
      infantsSub: 'Sotto i 2 anni',
      trav_required: 'È richiesto almeno un adulto.',
      label_budget: 'Budget totale approssimativo',
      budgetAria: 'Budget a persona',
      budget_amountAria: '{amount} a persona',
      perPerson: 'a persona',
      label_stars: 'Preferenza di categoria',
      stars_options: 'Opzioni di categoria',
      stars_cardAria: '{stars} stelle — {label}. {desc}',
      star3_label: 'Confortevole', star3_desc: '3 stelle. Ottimo rapporto qualità-prezzo.',
      star4_label: 'Superiore', star4_desc: '4 stelle. Il giusto equilibrio.',
      star5_label: 'Lusso', star5_desc: '5 stelle. Trattamento completo.',
      label_board: 'Trattamento',
      board_RO: 'Solo pernottamento', board_BB: 'Bed & breakfast', board_HB: 'Mezza pensione', board_FB: 'Pensione completa', board_AI: 'Tutto incluso',
      board_options: 'Opzioni di trattamento',
      label_interests: 'Interessi',
      interests_pickMany: '(scegline quanti vuoi)',
      int_beach: 'Mare', int_city: 'Città', int_culture: 'Cultura', int_food: 'Cibo e vino', int_adventure: 'Avventura', int_family: 'Famiglia', int_wellness: 'Benessere', int_honeymoon: 'Luna di miele',
      interests_options: 'Opzioni di interessi',
      firstName: 'Nome',
      lastName: 'Cognome',
      firstName_ph: 'Giulia',
      lastName_ph: 'Rossi',
      firstName_required: 'Il nome è obbligatorio.',
      lastName_required: 'Il cognome è obbligatorio.',
      emailAddress: 'Indirizzo email',
      phone: 'Telefono',
      phoneAria: 'Numero di telefono',
      email_ph: 'giulia@esempio.com',
      phone_ph: '320 123 4567',
      optional: '(facoltativo)',
      email_required: 'L’email è obbligatoria.',
      email_invalid: 'Inserisci un indirizzo email valido.',
      label_notes: 'Qualcos’altro che dovremmo sapere?',
      notesAria: 'Note',
      notes_ph: 'Esigenze alimentari, necessità di accessibilità, occasioni speciali, resort o hotel specifici che hai in mente...',
      consent_agreeAria: 'Accetto di essere contattato',
      consent_marketingAria: 'Ricevere aggiornamenti marketing',
      consent_contactLabel: 'Accetto di essere contattato in merito a questa richiesta. ',
      consent_contactSub: 'Useremo i tuoi dati solo per rispondere alla tua richiesta.',
      consent_marketingLabel: 'Inviami ogni tanto ispirazioni di viaggio e offerte esclusive.',
      consent_required: 'Spunta la casella di consenso per continuare.'
    },
    ro: {
      formUnavailable: 'Formular indisponibil',
      loadingForm: 'Se încarcă formularul…',
      unableToLoad: 'Acest formular nu poate fi încărcat.',
      unableToReach: 'Serviciul de widgeturi Travelgenix nu poate fi contactat. Încercați din nou mai târziu.',
      headerTitle: 'Spuneți-ne despre vacanța visurilor dvs.',
      headerSubtitle: 'Lăsați-ne câteva detalii și unul dintre specialiștii noștri în călătorii vă va contacta în 24 de ore.',
      submitText: 'Trimite solicitarea',
      thankYouMessage: 'Mulțumim {firstName} — ne ocupăm de asta',
      thankYouFallback: 'Mulțumim{firstName} — ne ocupăm de asta',
      thankYouBody: 'Unul dintre specialiștii noștri în călătorii vă va contacta în 24 de ore. Am trimis și o confirmare pe adresa dvs. de e-mail.',
      reference: 'Referință {ref}',
      back: 'Înapoi',
      continue: 'Înainte',
      sending: 'Se trimite…',
      looksGood: ' Arată bine!',
      secure: 'Securizat',
      gdpr: 'GDPR',
      reply24hr: 'Răspuns în 24 h',
      poweredBy: 'Susținut de ',
      noFieldsStep: 'Niciun câmp în acest pas.',
      stepN: 'Pasul {n}',
      securityCheck: 'Verificare de securitate',
      securityMisconfigured: 'Verificarea de securitate este configurată greșit — contactați asistența.',
      securityIncomplete: 'Finalizați verificarea de securitate de mai sus înainte de a trimite.',
      genericError: 'Ceva nu a funcționat. Încercați din nou.',
      fixOneField: 'Corectați câmpul evidențiat de mai sus înainte de a continua.',
      fixNFields: 'Corectați cele {count} câmpuri evidențiate de mai sus înainte de a continua.',
      checkNFields: 'Verificați cele {count} câmpuri evidențiate de mai sus și încercați din nou.',
      label_destination: 'Unde visați să ajungeți?',
      dest_placeholder: 'Căutați țări, orașe, stațiuni...',
      dest_searchAria: 'Căutați destinații',
      dest_remove: 'Eliminați {name}',
      dest_help: 'Adăugați una, sau mai multe pentru un sejur cu mai multe opriri.',
      dest_country: 'Țară',
      dest_city: 'Oraș',
      dest_cityIn: 'Oraș · {country}',
      dest_resort: 'Stațiune',
      dest_resortIn: 'Stațiune · {place}',
      dest_cantFind: 'Nu o găsiți?',
      dest_useTyped: 'Folosiți „{text}”',
      dest_submitAsTyped: 'Trimiteți așa cum este',
      dest_startTyping: 'Începeți să tastați o țară, un oraș sau o stațiune…',
      dest_keepTyping: 'Continuați să tastați…',
      dest_searching: 'Se caută…',
      dest_noMatches: 'Niciun rezultat — încercați alt termen',
      dest_searchUnavailable: 'Căutarea este temporar indisponibilă.',
      dest_required: 'Adăugați cel puțin o destinație.',
      label_airport: 'Aeroport de plecare',
      airport_optCount: '(până la {n})',
      airport_placeholder: 'Căutați aeroporturi (ex. Heathrow, LHR, Manchester)...',
      airport_searchAria: 'Căutați aeroporturi',
      airport_remove: 'Eliminați {name}',
      airport_flexibleChip: 'Flexibil',
      airport_flexibleGroup: 'Flexibil',
      airport_flexibleOption: 'Sunt flexibil în privința aeroportului',
      airport_any: 'Oricare',
      airport_max: 'Puteți alege până la {n} aeroporturi.',
      airport_noMatches: 'Niciun rezultat — încercați alt termen',
      airport_noMore: 'Nu mai sunt aeroporturi de ales',
      airport_help: 'Adăugați unul sau mai multe aeroporturi — sau alegeți „flexibil” dacă nu contează.',
      airport_required: 'Alegeți cel puțin un aeroport de plecare.',
      departOn: 'Plecare pe',
      returnOn: 'Întoarcere pe',
      flexAria: 'Flexibil cu o săptămână în plus sau în minus',
      flexLabel: 'Sunt flexibil cu o săptămână în plus sau în minus',
      date_required: 'Alegeți o dată de plecare.',
      interests_required: 'Alegeți cel puțin o opțiune.',
      date_returnAfter: 'Data întoarcerii trebuie să fie după plecare.',
      label_duration: 'Durată',
      duration_options: 'Opțiuni de durată',
      duration_nights: '{n} nopți',
      label_travellers: 'Cine călătorește?',
      childAgesAria: 'Vârstele copiilor',
      childAgesTitle: 'Ce vârstă va avea fiecare copil la momentul călătoriei?',
      childN: 'Copil {n}',
      ageYoungest: '{age} (cel mai mic)',
      ageOldest: '{age} (cel mai mare)',
      decrease: 'Reduceți {label} (în prezent {n})',
      increase: 'Creșteți {label} (în prezent {n})',
      adults: 'Adulți',
      adultsSub: 'Peste 16 ani',
      children: 'Copii',
      childrenSub: '2-15 ani',
      infants: 'Bebeluși',
      infantsSub: 'Sub 2 ani',
      trav_required: 'Este necesar cel puțin un adult.',
      label_budget: 'Buget total aproximativ',
      budgetAria: 'Buget de persoană',
      budget_amountAria: '{amount} de persoană',
      perPerson: 'de persoană',
      label_stars: 'Preferință de clasificare',
      stars_options: 'Opțiuni de clasificare',
      stars_cardAria: '{stars} stele — {label}. {desc}',
      star3_label: 'Confortabil', star3_desc: '3 stele. Raport calitate-preț excelent.',
      star4_label: 'Superior', star4_desc: '4 stele. Echilibrul perfect.',
      star5_label: 'Lux', star5_desc: '5 stele. Răsfăț complet.',
      label_board: 'Tip de masă',
      board_RO: 'Doar cazare', board_BB: 'Mic dejun inclus', board_HB: 'Demipensiune', board_FB: 'Pensiune completă', board_AI: 'All inclusive',
      board_options: 'Opțiuni de masă',
      label_interests: 'Interese',
      interests_pickMany: '(alegeți câte doriți)',
      int_beach: 'Plajă', int_city: 'Oraș', int_culture: 'Cultură', int_food: 'Gastronomie și vinuri', int_adventure: 'Aventură', int_family: 'Familie', int_wellness: 'Wellness', int_honeymoon: 'Lună de miere',
      interests_options: 'Opțiuni de interese',
      firstName: 'Prenume',
      lastName: 'Nume de familie',
      firstName_ph: 'Maria',
      lastName_ph: 'Popescu',
      firstName_required: 'Prenumele este obligatoriu.',
      lastName_required: 'Numele de familie este obligatoriu.',
      emailAddress: 'Adresă de e-mail',
      phone: 'Telefon',
      phoneAria: 'Număr de telefon',
      email_ph: 'maria@exemplu.ro',
      phone_ph: '0712 345 678',
      optional: '(opțional)',
      email_required: 'E-mailul este obligatoriu.',
      email_invalid: 'Introduceți o adresă de e-mail validă.',
      label_notes: 'Altceva ce ar trebui să știm?',
      notesAria: 'Note',
      notes_ph: 'Cerințe alimentare, nevoi de accesibilitate, ocazii speciale, stațiuni sau hoteluri anume pe care le aveți în vedere...',
      consent_agreeAria: 'De acord să fiu contactat',
      consent_marketingAria: 'Primiți noutăți de marketing',
      consent_contactLabel: 'Sunt de acord să fiu contactat în legătură cu această solicitare. ',
      consent_contactSub: 'Vom folosi datele dvs. doar pentru a răspunde solicitării.',
      consent_marketingLabel: 'Trimiteți-mi din când în când inspirație de vacanță și oferte exclusive.',
      consent_required: 'Bifați caseta de consimțământ pentru a continua.'
    }
  };
  // Uses the shared TGi18n core when present; otherwise an identical inline
  // resolver keeps the widget self-contained.
  function makeT(cfg) {
    if (typeof window !== 'undefined' && window.TGi18n && typeof window.TGi18n.make === 'function') return window.TGi18n.make(MESSAGES, cfg);
    var supported = Object.keys(MESSAGES);
    var baseOf = function (r) { return (r ? String(r).toLowerCase().replace(/_/g, '-').split('-')[0] : ''); };
    var cands = [];
    if (cfg) cands.push(cfg.lang, cfg.language, cfg.locale);
    try { cands.push(document.documentElement.getAttribute('lang')); } catch (e) { /* noop */ }
    try { if (navigator.languages) cands = cands.concat(navigator.languages); cands.push(navigator.language); } catch (e) { /* noop */ }
    var lang = 'en';
    for (var i = 0; i < cands.length; i++) { var b = baseOf(cands[i]); if (b && supported.indexOf(b) !== -1) { lang = b; break; } }
    var dict = MESSAGES[lang] || MESSAGES.en;
    var t = function (k, vars) {
      var s = Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (MESSAGES.en[k] || k);
      if (vars) s = String(s).replace(/\{(\w+)\}/g, function (m, n) { return (vars[n] != null ? vars[n] : m); });
      return s;
    };
    t.lang = lang; t.dir = 'ltr';
    return t;
  }
  // Turnstile challenges are loaded via an iframe pointing at our own domain
  // (/turnstile-frame.html) rather than directly on the host page. Cloudflare
  // sitekeys are bound to hostnames, so we can't whitelist every client's site.
  // The iframe runs on OUR whitelisted domain and postMessages the solved
  // token back to the widget. See: public/turnstile-frame.html
  var TURNSTILE_FRAME_PATH = '/turnstile-frame.html';

  // Deduce API base from this script's src, fallback to the production host.
  // Same pattern as every other widget in the suite.
  var API_BASE = (function () {
    try {
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].getAttribute('src') || '';
        if (src.indexOf('/widget-enquiry.js') !== -1) {
          var a = document.createElement('a');
          a.href = src;
          return a.protocol + '//' + a.host;
        }
      }
    } catch (e) {}
    return 'https://tg-widgets.vercel.app';
  })();

  // Unique ID prefix per widget instance — multiple widgets on the same page
  // must not collide on generated element IDs (aria-describedby etc.)
  var INSTANCE_COUNTER = 0;

  // ── Widget-log alerting ────────────────────────────────────────────────────
  // Beacon genuine failures (config load HTTP errors, final submit failures)
  // to /api/widget-log so an outage or a broken embed alerts us instead of
  // waiting for a client to report it. The server de-dupes per widget+site for
  // 30 minutes; the once-per-page guard here keeps a single visitor from
  // firing more than one alert. Telemetry must never throw or block the form.
  var WIDGET_LOG_URL = API_BASE + '/api/widget-log';
  function beacon(event, message, detail, widgetId) {
    try {
      var b = JSON.stringify({
        event: event, widget: 'enquiry', widgetId: String(widgetId || ''),
        message: String(message || '').slice(0, 300), detail: String(detail || '').slice(0, 500),
        url: (function () { try { return location.href; } catch (e) { return ''; } })()
      });
      if (navigator && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(WIDGET_LOG_URL, new Blob([b], { type: 'text/plain' }))) return;
      fetch(WIDGET_LOG_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: b, keepalive: true, credentials: 'omit' }).catch(function () {});
    } catch (e) { /* telemetry must never throw */ }
  }
  var reportedThisPage = false;
  function report(message, detail, widgetId) {
    if (reportedThisPage) return;
    reportedThisPage = true;
    beacon('error', message, detail, widgetId);
  }
  // One 'load' heartbeat per successful mount, so an empty log distinguishes
  // "widget never ran on that page" from "widget healthy, nobody failing".
  function heartbeat(widgetId) {
    beacon('load', 'mounted', 'v' + WIDGET_VERSION, widgetId);
  }

  // ============================================================================
  //  Utilities
  // ============================================================================

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2), v);
        } else if (k === 'style' && typeof v === 'object') {
          for (var s in v) node.style[s] = v[s];
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, String(v));
        }
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      for (var j = 0; j < children.length; j++) {
        var c = children[j];
        if (c === null || c === undefined || c === false) continue;
        if (typeof c === 'string' || typeof c === 'number') {
          node.appendChild(document.createTextNode(String(c)));
        } else if (c.nodeType) {
          node.appendChild(c);
        }
      }
    }
    return node;
  }

  function svg(paths, attrs) {
    attrs = attrs || {};
    var svgNs = 'http://www.w3.org/2000/svg';
    var node = document.createElementNS(svgNs, 'svg');
    node.setAttribute('viewBox', attrs.viewBox || '0 0 24 24');
    node.setAttribute('fill', attrs.fill || 'none');
    node.setAttribute('stroke', attrs.stroke || 'currentColor');
    node.setAttribute('stroke-width', attrs.strokeWidth || '2');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    node.setAttribute('width', attrs.size || '16');
    node.setAttribute('height', attrs.size || '16');
    node.setAttribute('aria-hidden', 'true');
    if (attrs.class) node.setAttribute('class', attrs.class);
    if (typeof paths === 'string') paths = [paths];
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS(svgNs, 'path');
      p.setAttribute('d', paths[i]);
      node.appendChild(p);
    }
    return node;
  }

  function starIcon(size) {
    var svgNs = 'http://www.w3.org/2000/svg';
    var node = document.createElementNS(svgNs, 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('fill', 'currentColor');
    node.setAttribute('width', size || 14);
    node.setAttribute('height', size || 14);
    node.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(svgNs, 'polygon');
    p.setAttribute('points', '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2');
    node.appendChild(p);
    return node;
  }

  var ICONS = {
    pin:      'M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0116 0zm-8 3a3 3 0 100-6 3 3 0 000 6z',
    clock:    'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4v6l4 2',
    check:    'M20 6L9 17l-5-5',
    x:        'M18 6L6 18M6 6l12 12',
    plus:     'M12 5v14M5 12h14',
    minus:    'M5 12h14',
    spinner:  'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
    arrow:    'M5 12h14M12 5l7 7-7 7',
    arrowLeft:'M19 12H5M12 19l-7-7 7-7',
    heart:    'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
    wave:     'M2 12c2 0 2-4 4-4s2 4 4 4 2-4 4-4 2 4 4 4 2-4 4-4',
    building: 'M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18M6 12h12M6 7h12',
    museum:   'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z',
    utensils: 'M6 2v7m0 0c0 3 2 4 6 4s6-1 6-4V2M12 13v9',
    compass:  'M8 3v3M16 3v3M3 9l2 12h14l2-12H3z',
    users:    'M9 7a4 4 0 110 8 4 4 0 010-8zm8 14v-2a4 4 0 00-3-3.87M17 3.13a4 4 0 010 7.75',
    alert:    'M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z'
  };

  function getVisitorId() {
    try {
      var existing = localStorage.getItem(VISITOR_ID_KEY);
      if (existing && /^v_[a-f0-9]{24,}$/.test(existing)) return existing;
      var rnd = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(rnd);
      var hex = Array.prototype.map.call(rnd, function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
      var id = 'v_' + hex;
      try { localStorage.setItem(VISITOR_ID_KEY, id); } catch (e) {}
      return id;
    } catch (e) {
      return 'v_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    }
  }

  // ============================================================================
  //  Turnstile iframe helper
  //
  //  The challenge runs inside an iframe pointing at /turnstile-frame.html on
  //  our domain (tg-widgets.vercel.app or widgets.travelify.io). Cloudflare
  //  Turnstile sitekeys are bound to hostnames, so we can't render directly on
  //  client sites — instead the iframe on our whitelisted domain handles the
  //  challenge and postMessages the token back to the widget.
  //
  //  The helpers below build the iframe, wire up the message listener, and
  //  expose reset() so the widget can re-challenge after a failed submit.
  // ============================================================================

  // Build the iframe src URL, passing sitekey + theme as query params.
  // API_BASE resolves to whichever origin the widget script was served from,
  // which is the domain whitelisted in Cloudflare.
  function buildTurnstileFrameUrl(sitekey, theme) {
    var qs = new URLSearchParams();
    qs.set('sitekey', sitekey);
    qs.set('theme', theme === 'dark' ? 'dark' : 'light');
    return API_BASE + TURNSTILE_FRAME_PATH + '?' + qs.toString();
  }

  // Create a Turnstile iframe controller. Returns { iframe, reset, destroy,
  // getToken } so the widget's submit handler can check token state without
  // caring about the underlying postMessage plumbing.
  function createTurnstileFrame(sitekey, theme, onTokenChange, t) {
    t = t || makeT(null);
    var frame = document.createElement('iframe');
    frame.src = buildTurnstileFrameUrl(sitekey, theme);
    // Constrain the iframe — no scrollbars, transparent background, sized to
    // fit Turnstile's standard 300x65 widget. The host page around it handles
    // layout (padding etc.) in the surrounding .tg-turnstile wrapper.
    frame.setAttribute('title', t('securityCheck'));
    frame.setAttribute('aria-label', t('securityCheck'));
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('frameborder', '0');
    frame.style.cssText = 'border:0;width:300px;height:65px;background:transparent;color-scheme:normal;';
    // Narrow sandbox: allow the scripts Turnstile needs, but nothing else.
    // - allow-scripts: required for Turnstile itself
    // - allow-same-origin: required for Turnstile to set its internal cookies
    //   and read its own challenge response. Combined with sandbox, this is
    //   safe because the iframe origin is our domain, which we trust.
    // We deliberately DO NOT allow: forms, popups, top-navigation, downloads.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');

    var token = null;
    var frameOrigin = (function () {
      try {
        var a = document.createElement('a');
        a.href = API_BASE;
        return a.protocol + '//' + a.host;
      } catch (e) { return null; }
    })();

    function onMessage(event) {
      // Strict origin check — only accept messages from the iframe's origin.
      if (!frameOrigin || event.origin !== frameOrigin) return;
      var data = event.data;
      if (!data || data.source !== 'tg-turnstile') return;

      if (data.type === 'token' && typeof data.token === 'string') {
        token = data.token;
        if (onTokenChange) onTokenChange(token);
      } else if (data.type === 'expired' || data.type === 'timeout' || data.type === 'error') {
        token = null;
        if (onTokenChange) onTokenChange(null);
      }
      // 'ready' is informational — iframe has rendered the challenge. We could
      // surface a loading-to-ready transition here if needed, but not worth it.
    }

    window.addEventListener('message', onMessage);

    return {
      iframe: frame,
      getToken: function () { return token; },
      reset: function () {
        // Ask the iframe to reset its challenge (used after a failed submit
        // so the user can try again with a fresh token).
        if (!frame.contentWindow || !frameOrigin) return;
        try {
          frame.contentWindow.postMessage(
            { source: 'tg-enquiry-widget', type: 'reset' },
            frameOrigin
          );
          token = null;
          if (onTokenChange) onTokenChange(null);
        } catch (e) { /* ignore */ }
      },
      destroy: function () {
        window.removeEventListener('message', onMessage);
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        token = null;
      }
    };
  }

  // ============================================================================
  //  Reference data — session 1 static seed. Session 3+ will fetch from Luna Brain.
  // ============================================================================

  var DESTINATIONS = [
    { group: 'Popular right now', items: [
      { id: 'maldives',    name: 'Maldives',       meta: 'Country' },
      { id: 'santorini',   name: 'Santorini',      meta: 'Island · Greece' },
      { id: 'mykonos',     name: 'Mykonos',        meta: 'Island · Greece' },
      { id: 'dubai',       name: 'Dubai',          meta: 'City · UAE' },
      { id: 'barbados',    name: 'Barbados',       meta: 'Caribbean' }
    ]},
    { group: 'Europe', items: [
      { id: 'algarve',     name: 'Algarve',        meta: 'Region · Portugal' },
      { id: 'amalfi',      name: 'Amalfi Coast',   meta: 'Region · Italy' },
      { id: 'ibiza',       name: 'Ibiza',          meta: 'Island · Spain' },
      { id: 'crete',       name: 'Crete',          meta: 'Island · Greece' },
      { id: 'tenerife',    name: 'Tenerife',       meta: 'Island · Spain' },
      { id: 'lanzarote',   name: 'Lanzarote',      meta: 'Island · Spain' }
    ]},
    { group: 'Long haul', items: [
      { id: 'bali',        name: 'Bali',           meta: 'Island · Indonesia' },
      { id: 'mauritius',   name: 'Mauritius',      meta: 'Country' },
      { id: 'thailand',    name: 'Thailand',       meta: 'Country' },
      { id: 'mexico',      name: 'Mexico',         meta: 'Country' },
      { id: 'florida',     name: 'Florida',        meta: 'Region · USA' }
    ]}
  ];

  var AIRPORTS = [
    { region: 'London & South', codes: [
      { code: 'LHR', name: 'London Heathrow' }, { code: 'LGW', name: 'London Gatwick' },
      { code: 'STN', name: 'London Stansted' }, { code: 'LTN', name: 'London Luton' },
      { code: 'LCY', name: 'London City' },     { code: 'SOU', name: 'Southampton' }
    ]},
    { region: 'Midlands & North', codes: [
      { code: 'MAN', name: 'Manchester' }, { code: 'BHX', name: 'Birmingham' },
      { code: 'EMA', name: 'East Midlands' }, { code: 'LBA', name: 'Leeds Bradford' },
      { code: 'NCL', name: 'Newcastle' }, { code: 'LPL', name: 'Liverpool' }
    ]},
    { region: 'Scotland', codes: [
      { code: 'EDI', name: 'Edinburgh' }, { code: 'GLA', name: 'Glasgow' }, { code: 'ABZ', name: 'Aberdeen' }
    ]},
    { region: 'Southwest, Wales & NI', codes: [
      { code: 'BRS', name: 'Bristol' }, { code: 'CWL', name: 'Cardiff' }, { code: 'BFS', name: 'Belfast' }
    ]}
  ];

  var INTEREST_OPTIONS = [
    { value: 'beach',     label: 'Beach',       icon: 'wave' },
    { value: 'city',      label: 'City',        icon: 'building' },
    { value: 'culture',   label: 'Culture',     icon: 'museum' },
    { value: 'food',      label: 'Food & wine', icon: 'utensils' },
    { value: 'adventure', label: 'Adventure',   icon: 'compass' },
    { value: 'family',    label: 'Family',      icon: 'users' },
    { value: 'wellness',  label: 'Wellness',    icon: 'pin' },
    { value: 'honeymoon', label: 'Honeymoon',   icon: 'heart' }
  ];

  var BOARD_OPTIONS = [
    { value: 'RO', label: 'Room only' }, { value: 'BB', label: 'B&B' },
    { value: 'HB', label: 'Half board' }, { value: 'FB', label: 'Full board' },
    { value: 'AI', label: 'All inclusive' }
  ];

  var STAR_OPTIONS = [
    { stars: 3, label: 'Comfortable', desc: '3-star. Great value.' },
    { stars: 4, label: 'Superior',    desc: '4-star. The sweet spot.', preselect: true },
    { stars: 5, label: 'Luxury',      desc: '5-star. The full treatment.', luxury: true }
  ];

  // ============================================================================
  //  Default field set — used when config has no fieldsJSON
  // ============================================================================

  function defaultFieldSet() {
    return [
      { id: 'destination',       type: 'destination',       label: 'Where are you dreaming of?', required: true,  visible: true },
      { id: 'departure_airport', type: 'airport',           label: 'Departure airport',          required: true,  visible: true },
      { id: 'travel_dates',      type: 'daterange',         label: 'Travel dates',               required: true,  visible: true },
      { id: 'duration',          type: 'duration',          label: 'Duration',                   required: false, visible: true },
      { id: 'travellers',        type: 'travellers',        label: "Who's travelling?",          required: true,  visible: true },
      { id: 'budget_pp',         type: 'budget',            label: 'Approximate total budget',   required: false, visible: true },
      { id: 'stars',             type: 'stars',             label: 'Star rating preference',     required: false, visible: true },
      { id: 'board',             type: 'board',             label: 'Board basis',                required: false, visible: true },
      { id: 'interests',         type: 'interests',         label: 'Interests',                  required: false, visible: true },
      { id: 'name',              type: 'name',              label: 'Your name',                  required: true,  visible: true },
      { id: 'contact',           type: 'contact',           label: 'How to reach you',           required: true,  visible: true },
      { id: 'notes',             type: 'notes',             label: 'Anything else?',             required: false, visible: true },
      { id: 'consent',           type: 'consent',           label: 'Consent',                    required: true,  visible: true }
    ];
  }

  // ============================================================================
  //  Styles — scoped to shadow DOM (same CSS as v0.3.0)
  // ============================================================================

  // Colours and font are interpolated into the shadow <style> block. It's set
  // via textContent so there's no </style> HTML breakout, but an unvalidated
  // value could still inject CSS declarations/rules ( ; { } ) or break the
  // quoted font name ( " ). Validate to hex / a plain font name.
  function safeHexColour(v, fb) {
    var s = String(v == null ? '' : v).trim();
    return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s) ? s : fb;
  }
  function safeFontName(v, fb) {
    var s = String(v == null ? '' : v).trim();
    return (s && s.length <= 60 && /^[A-Za-z0-9 ,-]+$/.test(s)) ? s : fb;
  }

  function buildStyles(brand) {
    var accent = safeHexColour(brand && brand.accentColour, '#00B4D8');
    var primary = safeHexColour(brand && brand.buttonColour, '#1B2B5B');
    var isDark = (brand && brand.theme) === 'dark';

    // Base theme colour map — used as fallback when the user hasn't overridden
    // a specific colour in the branding inspector.
    var baseDark = {
      bg: '#0F172A', bgAlt: '#1E293B', bgTile: '#334155',
      border: '#334155', borderLight: '#1E293B',
      text: '#F8FAFC', textSecondary: '#CBD5E1', textTertiary: '#64748B'
    };
    var baseLight = {
      bg: '#FFFFFF', bgAlt: '#F8FAFC', bgTile: '#F1F5F9',
      border: '#E2E8F0', borderLight: '#F1F5F9',
      text: '#0F172A', textSecondary: '#475569', textTertiary: '#94A3B8'
    };
    var base = isDark ? baseDark : baseLight;

    // Apply branding overrides — if the user set a specific text/bg/border
    // colour in the editor, it wins over the theme default. Leaving a value
    // blank falls back to the sensible theme-based default above.
    var c = {
      bg:             safeHexColour(brand && brand.bgColour, base.bg),
      bgAlt:          base.bgAlt,
      bgTile:         base.bgTile,
      border:         safeHexColour(brand && brand.borderColour, base.border),
      borderLight:    base.borderLight,
      text:           safeHexColour(brand && brand.textColour, base.text),
      textSecondary:  base.textSecondary,
      textTertiary:   base.textTertiary
    };
    var errorC = safeHexColour(brand && brand.errorColour, '#DC2626');

    // Corner radius — translates the editor's segmented value to actual px.
    // Applied to card, inputs, pills, chips, buttons. Keeps proportions sensible
    // (e.g. pills stay rounded even when "None" is picked so they still read
    // as pills, not rectangles).
    var radiusMap = { none: 0, small: 4, medium: 8, large: 14 };
    // Allow-list the enum: an unknown/typo value (config is untrusted) must fall
    // back to the default, not yield undefined -> NaNpx.
    var radiusVal = radiusMap[brand && brand.cornerRadius];
    if (radiusVal == null) radiusVal = radiusMap.medium;
    var radiusCard = radiusVal * 2; // cards are rounder
    var radiusInput = radiusVal;
    var radiusBtn = radiusInput;

    // Field size — compact/comfortable/spacious affects input height, pill
    // height, section padding. Numbers picked to be visually distinct without
    // causing any layout breakage.
    var sizeMap = {
      compact:     { inputH: 38, pillH: 34, sectionY: 18, sectionX: 24 },
      comfortable: { inputH: 44, pillH: 40, sectionY: 24, sectionX: 32 },
      spacious:    { inputH: 52, pillH: 46, sectionY: 32, sectionX: 36 }
    };
    // Allow-list the enum: an unknown fieldSize would leave sz undefined and
    // throw on sz.sectionY below, so the whole form never renders (no lead).
    var sz = sizeMap[brand && brand.fieldSize] || sizeMap.comfortable;

    // Field style — outlined (default), filled (light grey background, no
    // border), underlined (no side borders, only bottom underline).
    var fieldStyle = (brand && brand.fieldStyle) || 'outlined';
    var inputBg, inputBorder, inputBorderBottom;
    if (fieldStyle === 'filled') {
      inputBg = c.bgTile;
      inputBorder = '1px solid transparent';
      inputBorderBottom = '';
    } else if (fieldStyle === 'underlined') {
      inputBg = 'transparent';
      inputBorder = 'none';
      inputBorderBottom = 'border-bottom: 1px solid ' + c.border + ';border-radius: 0;';
    } else {
      inputBg = c.bg;
      inputBorder = '1px solid ' + c.border;
      inputBorderBottom = '';
    }

    // Font family — if a Google Font is picked, we load it via an @import
    // at the top of the stylesheet. "system" means don't load anything,
    // just use the system font stack. Loading happens inside the shadow DOM
    // so it doesn't conflict with the host page.
    var ff = safeFontName(brand && brand.fontFamily, 'Inter');
    var fontStack, fontImport = '';
    if (ff === 'system') {
      fontStack = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
    } else {
      fontStack = '"' + ff + '",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
      fontImport = '@import url("https://fonts.googleapis.com/css2?family=' + encodeURIComponent(ff).replace(/%20/g, '+') + ':wght@400;500;600;700&display=swap");';
    }

    return [
      fontImport,
      ':host{all:initial;display:block;font-family:' + fontStack + ';font-size:15px;line-height:1.6;color:' + c.text + ';}',
      '*,*::before,*::after{box-sizing:border-box}',
      'button{font-family:inherit;font-size:inherit;cursor:pointer}',
      'input,select,textarea{font-family:inherit;font-size:inherit;color:inherit}',
      '.tg-card{background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:' + radiusCard + 'px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.06)}',
      '.tg-hero{padding:' + (sz.sectionY + 4) + 'px ' + sz.sectionX + 'px ' + sz.sectionY + 'px;border-bottom:1px solid ' + c.borderLight + '}',
      '.tg-hero-logo{display:block;max-height:40px;max-width:200px;margin-bottom:14px;object-fit:contain}',
      '.tg-hero h2{margin:0 0 6px;font-size:22px;font-weight:600;color:' + c.text + '}',
      '.tg-hero p{margin:0;color:' + c.textSecondary + ';font-size:14px}',
      '.tg-section{padding:' + sz.sectionY + 'px ' + sz.sectionX + 'px;border-bottom:1px solid ' + c.borderLight + '}',
      '.tg-section:last-of-type{border-bottom:none}',
      '.tg-field{margin-bottom:18px}',
      '.tg-field:last-child{margin-bottom:0}',
      '.tg-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
      '@media(max-width:540px){.tg-row{grid-template-columns:1fr}}',
      '.tg-label{display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:' + c.text + '}',
      '.tg-label .tg-opt{color:' + c.textTertiary + ';font-weight:400;margin-left:4px}',
      '.tg-help{font-size:12px;color:' + c.textTertiary + ';margin-top:6px}',
      '.tg-field-error{display:none;font-size:12px;color:' + errorC + ';margin-top:6px;align-items:center;gap:6px}',
      '.tg-field-error.is-shown{display:flex}',
      '.tg-field-error svg{flex-shrink:0;width:14px;height:14px}',
      '.tg-field.has-error .tg-input,.tg-field.has-error .tg-textarea,.tg-field.has-error .tg-dest-box{border-color:' + errorC + '}',
      '.tg-summary-error{display:none;margin:0 ' + sz.sectionX + 'px 0;padding:12px 14px;background:' + errorC + '14;border:1px solid ' + errorC + '40;border-radius:' + radiusInput + 'px;color:' + errorC + ';font-size:13px;align-items:flex-start;gap:10px}',
      '.tg-summary-error.is-shown{display:flex}',
      '.tg-summary-error svg{flex-shrink:0;margin-top:2px;color:' + errorC + '}',
      '.tg-input{width:100%;height:' + sz.inputH + 'px;padding:0 14px;border:' + inputBorder + ';' + inputBorderBottom + 'border-radius:' + radiusInput + 'px;background:' + inputBg + ';color:' + c.text + ';transition:border-color .15s,box-shadow .15s;outline:none}',
      '.tg-input:focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-input::placeholder{color:' + c.textTertiary + '}',
      '.tg-textarea{width:100%;min-height:96px;padding:12px 14px;border:' + inputBorder + ';' + inputBorderBottom + 'border-radius:' + radiusInput + 'px;background:' + inputBg + ';color:' + c.text + ';line-height:1.55;resize:vertical;outline:none;transition:border-color .15s,box-shadow .15s;font-family:inherit;font-size:15px}',
      '.tg-textarea:focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-textarea::placeholder{color:' + c.textTertiary + '}',
      '.tg-dest{position:relative}',
      '.tg-dest-box{min-height:' + sz.inputH + 'px;padding:6px 8px 6px 14px;border:' + inputBorder + ';' + inputBorderBottom + 'border-radius:' + radiusInput + 'px;background:' + inputBg + ';display:flex;flex-wrap:wrap;gap:6px;align-items:center;cursor:text;transition:border-color .15s,box-shadow .15s}',
      '.tg-dest-box.is-focus{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 10px;border-radius:999px;background:' + accent + '1A;color:' + accent + ';font-size:13px;font-weight:500}',
      '.tg-chip svg{width:12px;height:12px}',
      '.tg-chip-close{background:none;border:none;padding:2px;cursor:pointer;color:inherit;opacity:.7;display:flex;border-radius:50%}',
      '.tg-chip-close:hover,.tg-chip-close:focus{opacity:1;background:' + accent + '26;outline:none}',
      '.tg-chip-close svg{width:10px;height:10px}',
      '.tg-dest-input{flex:1;min-width:120px;border:none;outline:none;background:transparent;padding:6px 4px;height:auto}',
      '.tg-dest-drop{position:absolute;top:calc(100% + 4px);left:0;right:0;background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:' + radiusInput + 'px;box-shadow:0 12px 28px rgba(15,23,42,.12);max-height:280px;overflow-y:auto;z-index:10;display:none}',
      '.tg-dest-drop.is-open{display:block}',
      '.tg-dest-grouplabel{padding:10px 14px 4px;font-size:11px;font-weight:600;color:' + c.textTertiary + ';text-transform:uppercase;letter-spacing:.06em}',
      '.tg-dest-option{padding:10px 14px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:10px;color:' + c.text + ';border:none;background:none;width:100%;text-align:left}',
      '.tg-dest-option:hover,.tg-dest-option.is-active{background:' + c.bgTile + ';outline:none}',
      '.tg-dest-option-meta{color:' + c.textTertiary + ';font-size:12px;margin-left:auto}',
      '.tg-chips{display:flex;flex-wrap:wrap;gap:8px}',
      '.tg-pill{height:' + sz.pillH + 'px;padding:0 16px;border-radius:999px;border:1px solid ' + c.border + ';background:' + c.bg + ';color:' + c.textSecondary + ';font-size:14px;font-weight:500;display:inline-flex;align-items:center;gap:6px;transition:all .15s;cursor:pointer}',
      '.tg-pill:hover{border-color:' + accent + ';color:' + c.text + '}',
      '.tg-pill:focus-visible{outline:none;box-shadow:0 0 0 3px ' + accent + '33}',
      '.tg-pill.is-active{background:' + primary + ';border-color:' + primary + ';color:#fff}',
      '.tg-pill.is-active svg{color:#fff}',
      '.tg-pill svg{width:14px;height:14px}',
      '.tg-trav-row{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border:1px solid ' + c.border + ';border-radius:' + radiusInput + 'px;background:' + c.bg + ';margin-bottom:8px}',
      '.tg-trav-row:last-of-type{margin-bottom:0}',
      '.tg-trav-meta h4{font-size:14px;font-weight:600;margin:0;color:' + c.text + '}',
      '.tg-trav-meta p{font-size:12px;color:' + c.textTertiary + ';margin:2px 0 0}',
      '.tg-stepper{display:inline-flex;align-items:center;gap:4px;background:' + c.bgTile + ';padding:4px;border-radius:8px}',
      '.tg-step-btn{width:28px;height:28px;border:none;background:' + c.bg + ';border-radius:6px;display:flex;align-items:center;justify-content:center;color:' + c.textSecondary + ';box-shadow:0 1px 2px rgba(15,23,42,.06);cursor:pointer;transition:all .15s}',
      '.tg-step-btn:hover:not(:disabled){color:' + accent + '}',
      '.tg-step-btn:focus-visible{outline:none;box-shadow:0 0 0 2px ' + accent + '}',
      '.tg-step-btn:disabled{opacity:.35;cursor:not-allowed}',
      '.tg-step-val{min-width:26px;text-align:center;font-variant-numeric:tabular-nums;font-weight:600;font-size:14px;color:' + c.text + '}',
      '.tg-child-ages{margin-top:14px;padding:14px;border:1px dashed ' + c.border + ';border-radius:8px;background:' + c.bgAlt + '}',
      '.tg-child-ages-title{font-size:13px;font-weight:500;margin:0 0 10px;color:' + c.text + '}',
      '.tg-child-ages-grid{display:flex;flex-wrap:wrap;gap:10px}',
      '.tg-child-age-item{display:flex;flex-direction:column;gap:4px;min-width:110px}',
      '.tg-child-age-item label{font-size:11px;color:' + c.textTertiary + ';font-weight:500;text-transform:uppercase;letter-spacing:.04em}',
      '.tg-child-age-item select{height:36px;padding:0 10px;border:1px solid ' + c.border + ';border-radius:6px;background:' + c.bg + ';color:' + c.text + ';font-size:13px;outline:none}',
      '.tg-child-age-item select:focus{border-color:' + accent + ';box-shadow:0 0 0 2px ' + accent + '26}',
      '.tg-flex-toggle{display:inline-flex;align-items:center;gap:10px;margin-top:12px;font-size:13px;color:' + c.textSecondary + ';cursor:pointer;user-select:none;position:relative}',
      '.tg-flex-toggle input{position:absolute;opacity:0;pointer-events:none}',
      '.tg-flex-track{width:34px;height:20px;background:' + c.bgTile + ';border-radius:999px;position:relative;transition:background-color .2s;flex-shrink:0}',
      '.tg-flex-track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(15,23,42,.15);transition:transform .2s}',
      '.tg-flex-toggle input:checked ~ .tg-flex-track{background:' + accent + '}',
      '.tg-flex-toggle input:checked ~ .tg-flex-track::after{transform:translateX(14px)}',
      '.tg-flex-toggle input:focus-visible ~ .tg-flex-track{box-shadow:0 0 0 3px ' + accent + '33}',
      '.tg-budget-display{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}',
      '.tg-budget-amount{font-size:24px;font-weight:700;color:' + accent + ';font-variant-numeric:tabular-nums}',
      '.tg-budget-pp{font-size:13px;color:' + c.textSecondary + '}',
      '.tg-range{-webkit-appearance:none;appearance:none;width:100%;height:6px;background:' + c.bgTile + ';border-radius:999px;outline:none;margin:0}',
      '.tg-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;background:' + accent + ';border-radius:50%;cursor:pointer;border:3px solid ' + c.bg + ';box-shadow:0 2px 6px rgba(15,23,42,.15);transition:transform .15s}',
      '.tg-range::-webkit-slider-thumb:hover{transform:scale(1.1)}',
      '.tg-range::-moz-range-thumb{width:22px;height:22px;background:' + accent + ';border-radius:50%;cursor:pointer;border:3px solid ' + c.bg + ';box-shadow:0 2px 6px rgba(15,23,42,.15)}',
      '.tg-range:focus{outline:none}',
      '.tg-range:focus::-webkit-slider-thumb{box-shadow:0 0 0 4px ' + accent + '33,0 2px 6px rgba(15,23,42,.15)}',
      '.tg-budget-markers{display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:' + c.textTertiary + ';font-variant-numeric:tabular-nums}',
      '.tg-star-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}',
      '@media(max-width:700px){.tg-star-grid{grid-template-columns:repeat(2,1fr)}}',
      '@media(max-width:420px){.tg-star-grid{grid-template-columns:1fr}}',
      '.tg-star-card{padding:14px;border:1px solid ' + c.border + ';border-radius:8px;background:' + c.bg + ';cursor:pointer;text-align:left;transition:all .15s;font-family:inherit;color:inherit}',
      '.tg-star-card:hover{border-color:' + accent + '}',
      '.tg-star-card:focus-visible{outline:none;border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '33}',
      '.tg-star-card.is-active{border-color:' + accent + ';background:' + accent + '0D;box-shadow:0 0 0 3px ' + accent + '1A}',
      '.tg-star-icons{display:flex;gap:2px;margin-bottom:8px;color:#F59E0B}',
      '.tg-star-card.luxury .tg-star-icons{color:' + accent + '}',
      '.tg-star-card h4{font-size:14px;font-weight:600;margin:0 0 2px;color:' + c.text + '}',
      '.tg-star-card p{font-size:12px;color:' + c.textTertiary + ';margin:0}',
      '.tg-seg{display:flex;padding:4px;background:' + c.bgTile + ';border-radius:8px;width:100%;gap:2px}',
      '.tg-seg-btn{flex:1;height:36px;padding:0 10px;border:none;background:transparent;border-radius:6px;font-weight:500;font-size:13px;color:' + c.textSecondary + ';cursor:pointer;transition:all .15s;white-space:nowrap}',
      '.tg-seg-btn:hover{color:' + c.text + '}',
      '.tg-seg-btn:focus-visible{outline:none;box-shadow:0 0 0 2px ' + accent + ' inset}',
      '.tg-seg-btn.is-active{background:' + c.bg + ';color:' + c.text + ';box-shadow:0 1px 3px rgba(15,23,42,.08)}',
      '@media(max-width:540px){.tg-seg-btn{font-size:12px;padding:0 6px}}',
      '.tg-turnstile{margin:0 32px 16px;min-height:65px;display:flex;align-items:center;justify-content:center}',
      '.tg-footer{padding:20px 32px 24px;background:' + c.bgAlt + ';display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.tg-submit{height:48px;padding:0 22px;border:none;border-radius:' + radiusBtn + 'px;background:' + primary + ';color:#fff;font-size:15px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all .15s;box-shadow:0 1px 0 rgba(0,0,0,.08),0 1px 3px rgba(15,23,42,.06)}',
      '.tg-submit:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,23,42,.12)}',
      '.tg-submit:focus-visible{outline:none;box-shadow:0 0 0 3px ' + accent + '66}',
      '.tg-submit:disabled{opacity:.6;cursor:not-allowed;transform:none}',
      '.tg-submit .tg-spin{animation:tg-spin 1s linear infinite}',

      // ── Multi-step navigation ────────────────────────────────────────
      // Progress indicator sits below the hero; explicit numbered steps with
      // labels so the user always knows where they are. Completed steps get
      // a check icon styling, current gets the primary colour, future stay
      // muted.
      '.tg-progress{display:flex;align-items:center;justify-content:space-between;padding:20px 32px 4px;gap:8px;overflow-x:auto}',
      '.tg-progress-step{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;color:' + c.textTertiary + ';flex-shrink:0;position:relative}',
      '.tg-progress-step:not(:last-child)::after{content:"";width:24px;height:1px;background:' + c.border + ';margin-left:8px;flex-shrink:0}',
      '.tg-progress-num{width:24px;height:24px;border-radius:50%;background:' + c.bgAlt + ';color:' + c.textTertiary + ';display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;border:1px solid ' + c.border + ';transition:all .2s}',
      '.tg-progress-step.is-current .tg-progress-num{background:' + primary + ';color:#fff;border-color:' + primary + '}',
      '.tg-progress-step.is-current{color:' + c.text + ';font-weight:600}',
      '.tg-progress-step.is-complete .tg-progress-num{background:' + accent + ';color:#fff;border-color:' + accent + '}',
      '.tg-progress-step.is-complete{color:' + c.textSecondary + '}',
      // On narrow screens the labels get truncated/hidden so the progress
      // row does not overflow. Numbers always visible.
      '@media (max-width: 520px){.tg-progress{padding:16px 16px 2px;gap:4px}.tg-progress-label{display:none}.tg-progress-step:not(:last-child)::after{width:12px;margin-left:4px}}',

      // Nav button group — Back | Next/Submit. Submit already exists; we
      // layer Back + Next/Continue buttons in the same group.
      '.tg-nav-buttons{display:flex;gap:10px;align-items:center;margin-left:auto}',
      '.tg-nav-back,.tg-nav-next{height:48px;padding:0 18px;border-radius:' + radiusBtn + 'px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}',
      '.tg-nav-back{background:transparent;color:' + c.textSecondary + ';border:1px solid ' + c.border + '}',
      '.tg-nav-back:hover{background:' + c.bgAlt + ';color:' + c.text + '}',
      '.tg-nav-back:focus-visible{outline:none;box-shadow:0 0 0 3px ' + accent + '33}',
      '.tg-nav-next{background:' + primary + ';color:#fff;border:none;box-shadow:0 1px 0 rgba(0,0,0,.08),0 1px 3px rgba(15,23,42,.06)}',
      '.tg-nav-next:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,23,42,.12)}',
      '.tg-nav-next:focus-visible{outline:none;box-shadow:0 0 0 3px ' + accent + '66}',
      // Step sections — each step fields live in a section, only one
      // visible at a time (display toggled by the nav controller)
      '.tg-step-section{animation:tg-step-in .25s ease}',
      '@keyframes tg-step-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',

      '@keyframes tg-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
      '.tg-trust{display:flex;gap:12px;font-size:11px;color:' + c.textTertiary + '}',
      '.tg-trust span{display:inline-flex;align-items:center;gap:4px}',
      '.tg-honeypot{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important}',
      '.tg-check{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:1px solid ' + c.border + ';border-radius:8px;cursor:pointer;transition:border-color .15s}',
      '.tg-check:hover{border-color:' + accent + '}',
      '.tg-check:focus-within{border-color:' + accent + ';box-shadow:0 0 0 3px ' + accent + '26}',
      '.tg-check input{width:18px;height:18px;accent-color:' + accent + ';margin:2px 0 0;flex-shrink:0;cursor:pointer}',
      '.tg-check-text{font-size:13px;color:' + c.textSecondary + ';line-height:1.5}',
      '.tg-check-text strong{color:' + c.text + ';font-weight:500}',
      '.tg-loading{padding:48px;text-align:center;color:' + c.textTertiary + '}',
      '.tg-loading svg{animation:tg-spin 1s linear infinite;margin-bottom:8px}',
      '.tg-oops{padding:48px 32px;text-align:center}',
      '.tg-oops h3{font-size:18px;font-weight:600;margin:0 0 8px;color:' + c.text + '}',
      '.tg-oops p{color:' + c.textSecondary + ';margin:0 0 16px;font-size:14px}',
      '.tg-ty{padding:48px 32px;text-align:center}',
      '.tg-ty-hero{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;background:linear-gradient(135deg,#10B981,#059669);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 24px rgba(16,185,129,.3)}',
      '.tg-ty-hero svg{width:28px;height:28px}',
      '.tg-ty h2{font-size:26px;font-weight:600;margin:0 0 6px;color:' + c.text + '}',
      '.tg-ty-ref{display:inline-block;padding:4px 12px;margin-top:12px;background:' + c.bgTile + ';border-radius:999px;font-size:12px;font-weight:500;color:' + c.textSecondary + ';font-variant-numeric:tabular-nums;letter-spacing:.04em}',
      '.tg-ty > p{font-size:15px;color:' + c.textSecondary + ';max-width:420px;margin:12px auto 0}',
      '.tg-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
      '@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'
    ].join('\n');
  }

  // ============================================================================
  //  Field renderers
  //
  //  Each renderer returns:
  //    { node, writeTo(fields), validate(), showError(msg), clearError(), focus(), type }
  //
  //  The `type` marker identifies which renderer this is, used by the editor's
  //  field inspector to know what config options to show.
  // ============================================================================

  function createFieldShell(instance, labelText, labelExtras) {
    var errorId = 'tg-' + instance + '-err-' + (++INSTANCE_COUNTER);
    var errorNode = el('div', { class: 'tg-field-error', id: errorId, role: 'alert' }, [
      svg(ICONS.alert, { size: 14 }),
      el('span', { class: 'tg-field-error-text' })
    ]);
    var labelChildren = [labelText];
    if (labelExtras) labelChildren = labelChildren.concat(labelExtras);
    // Give the visible label a stable id so grouped fields (stars, board,
    // duration...) can point their role="group" at it via aria-labelledby.
    // Otherwise a client's custom field label is invisible to screen readers,
    // which only hear the generic group name.
    var labelId = labelText ? 'tg-' + instance + '-lbl-' + INSTANCE_COUNTER : '';
    var fieldNode = el('div', { class: 'tg-field' }, [
      labelText ? el('label', { class: 'tg-label', id: labelId }, labelChildren) : null
    ]);
    return {
      fieldNode: fieldNode,
      errorNode: errorNode,
      errorId: errorId,
      labelId: labelId,
      show: function (msg) {
        fieldNode.classList.add('has-error');
        errorNode.classList.add('is-shown');
        errorNode.querySelector('.tg-field-error-text').textContent = msg;
      },
      clear: function () {
        fieldNode.classList.remove('has-error');
        errorNode.classList.remove('is-shown');
      }
    };
  }

  // NOTE: All 12 renderer implementations (destination, airport, daterange,
  // duration, travellers, budget, stars, board, interests, name, contact,
  // notes, consent) are identical to widget v0.3.0 — lifted byte-for-byte.
  // Only the outer shell (class wrapper, mount, update) has been refactored.

  function renderDestination(instance, fieldSpec, t) {
    t = t || makeT(null);
    // Each entry in `destinations` is a structured object matching the public
    // API shape: { id, name, type, parentCity?, parentCountry? }. Backwards
    // compatible with legacy single-shape { id, name, region } — submit.js
    // accepts either. Free-text entries (user typed something we couldn't
    // match) get type 'free-text' and a synthesised id.
    var destinations = [];
    var shell = createFieldShell(instance, fieldSpec.label || t('label_destination'));

    // Open-text mode (options.mode === 'text'): a plain box instead of the live
    // search combobox, for agents who find the typeahead clunky. The value is
    // submitted as ONE free-text destination — the exact shape the search field
    // already produces for an unmatched entry — so storage, the inbox and emails
    // are byte-for-byte the same downstream. Default mode stays 'search'.
    if (fieldSpec.options && fieldSpec.options.mode === 'text') {
      var textInput = el('input', {
        class: 'tg-input', type: 'text', maxlength: '160',
        placeholder: (fieldSpec.options && fieldSpec.options.placeholder) ? String(fieldSpec.options.placeholder).slice(0, 120) : t('dest_placeholder'),
        'aria-label': fieldSpec.label || t('label_destination'),
        'aria-describedby': shell.errorId,
        oninput: function () { shell.clear(); textInput.removeAttribute('aria-invalid'); }
      });
      shell.fieldNode.appendChild(textInput);
      if (fieldSpec.help !== false) {
        shell.fieldNode.appendChild(el('div', { class: 'tg-help', text: fieldSpec.help || t('dest_help') }));
      }
      shell.fieldNode.appendChild(shell.errorNode);
      return {
        type: 'destination',
        node: shell.fieldNode,
        writeTo: function (fields) {
          var v = textInput.value.trim();
          fields.destinations = v ? [{ id: 'freetext:' + v.toLowerCase().replace(/\s+/g, '-').slice(0, 80), name: v.slice(0, 128), type: 'free-text' }] : [];
        },
        validate: function () {
          if (fieldSpec.required === false) return null;
          return textInput.value.trim() ? null : t('dest_required');
        },
        showError: function (msg) { shell.show(msg); textInput.setAttribute('aria-invalid', 'true'); },
        clearError: function () { shell.clear(); textInput.removeAttribute('aria-invalid'); },
        focus: function () { textInput.focus(); }
      };
    }

    var input = el('input', {
      class: 'tg-dest-input', type: 'text', maxlength: '128',
      // Author-set example text overrides the default (stored under options,
      // like every other per-field option). Set as an attribute (not innerHTML),
      // so it is inert; capped so it cannot bloat the field.
      placeholder: (fieldSpec.options && fieldSpec.options.placeholder) ? String(fieldSpec.options.placeholder).slice(0, 120) : t('dest_placeholder'),
      autocomplete: 'off',
      'aria-label': t('dest_searchAria'),
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      role: 'combobox'
    });
    var box = el('div', { class: 'tg-dest-box' }, [input]);
    var drop = el('div', { class: 'tg-dest-drop', role: 'listbox' });
    var activeIndex = -1;
    var visibleOptions = [];

    // Debounced live search state
    var searchTimer = null;
    var inflightController = null;    // AbortController for in-flight request
    var lastRenderedQuery = null;     // so we know when to re-render

    function renderChips() {
      Array.prototype.slice.call(box.querySelectorAll('.tg-chip')).forEach(function (c) { c.remove(); });
      destinations.forEach(function (d) {
        var closeBtn = el('button', {
          class: 'tg-chip-close', type: 'button',
          'aria-label': t('dest_remove', { name: d.name }),
          onclick: function (e) {
            e.stopPropagation();
            destinations = destinations.filter(function (x) { return x.id !== d.id; });
            renderChips();
            shell.clear();
          }
        }, [svg(ICONS.x)]);
        var chip = el('span', { class: 'tg-chip', role: 'listitem' }, [svg(ICONS.pin), d.name, closeBtn]);
        box.insertBefore(chip, input);
      });
    }

    // Build a human-readable label for a destination result used in the
    // dropdown (e.g. "Hersonissos — Resort, Greece"). Richer than the chip
    // label so visitors can disambiguate similarly-named places.
    function describeResult(item) {
      var parts = [];
      if (item.type === 'country') {
        parts.push(t('dest_country'));
      } else if (item.type === 'city') {
        parts.push(item.parentCountry ? t('dest_cityIn', { country: item.parentCountry }) : t('dest_city'));
      } else if (item.type === 'resort') {
        var tail = [item.parentCity, item.parentCountry].filter(Boolean).join(', ');
        parts.push(tail ? t('dest_resortIn', { place: tail }) : t('dest_resort'));
      }
      return parts.join(' · ');
    }

    // Append options for a single group (country/city/resort) to the dropdown.
    function appendGroup(group) {
      if (!group || !group.results || group.results.length === 0) return;
      drop.appendChild(el('div', {
        class: 'tg-dest-grouplabel', 'aria-hidden': 'true',
        text: group.label
      }));
      group.results.forEach(function (item) {
        // Skip items already selected
        if (destinations.find(function (d) { return d.id === item.id; })) return;
        var opt = el('button', {
          class: 'tg-dest-option', type: 'button',
          role: 'option',
          'aria-selected': 'false',
          onmousedown: function (e) { e.preventDefault(); },
          onclick: function () { selectDestination(item); }
        }, [
          el('span', { text: item.name }),
          el('span', { class: 'tg-dest-option-meta', text: describeResult(item) })
        ]);
        drop.appendChild(opt);
        visibleOptions.push({ node: opt, item: item });
      });
    }

    // Append a "use this text as typed" option at the bottom. Triggered whenever
    // there's a non-empty query — lets visitors submit obscure destinations
    // we haven't indexed.
    function appendFreeTextOption(query) {
      if (!query) return;
      var trimmed = query.trim();
      if (!trimmed) return;
      // Skip if we already have this as free text selected
      if (destinations.find(function (d) { return d.type === 'free-text' && d.name.toLowerCase() === trimmed.toLowerCase(); })) return;
      drop.appendChild(el('div', {
        class: 'tg-dest-grouplabel', 'aria-hidden': 'true',
        text: t('dest_cantFind')
      }));
      var freeItem = {
        // Stable-ish synthesised id — lets removal work and avoids collisions
        // with real record ids (which start with 'rec').
        id: 'freetext:' + trimmed.toLowerCase().replace(/\s+/g, '-').slice(0, 80),
        name: trimmed,
        type: 'free-text'
      };
      var opt = el('button', {
        class: 'tg-dest-option', type: 'button',
        role: 'option',
        'aria-selected': 'false',
        onmousedown: function (e) { e.preventDefault(); },
        onclick: function () { selectDestination(freeItem); }
      }, [
        el('span', { text: t('dest_useTyped', { text: trimmed }) }),
        el('span', { class: 'tg-dest-option-meta', text: t('dest_submitAsTyped') })
      ]);
      drop.appendChild(opt);
      visibleOptions.push({ node: opt, item: freeItem });
    }

    // Render dropdown based on the current query. Short queries (<2 chars)
    // show a "keep typing" hint; longer queries trigger a debounced API call.
    function renderDrop(query) {
      drop.innerHTML = '';
      visibleOptions = [];
      activeIndex = -1;
      var q = (query || '').trim();

      if (q.length === 0) {
        drop.appendChild(el('div', {
          style: { padding: '14px', fontSize: '13px', color: '#94A3B8' },
          text: t('dest_startTyping')
        }));
        return;
      }

      if (q.length < 2) {
        drop.appendChild(el('div', {
          style: { padding: '14px', fontSize: '13px', color: '#94A3B8' },
          text: t('dest_keepTyping')
        }));
        return;
      }

      // Show a loading state while we're debouncing + fetching
      drop.appendChild(el('div', {
        class: 'tg-dest-loading',
        style: { padding: '14px', fontSize: '13px', color: '#94A3B8' },
        text: t('dest_searching')
      }));
      lastRenderedQuery = q;
    }

    // Fetch results for `query` and render them — but only if the query hasn't
    // changed in the meantime (race guard). Uses AbortController so in-flight
    // requests are cancelled when the user keeps typing.
    function fetchAndRender(query) {
      if (inflightController) {
        try { inflightController.abort(); } catch (e) { /* ignore */ }
      }
      inflightController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var thisQuery = query;

      var url = API_BASE + '/api/destinations/search?q=' + encodeURIComponent(query);
      fetch(url, {
        method: 'GET',
        signal: inflightController ? inflightController.signal : undefined,
        headers: { 'Accept': 'application/json' }
      }).then(function (res) {
        if (!res.ok) throw new Error('search_failed');
        return res.json();
      }).then(function (data) {
        // Race guard — if the user has typed more, ignore this response
        if (input.value.trim() !== thisQuery) return;
        if (lastRenderedQuery !== thisQuery) return;

        drop.innerHTML = '';
        visibleOptions = [];
        activeIndex = -1;

        var groups = Array.isArray(data.groups) ? data.groups : [];
        groups.forEach(appendGroup);

        // Always offer the "use as typed" fallback at the bottom
        appendFreeTextOption(thisQuery);

        if (visibleOptions.length === 0) {
          // No groups AND no free-text (can happen if user selected the free
          // text already) — show nothing-to-show message
          drop.appendChild(el('div', {
            style: { padding: '14px', fontSize: '13px', color: '#94A3B8' },
            text: t('dest_noMatches')
          }));
        }
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return; // silenced by newer query
        console.warn('[TGEnquiryWidget] destination search failed:', err && err.message);
        // Network / server error — still let the visitor submit free text
        if (input.value.trim() !== thisQuery) return;
        drop.innerHTML = '';
        visibleOptions = [];
        activeIndex = -1;
        drop.appendChild(el('div', {
          style: { padding: '14px', fontSize: '13px', color: '#DC2626' },
          text: t('dest_searchUnavailable')
        }));
        appendFreeTextOption(thisQuery);
      });
    }

    function scheduleSearch(query) {
      if (searchTimer) clearTimeout(searchTimer);
      var q = (query || '').trim();
      if (q.length < 2) return;
      // 250ms debounce — feels instant but prevents hammering on fast typers
      searchTimer = setTimeout(function () { fetchAndRender(q); }, 250);
    }

    function selectDestination(item) {
      // Dedupe: same id already selected → no-op
      if (destinations.find(function (d) { return d.id === item.id; })) return;
      destinations.push({
        id:            item.id,
        name:          item.name,
        type:          item.type,
        parentCity:    item.parentCity || undefined,
        parentCountry: item.parentCountry || undefined
      });
      input.value = '';
      renderChips();
      renderDrop('');
      shell.clear();
      input.focus();
    }

    function setActiveOption(idx) {
      visibleOptions.forEach(function (o, i) {
        o.node.classList.toggle('is-active', i === idx);
        o.node.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      });
      if (idx >= 0 && visibleOptions[idx]) {
        var elt = visibleOptions[idx].node;
        var elRect = elt.getBoundingClientRect();
        var dropRect = drop.getBoundingClientRect();
        if (elRect.bottom > dropRect.bottom) elt.scrollIntoView({ block: 'end' });
        else if (elRect.top < dropRect.top) elt.scrollIntoView({ block: 'start' });
      }
      activeIndex = idx;
    }

    box.addEventListener('click', function () { input.focus(); });
    input.addEventListener('focus', function () {
      box.classList.add('is-focus');
      drop.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      renderDrop(input.value);
      if (input.value.trim().length >= 2) scheduleSearch(input.value);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        box.classList.remove('is-focus');
        drop.classList.remove('is-open');
        input.setAttribute('aria-expanded', 'false');
        setActiveOption(-1);
      }, 150);
    });
    input.addEventListener('input', function () {
      renderDrop(input.value);
      scheduleSearch(input.value);
    });
    input.addEventListener('keydown', function (e) {
      if (!visibleOptions.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveOption(Math.min(activeIndex + 1, visibleOptions.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveOption(Math.max(activeIndex - 1, 0)); }
      else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); selectDestination(visibleOptions[activeIndex].item); }
      else if (e.key === 'Escape') { input.blur(); }
    });

    shell.fieldNode.appendChild(el('div', { class: 'tg-dest' }, [box, drop]));
    if (fieldSpec.help !== false) {
      shell.fieldNode.appendChild(el('div', { class: 'tg-help', text: fieldSpec.help || t('dest_help') }));
    }
    shell.fieldNode.appendChild(shell.errorNode);
    input.setAttribute('aria-describedby', shell.errorId);

    return {
      type: 'destination',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.destinations = destinations.slice(); },
      validate: function () {
        if (fieldSpec.required === false) return null;
        return destinations.length > 0 ? null : t('dest_required');
      },
      showError: function (msg) { shell.show(msg); input.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); input.removeAttribute('aria-invalid'); },
      focus: function () { input.focus(); }
    };
  }

  function renderAirport(instance, fieldSpec, t) {
    t = t || makeT(null);
    // Multi-select airport picker. Combines a typeahead input with a chip
    // display for selected airports, similar to the destinations field but
    // against a fixed local list (AIRPORTS) — no API call needed.
    //
    // Cap: 5 airports per submission. Travellers typically specify at most
    // "London area" (LHR, LGW, STN) plus one regional — rarely more than
    // that. The cap also keeps the chip bar readable on mobile.
    var MAX_SELECTIONS = 5;
    var shell = createFieldShell(instance, fieldSpec.label || t('label_airport'), [
      ' ',
      el('span', { class: 'tg-opt', text: t('airport_optCount', { n: MAX_SELECTIONS }) })
    ]);

    // Flatten AIRPORTS into a searchable list of { name, code, region, value }.
    // value is the submission string — kept identical to the old single-select
    // so downstream consumers (Airtable, email templates) don't need changes
    // for airport entries beyond "now an array".
    var airportOptions = [];
    AIRPORTS.forEach(function (region) {
      region.codes.forEach(function (a) {
        airportOptions.push({
          code:   a.code,
          name:   a.name,
          region: region.region,
          value:  a.name + ' (' + a.code + ')'
        });
      });
    });
    // "I'm flexible on airport" as a special sentinel — picking it clears
    // all other choices, and selecting others clears it. Matches the old
    // single-select semantics where it was the only other option.
    var FLEXIBLE_VALUE = 'Flexible on airport';

    var selected = [];  // array of { code, name, region, value } or { value: FLEXIBLE_VALUE, flexible: true }

    var input = el('input', {
      class: 'tg-dest-input', type: 'text',
      placeholder: t('airport_placeholder'),
      autocomplete: 'off',
      'aria-label': t('airport_searchAria'),
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      role: 'combobox'
    });
    var box = el('div', { class: 'tg-dest-box' }, [input]);
    var drop = el('div', { class: 'tg-dest-drop', role: 'listbox' });
    var activeIndex = -1;
    var visibleOptions = [];

    function renderChips() {
      // Remove existing chips before rebuilding — simpler than diffing
      Array.prototype.slice.call(box.querySelectorAll('.tg-chip')).forEach(function (c) { c.remove(); });
      selected.forEach(function (s) {
        var closeBtn = el('button', {
          class: 'tg-chip-close', type: 'button',
          'aria-label': t('airport_remove', { name: s.value }),
          onclick: function (e) {
            e.stopPropagation();
            selected = selected.filter(function (x) { return x.value !== s.value; });
            renderChips();
            shell.clear();
          }
        }, [svg(ICONS.x)]);
        // Label uses airport code for brevity — chip bar gets busy with full names
        var label = s.flexible ? t('airport_flexibleChip') : (s.code || s.value);
        var chip = el('span', { class: 'tg-chip', role: 'listitem' }, [
          svg(ICONS.pin), label, closeBtn
        ]);
        box.insertBefore(chip, input);
      });
    }

    function isSelected(value) {
      return selected.some(function (s) { return s.value === value; });
    }

    function addSelection(item) {
      // "Flexible" is exclusive — picking it clears everything else
      if (item.flexible) {
        selected = [{ value: FLEXIBLE_VALUE, flexible: true }];
        input.value = '';
        renderChips();
        renderDrop('');
        shell.clear();
        input.focus();
        return;
      }
      // If "flexible" was selected, picking a specific airport clears it
      selected = selected.filter(function (s) { return !s.flexible; });
      if (selected.length >= MAX_SELECTIONS) {
        shell.show(t('airport_max', { n: MAX_SELECTIONS }));
        return;
      }
      if (isSelected(item.value)) return;
      selected.push(item);
      input.value = '';
      renderChips();
      renderDrop('');
      shell.clear();
      input.focus();
    }

    function renderDrop(query) {
      drop.innerHTML = '';
      visibleOptions = [];
      activeIndex = -1;
      var q = (query || '').toLowerCase().trim();

      // Group matches by region — keeps UK geography scannable
      var matchesByRegion = {};
      airportOptions.forEach(function (item) {
        if (isSelected(item.value)) return;
        if (q) {
          var haystack = (item.name + ' ' + item.code + ' ' + item.region).toLowerCase();
          if (haystack.indexOf(q) === -1) return;
        }
        if (!matchesByRegion[item.region]) matchesByRegion[item.region] = [];
        matchesByRegion[item.region].push(item);
      });

      var any = false;
      // Preserve original region ordering
      AIRPORTS.forEach(function (region) {
        var matches = matchesByRegion[region.region];
        if (!matches || matches.length === 0) return;
        any = true;
        drop.appendChild(el('div', {
          class: 'tg-dest-grouplabel', 'aria-hidden': 'true',
          text: region.region
        }));
        matches.forEach(function (item) {
          var opt = el('button', {
            class: 'tg-dest-option', type: 'button',
            role: 'option',
            'aria-selected': 'false',
            onmousedown: function (e) { e.preventDefault(); },
            onclick: function () { addSelection(item); }
          }, [
            el('span', { text: item.name }),
            el('span', { class: 'tg-dest-option-meta', text: item.code })
          ]);
          drop.appendChild(opt);
          visibleOptions.push({ node: opt, item: item });
        });
      });

      // Flexible option — always available unless a specific airport is selected
      var hasSpecific = selected.some(function (s) { return !s.flexible; });
      if (!hasSpecific) {
        drop.appendChild(el('div', {
          class: 'tg-dest-grouplabel', 'aria-hidden': 'true',
          text: t('airport_flexibleGroup')
        }));
        var flexItem = { value: FLEXIBLE_VALUE, flexible: true };
        var flexOpt = el('button', {
          class: 'tg-dest-option', type: 'button',
          role: 'option',
          'aria-selected': 'false',
          onmousedown: function (e) { e.preventDefault(); },
          onclick: function () { addSelection(flexItem); }
        }, [
          el('span', { text: t('airport_flexibleOption') }),
          el('span', { class: 'tg-dest-option-meta', text: t('airport_any') })
        ]);
        drop.appendChild(flexOpt);
        visibleOptions.push({ node: flexOpt, item: flexItem });
        any = true;
      }

      if (!any) {
        drop.appendChild(el('div', {
          style: { padding: '14px', fontSize: '13px', color: '#94A3B8' },
          text: q ? t('airport_noMatches') : t('airport_noMore')
        }));
      }
    }

    function setActiveOption(idx) {
      visibleOptions.forEach(function (o, i) {
        o.node.classList.toggle('is-active', i === idx);
        o.node.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      });
      if (idx >= 0 && visibleOptions[idx]) {
        var elt = visibleOptions[idx].node;
        var elRect = elt.getBoundingClientRect();
        var dropRect = drop.getBoundingClientRect();
        if (elRect.bottom > dropRect.bottom) elt.scrollIntoView({ block: 'end' });
        else if (elRect.top < dropRect.top) elt.scrollIntoView({ block: 'start' });
      }
      activeIndex = idx;
    }

    box.addEventListener('click', function () { input.focus(); });
    input.addEventListener('focus', function () {
      box.classList.add('is-focus');
      drop.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      renderDrop(input.value);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        box.classList.remove('is-focus');
        drop.classList.remove('is-open');
        input.setAttribute('aria-expanded', 'false');
        setActiveOption(-1);
      }, 150);
    });
    input.addEventListener('input', function () { renderDrop(input.value); });
    input.addEventListener('keydown', function (e) {
      if (!visibleOptions.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveOption(Math.min(activeIndex + 1, visibleOptions.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveOption(Math.max(activeIndex - 1, 0)); }
      else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); addSelection(visibleOptions[activeIndex].item); }
      else if (e.key === 'Escape') { input.blur(); }
      else if (e.key === 'Backspace' && !input.value && selected.length) {
        // Quick removal: backspace in an empty input pops the last chip
        selected.pop();
        renderChips();
        renderDrop('');
      }
    });

    shell.fieldNode.appendChild(el('div', { class: 'tg-dest' }, [box, drop]));
    if (fieldSpec.help !== false) {
      shell.fieldNode.appendChild(el('div', {
        class: 'tg-help',
        text: fieldSpec.help || t('airport_help')
      }));
    }
    shell.fieldNode.appendChild(shell.errorNode);
    input.setAttribute('aria-describedby', shell.errorId);

    return {
      type: 'airport',
      node: shell.fieldNode,
      // Submission payload: array of value strings for straightforward rendering.
      // Kept as an array even if only one is picked — downstream code can
      // .join(', ') or iterate however it likes.
      writeTo: function (fields) {
        fields.departure_airport = selected.map(function (s) { return s.value; });
      },
      validate: function () {
        if (fieldSpec.required === false) return null;
        return selected.length > 0 ? null : t('airport_required');
      },
      showError: function (msg) { shell.show(msg); input.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); input.removeAttribute('aria-invalid'); },
      focus: function () { input.focus(); }
    };
  }

  function renderDateRange(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, null);
    var today = new Date();
    var minDate = today.toISOString().slice(0, 10);
    var departId = 'tg-' + instance + '-depart'; var returnId = 'tg-' + instance + '-return';
    var depart = el('input', { id: departId, class: 'tg-input', type: 'date', min: minDate, 'aria-label': t('departOn'), 'aria-describedby': shell.errorId, onchange: function () { shell.clear(); depart.removeAttribute('aria-invalid'); } });
    var ret = el('input', { id: returnId, class: 'tg-input', type: 'date', min: minDate, 'aria-label': t('returnOn'), 'aria-describedby': shell.errorId, onchange: function () { shell.clear(); ret.removeAttribute('aria-invalid'); } });
    var flexInput = el('input', { type: 'checkbox', 'aria-label': t('flexAria') });
    var flexTrack = el('span', { class: 'tg-flex-track', 'aria-hidden': 'true' });

    depart.addEventListener('change', function () {
      if (depart.value) { ret.min = depart.value; if (ret.value && ret.value < depart.value) ret.value = ''; }
    });

    shell.fieldNode.appendChild(el('div', { class: 'tg-row' }, [
      el('div', {}, [el('label', { class: 'tg-label', for: departId, text: t('departOn') }), depart]),
      el('div', {}, [el('label', { class: 'tg-label', for: returnId, text: t('returnOn') }), ret])
    ]));
    shell.fieldNode.appendChild(el('label', { class: 'tg-flex-toggle' }, [flexInput, flexTrack, el('span', { text: t('flexLabel') })]));
    shell.fieldNode.appendChild(shell.errorNode);

    return {
      type: 'daterange',
      node: shell.fieldNode,
      writeTo: function (fields) {
        // Only include dates that are actually set — a null used to be sent
        // for a blank return date and the server 400'd the whole submission.
        var td = { flexible: !!flexInput.checked };
        if (depart.value) td.depart = depart.value;
        if (ret.value) td['return'] = ret.value;
        fields.travel_dates = td;
      },
      validate: function () {
        if (fieldSpec.required === false) return null;
        if (!depart.value) return t('date_required');
        if (ret.value && ret.value < depart.value) return t('date_returnAfter');
        return null;
      },
      showError: function (msg) { shell.show(msg); depart.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); depart.removeAttribute('aria-invalid'); ret.removeAttribute('aria-invalid'); },
      focus: function () { (depart.value ? ret : depart).focus(); }
    };
  }

  // Per-form duration options from field.choices (the same slot interests uses).
  // Each entry is a label: a bare number or "N nights" becomes an N-night option
  // (submitted as duration.nights); anything else, e.g. "3-5 nights", is a
  // labelled option (submitted as duration.custom, which the server already
  // accepts). Returns [{nights|null, custom|null}] or null → the built-in
  // [3,5,7,10,14], so every untouched form is unchanged.
  function normaliseDurationOptions(fieldSpec) {
    var raw = fieldSpec && fieldSpec.choices;
    if (!Array.isArray(raw) || !raw.length) return null;
    var out = [];
    for (var i = 0; i < raw.length && out.length < 12; i++) {
      var item = raw[i];
      var label = (item && typeof item === 'object') ? (item.label != null ? item.label : (item.value != null ? item.value : '')) : item;
      label = String(label == null ? '' : label).trim().slice(0, 40);
      if (!label) continue;
      var m = label.match(/^(\d{1,3})(?:\s*nights?)?$/i);
      var nights = m ? parseInt(m[1], 10) : null;
      if (nights != null && (nights < 1 || nights > 90)) nights = null;
      out.push(nights != null ? { nights: nights, custom: null } : { nights: null, custom: label });
    }
    return out.length ? out : null;
  }

  function renderDuration(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, fieldSpec.label || t('label_duration'));
    var options = normaliseDurationOptions(fieldSpec) ||
      [{ nights: 3, custom: null }, { nights: 5, custom: null }, { nights: 7, custom: null }, { nights: 10, custom: null }, { nights: 14, custom: null }];
    // Display: a night count is localised "{n} nights"; a custom option shows verbatim.
    options = options.map(function (o) {
      return { nights: o.nights, custom: o.custom, label: (o.nights != null ? t('duration_nights', { n: o.nights }) : o.custom) };
    });
    // Pre-select 7 nights when present (unchanged for the built-in set), else the first.
    var selectedIdx = 0;
    for (var si = 0; si < options.length; si++) { if (options[si].nights === 7) { selectedIdx = si; break; } }
    var buttons = [];
    function setActive(idx) {
      selectedIdx = idx;
      buttons.forEach(function (b, i) {
        var match = i === idx;
        b.classList.toggle('is-active', match);
        b.setAttribute('aria-pressed', match ? 'true' : 'false');
      });
    }
    options.forEach(function (o, idx) {
      var btn = el('button', { class: 'tg-pill' + (idx === selectedIdx ? ' is-active' : ''), type: 'button', 'data-idx': String(idx), 'aria-pressed': (idx === selectedIdx ? 'true' : 'false'), text: o.label, onclick: function () { setActive(idx); } });
      buttons.push(btn);
    });
    shell.fieldNode.appendChild(el('div', { class: 'tg-chips', role: 'group', 'aria-labelledby': shell.labelId, 'aria-label': t('duration_options') }, buttons));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'duration',
      node: shell.fieldNode,
      writeTo: function (fields) {
        var o = options[selectedIdx];
        if (!o) { fields.duration = {}; return; }
        fields.duration = (o.nights != null) ? { nights: o.nights } : { custom: String(o.custom).slice(0, 64) };
      },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { if (buttons[0]) buttons[0].focus(); }
    };
  }

  function renderTravellers(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, fieldSpec.label || t('label_travellers'));
    var values = { adults: 2, children: 0, infants: 0, childAges: [] };
    var childAgesPanel = el('div', { class: 'tg-child-ages', style: { display: 'none' }, role: 'group', 'aria-label': t('childAgesAria') }, [
      el('p', { class: 'tg-child-ages-title', text: t('childAgesTitle') }),
      el('div', { class: 'tg-child-ages-grid' })
    ]);
    var agesGrid = childAgesPanel.querySelector('.tg-child-ages-grid');

    function renderChildAges() {
      agesGrid.innerHTML = '';
      for (var i = 0; i < values.children; i++) {
        var sel = el('select', { 'data-idx': String(i), onchange: (function (idx) { return function (e) { values.childAges[idx] = parseInt(e.target.value, 10); }; })(i) });
        for (var age = 2; age <= 15; age++) {
          var optText = (age === 2) ? t('ageYoungest', { age: age }) : (age === 15) ? t('ageOldest', { age: age }) : String(age);
          var opt = el('option', { value: String(age), text: optText });
          if (values.childAges[i] === age) opt.selected = true;
          sel.appendChild(opt);
        }
        if (values.childAges[i] === undefined) values.childAges[i] = 2;
        var id = 'tg-' + instance + '-cage-' + i;
        agesGrid.appendChild(el('div', { class: 'tg-child-age-item' }, [
          el('label', { for: id, text: t('childN', { n: i + 1 }) }),
          (function () { sel.setAttribute('id', id); return sel; })()
        ]));
      }
      values.childAges = values.childAges.slice(0, values.children);
      childAgesPanel.style.display = values.children > 0 ? 'block' : 'none';
    }

    function stepperRow(label, sub, key, min, max) {
      var valEl = el('span', { class: 'tg-step-val', 'aria-live': 'polite', text: String(values[key]) });
      function update() {
        valEl.textContent = String(values[key]);
        minusBtn.disabled = values[key] <= min;
        plusBtn.disabled = values[key] >= max;
        minusBtn.setAttribute('aria-label', t('decrease', { label: label, n: values[key] }));
        plusBtn.setAttribute('aria-label', t('increase', { label: label, n: values[key] }));
        if (key === 'children') renderChildAges();
        if (key === 'adults') shell.clear();
      }
      var minusBtn = el('button', { class: 'tg-step-btn', type: 'button', onclick: function () { if (values[key] > min) { values[key]--; update(); } } }, [svg(ICONS.minus, { size: 14 })]);
      var plusBtn = el('button', { class: 'tg-step-btn', type: 'button', onclick: function () { if (values[key] < max) { values[key]++; update(); } } }, [svg(ICONS.plus, { size: 14 })]);
      update();
      return el('div', { class: 'tg-trav-row' }, [
        el('div', { class: 'tg-trav-meta' }, [el('h4', { text: label }), el('p', { text: sub })]),
        el('div', { class: 'tg-stepper' }, [minusBtn, valEl, plusBtn])
      ]);
    }

    shell.fieldNode.appendChild(stepperRow(t('adults'), t('adultsSub'), 'adults', 1, 9));
    shell.fieldNode.appendChild(stepperRow(t('children'), t('childrenSub'), 'children', 0, 6));
    shell.fieldNode.appendChild(stepperRow(t('infants'), t('infantsSub'), 'infants', 0, 3));
    shell.fieldNode.appendChild(childAgesPanel);
    shell.fieldNode.appendChild(shell.errorNode);

    return {
      type: 'travellers',
      node: shell.fieldNode,
      writeTo: function (fields) {
        fields.travellers = { adults: values.adults, children: values.children, infants: values.infants, childAges: values.childAges.slice(0, values.children) };
      },
      validate: function () {
        if (fieldSpec.required === false) return null;
        return values.adults > 0 ? null : t('trav_required');
      },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { shell.fieldNode.querySelector('.tg-step-btn').focus(); }
    };
  }

  function renderBudget(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, fieldSpec.label || t('label_budget'));
    function sliderToBudget(v) {
      if (v < 25) return 250 + (v / 25) * (1500 - 250);
      if (v < 50) return 1500 + ((v - 25) / 25) * (3000 - 1500);
      if (v < 75) return 3000 + ((v - 50) / 25) * (5000 - 3000);
      return 5000 + ((v - 75) / 25) * (10000 - 5000);
    }
    var amountEl = el('span', { class: 'tg-budget-amount', 'aria-live': 'polite', text: '£3,000' });
    var range = el('input', { class: 'tg-range', type: 'range', min: '0', max: '100', value: '45', 'aria-label': t('budgetAria'), 'aria-valuemin': '250', 'aria-valuemax': '10000', 'aria-valuenow': '3000', 'aria-valuetext': t('budget_amountAria', { amount: '£3,000' }) });
    var currentBudget = 3000;
    function update() {
      var v = parseInt(range.value, 10);
      currentBudget = Math.round(sliderToBudget(v) / 50) * 50;
      var displayText;
      if (v >= 97) { displayText = '£10,000+'; currentBudget = 10000; }
      else displayText = '£' + currentBudget.toLocaleString('en-GB');
      amountEl.textContent = displayText;
      range.setAttribute('aria-valuenow', String(currentBudget));
      range.setAttribute('aria-valuetext', t('budget_amountAria', { amount: displayText }));
    }
    range.addEventListener('input', update);
    shell.fieldNode.appendChild(el('div', { class: 'tg-budget-display' }, [amountEl, el('span', { class: 'tg-budget-pp', text: t('perPerson') })]));
    shell.fieldNode.appendChild(range);
    shell.fieldNode.appendChild(el('div', { class: 'tg-budget-markers', 'aria-hidden': 'true' }, [
      el('span', { text: '£250' }), el('span', { text: '£1.5k' }), el('span', { text: '£3k' }), el('span', { text: '£5k+' })
    ]));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'budget',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.budget_pp = currentBudget; },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { range.focus(); }
    };
  }

  function renderStars(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, fieldSpec.label || t('label_stars'));
    var selected = 4;
    var cards = [];
    function setActive(stars) {
      selected = stars;
      cards.forEach(function (card) {
        var match = parseInt(card.getAttribute('data-stars'), 10) === stars;
        card.classList.toggle('is-active', match);
        card.setAttribute('aria-pressed', match ? 'true' : 'false');
      });
    }
    STAR_OPTIONS.forEach(function (opt) {
      var icons = el('div', { class: 'tg-star-icons', 'aria-hidden': 'true' });
      for (var i = 0; i < opt.stars; i++) icons.appendChild(starIcon(14));
      // Preset label/desc are fixed chrome — translate via per-rating keys,
      // falling back to the English seed in STAR_OPTIONS.
      var presetLabel = t('star' + opt.stars + '_label') || opt.label;
      var presetDesc = t('star' + opt.stars + '_desc') || opt.desc;
      var card = el('button', {
        class: 'tg-star-card' + (opt.luxury ? ' luxury' : '') + (opt.preselect ? ' is-active' : ''),
        type: 'button', 'data-stars': String(opt.stars),
        'aria-pressed': opt.preselect ? 'true' : 'false',
        'aria-label': t('stars_cardAria', { stars: opt.stars, label: presetLabel, desc: presetDesc }),
        onclick: function () { setActive(opt.stars); }
      }, [icons, el('h4', { text: presetLabel }), el('p', { text: presetDesc })]);
      cards.push(card);
    });
    shell.fieldNode.appendChild(el('div', { class: 'tg-star-grid', role: 'group', 'aria-labelledby': shell.labelId, 'aria-label': t('stars_options') }, cards));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'stars',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.stars = selected; },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { cards[0].focus(); }
    };
  }

  function renderBoard(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, fieldSpec.label || t('label_board'));
    // Author-chosen default (whitelisted to the five board codes). Absent or
    // unrecognised → 'RO', so every form built before this option is unchanged.
    var boardValues = BOARD_OPTIONS.map(function (o) { return o.value; });
    var boardDefault = (fieldSpec.options && fieldSpec.options.default) || fieldSpec.default;
    var selected = boardValues.indexOf(boardDefault) !== -1 ? boardDefault : 'RO';
    var buttons = [];
    function setActive(value) {
      selected = value;
      buttons.forEach(function (btn) {
        var match = btn.getAttribute('data-value') === value;
        btn.classList.toggle('is-active', match);
        btn.setAttribute('aria-pressed', match ? 'true' : 'false');
      });
    }
    BOARD_OPTIONS.forEach(function (opt) {
      // Preset label is fixed chrome — translate via per-value key, falling
      // back to the English seed. The submitted value (opt.value) is unchanged.
      var boardLabel = t('board_' + opt.value) || opt.label;
      var btn = el('button', {
        class: 'tg-seg-btn' + (opt.value === selected ? ' is-active' : ''),
        type: 'button', 'data-value': opt.value,
        'aria-pressed': opt.value === selected ? 'true' : 'false',
        'aria-label': boardLabel, text: boardLabel,
        onclick: function () { setActive(opt.value); }
      });
      buttons.push(btn);
    });
    shell.fieldNode.appendChild(el('div', { class: 'tg-seg', role: 'group', 'aria-labelledby': shell.labelId, 'aria-label': t('board_options') }, buttons));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'board',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.board = selected; },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { buttons[0].focus(); }
    };
  }

  // Normalise a custom options array from the form config: [{ value, label, icon? }].
  // Returns a clean array, or null so the caller falls back to the built-in
  // defaults. Caps the count and lengths, whitelists the icon against ICONS, and
  // never lets an option be empty. Used by the choice fields (interests today).
  function sanitiseChoices(raw) {
    if (!Array.isArray(raw) || !raw.length) return null;
    var out = [];
    for (var i = 0; i < raw.length && out.length < 20; i++) { // server caps selected interests at 20
      var c = raw[i];
      if (!c || typeof c !== 'object') continue;
      var value = String(c.value == null ? '' : c.value).trim().slice(0, 64);
      var label = String(c.label == null ? '' : c.label).trim().slice(0, 80);
      if (!value && !label) continue;
      if (!value) value = label;
      if (!label) label = value;
      var icon = (typeof c.icon === 'string' && ICONS[c.icon]) ? c.icon : 'pin';
      out.push({ value: value, label: label, icon: icon });
    }
    return out.length ? out : null;
  }

  function renderInterests(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, fieldSpec.label || t('label_interests'), [' ', el('span', { class: 'tg-opt', text: t('interests_pickMany') })]);
    var selected = [];
    var buttons = [];
    // Options come from the form config when the agent has customised them
    // (fieldSpec.choices), otherwise the built-in travel set. Only the defaults
    // carry `int_<value>` translation keys, so custom options show their own
    // author label. The submitted value (opt.value) is what lands in the inbox.
    var customChoices = sanitiseChoices(fieldSpec.choices);
    (customChoices || INTEREST_OPTIONS).forEach(function (opt) {
      var interestLabel = customChoices ? opt.label : (t('int_' + opt.value) || opt.label);
      var btn = el('button', {
        class: 'tg-pill', type: 'button', 'data-value': opt.value,
        'aria-pressed': 'false', 'aria-label': interestLabel,
        onclick: function () {
          var idx = selected.indexOf(opt.value);
          if (idx >= 0) { selected.splice(idx, 1); btn.classList.remove('is-active'); btn.setAttribute('aria-pressed', 'false'); }
          else { selected.push(opt.value); btn.classList.add('is-active'); btn.setAttribute('aria-pressed', 'true'); }
        }
      }, [svg(ICONS[opt.icon] || ICONS.pin, { size: 14 }), interestLabel]);
      buttons.push(btn);
    });
    shell.fieldNode.appendChild(el('div', { class: 'tg-chips', role: 'group', 'aria-labelledby': shell.labelId, 'aria-label': t('interests_options') }, buttons));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'interests',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.interests = selected.slice(); },
      validate: function () {
        if (fieldSpec.required === false) return null;
        if (selected.length === 0) return t('interests_required');
        return null;
      },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { buttons[0].focus(); }
    };
  }

  function renderName(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, null);
    var firstId = 'tg-' + instance + '-first'; var lastId = 'tg-' + instance + '-last';
    var first = el('input', { id: firstId, class: 'tg-input', type: 'text', maxlength: '64', placeholder: t('firstName_ph'), 'aria-label': t('firstName'), autocomplete: 'given-name', 'aria-describedby': shell.errorId, oninput: function () { shell.clear(); first.removeAttribute('aria-invalid'); last.removeAttribute('aria-invalid'); } });
    var last = el('input', { id: lastId, class: 'tg-input', type: 'text', maxlength: '64', placeholder: t('lastName_ph'), 'aria-label': t('lastName'), autocomplete: 'family-name', 'aria-describedby': shell.errorId, oninput: function () { shell.clear(); first.removeAttribute('aria-invalid'); last.removeAttribute('aria-invalid'); } });
    shell.fieldNode.appendChild(el('div', { class: 'tg-row' }, [
      el('div', {}, [el('label', { class: 'tg-label', for: firstId, text: t('firstName') }), first]),
      el('div', {}, [el('label', { class: 'tg-label', for: lastId, text: t('lastName') }), last])
    ]));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'name',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.first_name = first.value.trim(); fields.last_name = last.value.trim(); },
      validate: function () {
        if (fieldSpec.required === false) return null;
        if (!first.value.trim()) return t('firstName_required');
        if (!last.value.trim()) return t('lastName_required');
        return null;
      },
      showError: function (msg) { shell.show(msg); if (!first.value.trim()) first.setAttribute('aria-invalid', 'true'); if (!last.value.trim()) last.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); first.removeAttribute('aria-invalid'); last.removeAttribute('aria-invalid'); },
      focus: function () { (first.value.trim() ? last : first).focus(); }
    };
  }

  function renderContact(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, null);
    // Phone is optional by default (unchanged for every existing form). A form
    // may opt in to requiring it with options.phoneRequired:true — then the
    // "(optional)" hint is dropped and an empty phone blocks submission.
    var phoneRequired = (fieldSpec.options && fieldSpec.options.phoneRequired === true) || fieldSpec.phoneRequired === true;
    var emailId = 'tg-' + instance + '-email'; var phoneId = 'tg-' + instance + '-phone';
    var email = el('input', { id: emailId, class: 'tg-input', type: 'email', placeholder: t('email_ph'), 'aria-label': t('emailAddress'), autocomplete: 'email', required: true, 'aria-describedby': shell.errorId, oninput: function () { shell.clear(); email.removeAttribute('aria-invalid'); } });
    var phoneAttrs = { id: phoneId, class: 'tg-input', type: 'tel', maxlength: '32', placeholder: t('phone_ph'), 'aria-label': t('phoneAria'), autocomplete: 'tel', oninput: function () { shell.clear(); phone.removeAttribute('aria-invalid'); } };
    if (phoneRequired) phoneAttrs.required = true;
    var phone = el('input', phoneAttrs);
    var phoneLabelChildren = phoneRequired ? [t('phone')] : [t('phone') + ' ', el('span', { class: 'tg-opt', text: t('optional') })];
    shell.fieldNode.appendChild(el('div', { class: 'tg-row' }, [
      el('div', {}, [el('label', { class: 'tg-label', for: emailId, text: t('emailAddress') }), email]),
      el('div', {}, [el('label', { class: 'tg-label', for: phoneId }, phoneLabelChildren), phone])
    ]));
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'contact',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.email = email.value.trim(); fields.phone = phone.value.trim(); },
      validate: function () {
        if (fieldSpec.required === false) return null;
        var e = email.value.trim();
        if (!e) return t('email_required');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return t('email_invalid');
        if (phoneRequired && !phone.value.trim()) return t('phone_required');
        return null;
      },
      showError: function (msg) {
        shell.show(msg);
        // Point the invalid marker at the field actually at fault: phone only
        // when the email is present and the phone is the empty required one.
        if (phoneRequired && email.value.trim() && !phone.value.trim()) { phone.setAttribute('aria-invalid', 'true'); }
        else { email.setAttribute('aria-invalid', 'true'); }
      },
      clearError: function () { shell.clear(); email.removeAttribute('aria-invalid'); phone.removeAttribute('aria-invalid'); },
      focus: function () { (phoneRequired && email.value.trim() && !phone.value.trim() ? phone : email).focus(); }
    };
  }

  // Collapse the list of free-text notes fields into the single `notes` value
  // the server stores. renderNotes pushes each non-empty field as { label, value }
  // onto fieldValues.__notes__; here we merge that list: one field → its value
  // verbatim (unchanged from the single-notes era); two or three → each labelled
  // so the agent can tell them apart in the inbox and emails. Mutates in place.
  function mergeNotesFields(fieldValues) {
    if (!fieldValues || !fieldValues.__notes__) return;
    var arr = fieldValues.__notes__;
    delete fieldValues.__notes__;
    if (arr.length === 1) {
      fieldValues.notes = arr[0].value;
    } else if (arr.length > 1) {
      fieldValues.notes = arr.map(function (n) {
        var label = String(n.label || 'Notes').replace(/\s*:\s*$/, '');
        return label + ':\n' + n.value;
      }).join('\n\n');
    }
  }

  function renderNotes(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, fieldSpec.label || t('label_notes'), [' ', el('span', { class: 'tg-opt', text: t('optional') })]);
    // Per-field DOM id so a form can carry more than one notes field without
    // duplicate ids (the id falls back to 'notes' for the default field).
    var textareaId = 'tg-' + instance + '-' + (fieldSpec.id || 'notes');
    var textarea = el('textarea', { id: textareaId, class: 'tg-textarea', 'aria-label': t('notesAria'), placeholder: (fieldSpec.options && fieldSpec.options.placeholder) || fieldSpec.placeholder || t('notes_ph'), maxlength: '2000' });
    var labelEl = shell.fieldNode.querySelector('.tg-label');
    if (labelEl) labelEl.setAttribute('for', textareaId);
    shell.fieldNode.appendChild(textarea);
    shell.fieldNode.appendChild(shell.errorNode);
    return {
      type: 'notes',
      node: shell.fieldNode,
      // Collect into a list rather than writing `notes` directly, so several
      // notes fields don't overwrite each other. The submit flow merges the
      // list into the single `notes` value (see _collectFields below).
      writeTo: function (fields) {
        var v = textarea.value.trim();
        if (!v) return;
        if (!fields.__notes__) fields.__notes__ = [];
        fields.__notes__.push({ label: fieldSpec.label || t('label_notes'), value: v });
      },
      validate: function () { return null; },
      showError: function (msg) { shell.show(msg); },
      clearError: function () { shell.clear(); },
      focus: function () { textarea.focus(); }
    };
  }

  function renderConsent(instance, fieldSpec, t) {
    t = t || makeT(null);
    var shell = createFieldShell(instance, null);
    var contactInput = el('input', { type: 'checkbox', 'aria-label': t('consent_agreeAria'), onchange: function () { shell.clear(); contactInput.removeAttribute('aria-invalid'); } });
    var marketingInput = el('input', { type: 'checkbox', 'aria-label': t('consent_marketingAria') });
    shell.fieldNode.appendChild(el('label', { class: 'tg-check' }, [
      contactInput,
      el('span', { class: 'tg-check-text' }, [
        el('strong', { text: fieldSpec.contactLabel || t('consent_contactLabel') }),
        fieldSpec.contactSub || t('consent_contactSub')
      ])
    ]));
    shell.fieldNode.appendChild(el('div', { style: { height: '8px' } }));
    shell.fieldNode.appendChild(el('label', { class: 'tg-check' }, [
      marketingInput,
      el('span', { class: 'tg-check-text' }, [
        fieldSpec.marketingLabel || t('consent_marketingLabel')
      ])
    ]));
    shell.fieldNode.appendChild(shell.errorNode);
    contactInput.setAttribute('aria-describedby', shell.errorId);
    return {
      type: 'consent',
      node: shell.fieldNode,
      writeTo: function (fields) { fields.contact_consent = !!contactInput.checked; fields.marketing_consent = !!marketingInput.checked; },
      validate: function () {
        if (fieldSpec.required === false) return null;
        return contactInput.checked ? null : t('consent_required');
      },
      showError: function (msg) { shell.show(msg); contactInput.setAttribute('aria-invalid', 'true'); },
      clearError: function () { shell.clear(); contactInput.removeAttribute('aria-invalid'); },
      focus: function () { contactInput.focus(); }
    };
  }

  // Dispatch table — maps field.type string to renderer function
  var RENDERERS = {
    destination: renderDestination,
    airport:     renderAirport,
    daterange:   renderDateRange,
    duration:    renderDuration,
    travellers:  renderTravellers,
    budget:      renderBudget,
    stars:       renderStars,
    board:       renderBoard,
    interests:   renderInterests,
    name:        renderName,
    contact:     renderContact,
    notes:       renderNotes,
    consent:     renderConsent
  };

  // ============================================================================
  //  TGEnquiryWidget class — the suite-convention programmatic interface
  // ============================================================================

  function TGEnquiryWidget(container, config) {
    if (!container) {
      console.error('[TGEnquiryWidget] No container element provided');
      return;
    }
    this.instance = ++INSTANCE_COUNTER;
    this.container = container;
    this.config = this._normalise(config || {});
    this.t = makeT(this.config.branding);   // resolve viewer language + UI strings
    this._applyI18n();                       // overlay author content for that language
    this.shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
    this._render();
  }

  // Overlay the author's translated copy for the resolved viewer language onto
  // the normalised config, in place. Modelled on the offer/FAQ content overlay:
  // only the author's DISPLAY copy is swapped (header title/subtitle, submit
  // label, thank-you message, and each field's label, placeholder, help text and
  // option labels). The submitted field names and option values, the routing and
  // the {firstName}-style tokens inside translated strings are never touched, so
  // the form posts exactly the same payload in every language. Missing strings
  // fall back to the English source, so a partial translation never blanks a
  // field. No-op for English viewers or when the form carries no translations.
  TGEnquiryWidget.prototype._applyI18n = function () {
    var lang = this.t && this.t.lang;
    if (!lang || lang === 'en') return;
    var i18n = this.config && this.config.i18n;
    if (!i18n || typeof i18n !== 'object') return;
    var tr = i18n[lang];
    if (!tr || typeof tr !== 'object') return;

    var c = this.config;
    var pick = function (over, base) { return (typeof over === 'string' && over.trim()) ? over : base; };

    // Header.
    if (tr.header && typeof tr.header === 'object') {
      c.header = c.header || {};
      c.header.title = pick(tr.header.title, c.header.title);
      c.header.subtitle = pick(tr.header.subtitle, c.header.subtitle);
    }
    // Submit label + thank-you message.
    c.submitText = pick(tr.submitButtonText, c.submitText);
    if (c.thankYou && typeof c.thankYou === 'object') {
      c.thankYou.message = pick(tr.thankYouMessage, c.thankYou.message);
    }

    // Per-field label / placeholder / help, and per-option label. Matched by the
    // field's stable `id` and the option's stable `value` — the keys the editor
    // stores translations under and the submission keys off, so they never change.
    var trFields = (tr.fields && typeof tr.fields === 'object' && !Array.isArray(tr.fields)) ? tr.fields : null;
    if (trFields && Array.isArray(c.fields)) {
      c.fields.forEach(function (f) {
        if (!f || !f.id) return;
        var tf = trFields[f.id];
        if (!tf || typeof tf !== 'object') return;
        if (tf.label) f.label = pick(tf.label, f.label);
        if (tf.placeholder) f.placeholder = pick(tf.placeholder, f.placeholder);
        if (tf.help) f.help = pick(tf.help, f.help);
        var trOpts = (tf.options && typeof tf.options === 'object' && !Array.isArray(tf.options)) ? tf.options : null;
        if (trOpts && Array.isArray(f.options)) {
          f.options.forEach(function (opt) {
            if (!opt || opt.value == null) return;
            opt.label = pick(trOpts[opt.value], opt.label);
          });
        }
      });
    }
  };

  // Convert the API response / editor config shape into a normalised form
  // the renderers can consume. Tolerates missing or partial input.
  TGEnquiryWidget.prototype._normalise = function (config) {
    var normalised = {
      formId:     config.formId || '',
      widgetId:   config.widgetId || '',
      name:       config.name || 'Enquiry form',
      // Author-overridable. Defaults left empty here and localised at the use
      // site (header title/subtitle, submit label, thank-you message) so the
      // viewer's language is used when the author has not set their own copy.
      header:     config.header || { title: '', subtitle: '' },
      submitText: config.submitText || '',
      thankYou:   config.thankYou || { mode: 'inline', message: '' },
      branding:   config.branding || { buttonColour: '#1B2B5B', accentColour: '#00B4D8', theme: 'light' },
      security:   config.security || { honeypot: true, turnstile: false },
      // Multi-step layout. Values: 'single-page' (default) | 'multi-step'.
      // When 'multi-step', fields are grouped by their `step` property and
      // rendered one step at a time with Back/Next navigation.
      layoutMode: (config.layoutMode === 'multi-step') ? 'multi-step' : 'single-page',
      // Steps array — [{ id: 1, label: 'Your trip' }, ...]. If absent,
      // normaliseSteps() below will synthesise one from the field list.
      steps:      Array.isArray(config.steps) ? config.steps : null,
      // Layer-2 content translations. Per-language overlays of the author copy,
      // keyed by 2-letter language code, applied by _applyI18n() once the viewer
      // language is resolved. English is the source; submitted field names and
      // option values are never touched.
      i18n:       (config.i18n && typeof config.i18n === 'object' && !Array.isArray(config.i18n)) ? config.i18n : {},
    };
    // fieldsJSON might arrive as a JSON string or a plain array
    var fields = config.fieldsJSON;
    if (typeof fields === 'string') {
      try { fields = JSON.parse(fields); }
      catch (e) { console.warn('[TGEnquiryWidget] fieldsJSON parse failed, falling back to defaults'); fields = null; }
    }
    if (!Array.isArray(fields) || fields.length === 0) fields = defaultFieldSet();
    // Ensure every field has an integer `step` property. Legacy forms (pre
    // multi-step) won't have it — default to step 1 so they render in a
    // single step and behave identically to single-page mode.
    fields.forEach(function (f) {
      var s = parseInt(f.step, 10);
      f.step = (Number.isFinite(s) && s >= 1) ? s : 1;
    });
    normalised.fields = fields;
    normalised.steps = normaliseSteps(normalised.steps, fields);
    return normalised;
  };

  // Derive the final steps array from config + fields. If the config has an
  // explicit steps array, use it (filtered to only include steps that actually
  // have fields). Otherwise synthesise one step per unique step-ID found in
  // the fields. Always returns at least one step.
  function normaliseSteps(configSteps, fields) {
    // Collect the set of step IDs actually used by visible fields
    var used = {};
    fields.forEach(function (f) {
      if (f.visible === false) return;
      used[f.step || 1] = true;
    });
    var usedIds = Object.keys(used).map(function (k) { return parseInt(k, 10); });
    usedIds.sort(function (a, b) { return a - b; });
    if (usedIds.length === 0) usedIds = [1]; // no visible fields yet

    if (Array.isArray(configSteps) && configSteps.length > 0) {
      // Filter provided steps to only those whose ID is actually used by a
      // visible field. Preserve labels. Fall through to synthesis if nothing
      // survives filtering (e.g. stale config).
      var filtered = configSteps
        .filter(function (s) { return s && typeof s === 'object' && usedIds.indexOf(s.id) !== -1; })
        .map(function (s) {
          // Preserve the author's label; leave a generic step label null so it
          // is localised at the render site (see _render progress indicator).
          return { id: s.id, label: s.label || null };
        });
      if (filtered.length > 0) return filtered;
    }

    // Synthesise: one entry per used ID. Label left null so it is localised
    // at render time rather than baked in as English here.
    return usedIds.map(function (id) {
      return { id: id, label: null };
    });
  }

  // Clear shadow DOM and rebuild from config. Used by update() + initial render.
  TGEnquiryWidget.prototype._render = function () {
    var shadow = this.shadow;
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);

    if (!this.t) this.t = makeT(this.config.branding);
    var t = this.t;
    var config = this.config;
    var instance = this.instance;
    var fields = [];
    var self = this;

    // Inject styles
    shadow.appendChild(el('style', { text: buildStyles(config.branding) }));

    // Build card
    var card = el('div', { class: 'tg-card' });
    var heroChildren = [];
    if (config.branding && config.branding.logoUrl) {
      var logoImg = el('img', {
        class: 'tg-hero-logo',
        src: config.branding.logoUrl,
        alt: '',
        loading: 'lazy'
      });
      // Hide the logo if it fails to load so a broken or hotlink-blocked URL
      // never shows the browser's broken-image glyph above the form. CSP-safe:
      // attached here, not via inline onerror.
      logoImg.addEventListener('error', function () { logoImg.style.display = 'none'; }, { once: true });
      heroChildren.push(logoImg);
    }
    heroChildren.push(el('h2', { text: config.header.title || t('headerTitle') }));
    heroChildren.push(el('p', { text: config.header.subtitle || t('headerSubtitle') }));
    card.appendChild(el('div', { class: 'tg-hero' }, heroChildren));

    // ── Multi-step vs single-page branching ─────────────────────────────
    // Single-page: all fields in one section, one submit button, same as
    //              widget has always done.
    // Multi-step:  fields grouped by step.id, one section visible at a time
    //              with a progress indicator at top and Back/Next buttons.
    //
    // Both paths share the same: honeypot, summary error banner, Turnstile,
    // post-submit handler. The difference is purely about what the user sees
    // at any given moment.
    var isMultiStep = (config.layoutMode === 'multi-step') && config.steps && config.steps.length > 1;

    // Instantiate all field renderers up-front regardless of mode. The multi-
    // step path still needs every field instance so _handleSubmit can gather
    // values from all steps on final submit.
    var fieldNodesByStep = {}; // step id → [DOM nodes]
    config.fields.forEach(function (fieldSpec) {
      if (fieldSpec.visible === false) return;
      var renderer = RENDERERS[fieldSpec.type];
      if (!renderer) {
        console.warn('[TGEnquiryWidget] Unknown field type:', fieldSpec.type);
        return;
      }
      var inst = renderer(instance, fieldSpec, t);
      inst.__step = fieldSpec.step || 1; // stash for validation scoping
      fields.push(inst);
      var stepId = fieldSpec.step || 1;
      if (!fieldNodesByStep[stepId]) fieldNodesByStep[stepId] = [];
      fieldNodesByStep[stepId].push(inst.node);
    });

    // Progress indicator (multi-step only). Rendered BEFORE the first section
    // so it sits visually between the hero and the form fields.
    var progressEl = null;
    if (isMultiStep) {
      progressEl = el('div', { class: 'tg-progress', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(config.steps.length), 'aria-valuenow': '1' });
      config.steps.forEach(function (step, idx) {
        var item = el('div', { class: 'tg-progress-step', 'data-step-idx': String(idx) }, [
          el('span', { class: 'tg-progress-num', text: String(idx + 1) }),
          el('span', { class: 'tg-progress-label', text: step.label || t('stepN', { n: idx + 1 }) })
        ]);
        progressEl.appendChild(item);
      });
      card.appendChild(progressEl);
    }

    // Build the sections. In single-page mode there's one section containing
    // every field. In multi-step mode there's one section per step, and we
    // toggle visibility as the user navigates.
    var sectionsByStep = {};
    if (isMultiStep) {
      config.steps.forEach(function (step) {
        var section = el('div', { class: 'tg-section tg-step-section', 'data-step-id': String(step.id) });
        var nodes = fieldNodesByStep[step.id] || [];
        if (nodes.length === 0) {
          // Edge case: step exists in config but no fields are on it. Show a
          // tiny placeholder so the step isn't jarringly empty — shouldn't
          // normally happen because normaliseSteps filters these out.
          section.appendChild(el('div', {
            style: { padding: '24px 0', color: '#94A3B8', fontSize: '13px', textAlign: 'center' },
            text: t('noFieldsStep')
          }));
        } else {
          nodes.forEach(function (n) { section.appendChild(n); });
        }
        sectionsByStep[step.id] = section;
        card.appendChild(section);
      });
    } else {
      // Single-page — one section, all fields in original order.
      var section = el('div', { class: 'tg-section' });
      fields.forEach(function (inst) { section.appendChild(inst.node); });
      card.appendChild(section);
    }

    // Honeypot — always present, visually hidden. Lives outside of step
    // sections so it's part of every submit regardless of which step is active.
    var honeypot = el('input', {
      class: 'tg-honeypot', type: 'text', name: 'tg_hp_check',
      tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true'
    });
    card.appendChild(honeypot);

    // Summary error banner (multiple errors). Shared across steps — resets
    // each time we show a new step.
    var summaryError = el('div', { class: 'tg-summary-error', role: 'alert', 'aria-live': 'assertive' }, [
      svg(ICONS.alert, { size: 16 }),
      el('span', { class: 'tg-summary-error-text' })
    ]);
    card.appendChild(summaryError);

    // Turnstile container — rendered only if security.turnstile === true.
    // In multi-step mode it ONLY appears on the final step: Turnstile tokens
    // expire after ~5 minutes, and showing the challenge on step 1 of a
    // lengthy form would often result in expired tokens by submit time. The
    // container is always in the DOM; we hide it until the final step.
    var turnstileContainer = null;
    var turnstileToken = null;
    var turnstileFrame = null;
    if (config.security && config.security.turnstile) {
      if (config.security.turnstileSiteKey) {
        turnstileContainer = el('div', { class: 'tg-turnstile' });
        if (isMultiStep) {
          // Hide initially; shown when user navigates to final step
          turnstileContainer.style.display = 'none';
        }
        card.appendChild(turnstileContainer);
      } else {
        // Turnstile is enabled on the form but the sitekey didn't arrive —
        // most likely TURNSTILE_SITE_KEY isn't set in the server environment.
        // Fail safe for the visitor: render no challenge rather than an
        // unsolvable one that would strand them at submit. Bot protection is
        // still enforced server-side at /api/enquiry/submit, and the missing
        // sitekey is logged so the site owner gets a signal.
        console.error('[TGEnquiryWidget] security.turnstile is true but turnstileSiteKey is missing — skipping client challenge, relying on server-side verification');
      }
    }

    // ── Navigation row ──────────────────────────────────────────────────
    // Single-page: one submit button (existing behaviour).
    // Multi-step:  Back | Next on intermediate steps, Back | Submit on final.
    var submitText = config.submitText || t('submitText');
    var submitBtn = el('button', { class: 'tg-submit', type: 'button' }, [
      el('span', { text: submitText }),
      svg(ICONS.arrow, { size: 16 })
    ]);
    var backBtn = null;
    var nextBtn = null;
    if (isMultiStep) {
      backBtn = el('button', { class: 'tg-nav-back', type: 'button' }, [
        svg(ICONS.arrowLeft || ICONS.arrow, { size: 16 }),
        el('span', { text: t('back') })
      ]);
      nextBtn = el('button', { class: 'tg-nav-next', type: 'button' }, [
        el('span', { text: t('continue') }),
        svg(ICONS.arrow, { size: 16 })
      ]);
    }

    var navChildren;
    if (isMultiStep) {
      navChildren = [
        el('div', { class: 'tg-trust' }, [
          el('span', {}, [svg(ICONS.check, { size: 12 }), t('secure')]),
          el('span', {}, [svg(ICONS.check, { size: 12 }), t('gdpr')]),
          el('span', {}, [svg(ICONS.clock, { size: 12 }), t('reply24hr')])
        ]),
        el('div', { class: 'tg-nav-buttons' }, [backBtn, nextBtn, submitBtn])
      ];
    } else {
      navChildren = [
        el('div', { class: 'tg-trust' }, [
          el('span', {}, [svg(ICONS.check, { size: 12 }), t('secure')]),
          el('span', {}, [svg(ICONS.check, { size: 12 }), t('gdpr')]),
          el('span', {}, [svg(ICONS.clock, { size: 12 }), t('reply24hr')])
        ]),
        submitBtn
      ];
    }
    card.appendChild(el('div', { class: 'tg-footer' }, navChildren));

    shadow.appendChild(card);

    // ── Submit wiring ────────────────────────────────────────────────────
    // Submit button is wired identically in both modes — it always submits
    // everything. In multi-step it's only visible on the final step, which
    // is enforced by the nav state machine below.
    submitBtn.addEventListener('click', function () {
      self._handleSubmit(fields, honeypot, summaryError, submitBtn, function () { return turnstileToken; });
    });

    // Stash refs for submit handler + external callers
    this._fields = fields;
    this._submitBtn = submitBtn;
    this._summaryError = summaryError;
    this._honeypot = honeypot;
    this._turnstileToken = function () { return turnstileToken; };

    // Destroy any previous Turnstile frame before creating a new one (update()
    // path re-renders the whole widget, so we need to clean up listeners).
    if (this._turnstileFrame) {
      try { this._turnstileFrame.destroy(); } catch (e) { /* ignore */ }
      this._turnstileFrame = null;
    }

    // Mount the Turnstile iframe. The iframe runs /turnstile-frame.html on
    // our domain, solves the challenge, and postMessages the token back. The
    // container is only present when a sitekey arrived (see above), so the
    // missing-sitekey case never renders a challenge — it falls through to
    // server-side verification instead of stranding the visitor.
    if (turnstileContainer) {
      turnstileFrame = createTurnstileFrame(
        config.security.turnstileSiteKey,
        config.branding.theme,
        function (newToken) { turnstileToken = newToken; },
        t
      );
      turnstileContainer.appendChild(turnstileFrame.iframe);
      this._turnstileFrame = turnstileFrame;
    }

    // ── Multi-step navigation state machine ──────────────────────────────
    // Tracks the currently-visible step and handles Back/Next + validation
    // boundaries. Set up LAST because it references DOM elements created
    // above (progressEl, sectionsByStep, backBtn, nextBtn, submitBtn,
    // turnstileContainer).
    if (isMultiStep) {
      this._stepState = this._buildStepNav({
        steps:              config.steps,
        sectionsByStep:     sectionsByStep,
        progressEl:         progressEl,
        backBtn:            backBtn,
        nextBtn:            nextBtn,
        submitBtn:          submitBtn,
        turnstileContainer: turnstileContainer,
        summaryError:       summaryError,
        fields:             fields,
      });
      // Show step 1 initially — no scroll (mount / editor-preview re-render).
      this._stepState.goToStep(0, true);
    }
  };

  // Build the multi-step navigation state machine. Returns a controller with
  // goToStep(idx), next(), back() methods. Kept as a separate method so
  // _render stays readable and the state machine logic is inspectable.
  TGEnquiryWidget.prototype._buildStepNav = function (ctx) {
    var self = this;
    var t = this.t;
    var currentIdx = 0;
    var totalSteps = ctx.steps.length;

    // Clear summary error — called when arriving at a new step so users
    // don't see errors from a previous step they've moved past.
    function clearSummaryError() {
      ctx.summaryError.classList.remove('is-shown');
      var t = ctx.summaryError.querySelector('.tg-summary-error-text');
      if (t) t.textContent = '';
    }

    // Validate only the fields belonging to a given step. Returns true if all
    // required fields in that step have valid values. Uses each field's own
    // validate() method — same as _handleSubmit but scoped to one step.
    function validateStep(stepIdx) {
      var stepId = ctx.steps[stepIdx].id;
      var firstInvalid = null;
      var errorCount = 0;
      ctx.fields.forEach(function (f) {
        if (f.__step !== stepId) return;
        if (!f.validate) return;
        // validate() returns an error message string (or null) — NOT an object.
        // The old `result.error` check was always undefined, so every step
        // validated as passing and required fields never blocked Next, letting
        // the visitor reach submit with invalid fields hidden on earlier steps.
        var result = f.validate();
        if (result) {
          errorCount++;
          if (f.showError) f.showError(result);
          if (!firstInvalid) firstInvalid = f;
        } else if (f.clearError) {
          f.clearError();
        }
      });
      if (errorCount > 0) {
        var text = errorCount === 1
          ? t('fixOneField')
          : t('fixNFields', { count: errorCount });
        ctx.summaryError.classList.add('is-shown');
        var span = ctx.summaryError.querySelector('.tg-summary-error-text');
        if (span) span.textContent = text;
        if (firstInvalid && firstInvalid.node && firstInvalid.node.scrollIntoView) {
          try { firstInvalid.node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ }
        }
        return false;
      }
      clearSummaryError();
      return true;
    }

    // Transition to a given step index. Does NOT validate — callers that
    // need validation (next button, submit) check first.
    function goToStep(idx, skipScroll) {
      if (idx < 0 || idx >= totalSteps) return;
      currentIdx = idx;

      // Toggle section visibility
      ctx.steps.forEach(function (step) {
        var section = ctx.sectionsByStep[step.id];
        if (!section) return;
        section.style.display = (step.id === ctx.steps[idx].id) ? '' : 'none';
      });

      // Update progress indicator
      if (ctx.progressEl) {
        ctx.progressEl.setAttribute('aria-valuenow', String(idx + 1));
        var children = ctx.progressEl.children;
        for (var i = 0; i < children.length; i++) {
          children[i].classList.remove('is-current', 'is-complete');
          if (i < idx) children[i].classList.add('is-complete');
          else if (i === idx) children[i].classList.add('is-current');
        }
      }

      // Nav button visibility + labels
      var isFirst = idx === 0;
      var isLast  = idx === totalSteps - 1;
      if (ctx.backBtn) ctx.backBtn.style.visibility = isFirst ? 'hidden' : '';
      if (ctx.nextBtn) ctx.nextBtn.style.display    = isLast ? 'none' : '';
      if (ctx.submitBtn) ctx.submitBtn.style.display = isLast ? '' : 'none';

      // Turnstile only on final step (tokens expire ~5 min)
      if (ctx.turnstileContainer) {
        ctx.turnstileContainer.style.display = isLast ? '' : 'none';
      }

      // Clear any step-validation error from the previous step
      clearSummaryError();

      // Scroll to top of card on a real step change (otherwise users can land
      // mid-form after a long previous step). NOT on the initial mount or a
      // passive editor-preview re-render — scrolling then yanks the visitor's
      // page down to the widget on load, and jumps the editor on every keystroke
      // (23 Jul 2026, same family as the Enquiry Pro focus fix).
      if (!skipScroll) {
        try {
          self.shadow.host.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* ignore */ }
      }
    }

    // Wire nav buttons
    if (ctx.nextBtn) {
      ctx.nextBtn.addEventListener('click', function () {
        if (validateStep(currentIdx)) goToStep(currentIdx + 1);
      });
    }
    if (ctx.backBtn) {
      ctx.backBtn.addEventListener('click', function () {
        goToStep(currentIdx - 1);
      });
    }

    return {
      goToStep: goToStep,
      next: function () { if (validateStep(currentIdx)) goToStep(currentIdx + 1); },
      back: function () { goToStep(currentIdx - 1); },
      getCurrentIdx: function () { return currentIdx; },
      getTotalSteps: function () { return totalSteps; },
    };
  };

  TGEnquiryWidget.prototype._handleSubmit = function (fields, honeypot, summaryError, submitBtn, getToken) {
    var self = this;
    var t = this.t;
    var config = this.config;

    // Validate every field
    var failedFields = [];
    fields.forEach(function (f) {
      var err = f.validate();
      if (err) { f.showError(err); failedFields.push(f); }
      else f.clearError();
    });

    if (failedFields.length > 0) {
      if (failedFields.length === 1) {
        summaryError.classList.remove('is-shown');
      } else {
        summaryError.classList.add('is-shown');
        summaryError.querySelector('.tg-summary-error-text').textContent = t('checkNFields', { count: failedFields.length });
      }
      setTimeout(function () {
        if (failedFields[0].focus) failedFields[0].focus();
        var rect = failedFields[0].node.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          failedFields[0].node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
      return;
    }

    summaryError.classList.remove('is-shown');

    // Only block on a missing token when the challenge was actually rendered
    // (a sitekey is present). If Turnstile is enabled but the sitekey never
    // arrived, no challenge was shown, so we fail safe and let the submit
    // proceed — server-side verification at /api/enquiry/submit is the real
    // gate. Blocking here would permanently strand the visitor.
    var turnstileToken = getToken();
    if (config.security && config.security.turnstile && config.security.turnstileSiteKey && !turnstileToken) {
      summaryError.classList.add('is-shown');
      summaryError.querySelector('.tg-summary-error-text').textContent = t('securityIncomplete');
      return;
    }

    // Preview mode — if the widget is running inside the editor (no formId),
    // don't actually submit. Just flash a success state so the agent knows
    // validation passed. A LIVE embed (isLiveEmbed) never takes this path even
    // if its formId is blank, so a misconfigured widget errors visibly on the
    // real submit instead of flashing fake success and dropping the lead.
    if (!config.isLiveEmbed && (!config.formId || config.formId === 'preview')) {
      submitBtn.disabled = true;
      var origHtml = submitBtn.innerHTML;
      submitBtn.innerHTML = '';
      submitBtn.appendChild(svg(ICONS.check, { size: 16 }));
      submitBtn.appendChild(document.createTextNode(t('looksGood')));
      setTimeout(function () {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origHtml;
      }, 1500);
      return;
    }

    var fieldValues = {};
    fields.forEach(function (f) { f.writeTo(fieldValues); });

    mergeNotesFields(fieldValues);

    var firstNameForTy = fieldValues.first_name || '';

    var payload = {
      // widgetId is the server's preferred lookup key (unique per form).
      // formId stays for back-compat while cached configs roll over.
      widgetId: config.widgetId || undefined,
      formId: config.formId,
      visitorId: getVisitorId(),
      sourceUrl: window.location.href,
      locale: (navigator.language || 'en-GB').slice(0, 16),
      honeypot: honeypot.value,
      turnstileToken: turnstileToken,
      submittedAt: new Date().toISOString(),
      fields: fieldValues
    };

    submitBtn.disabled = true;
    submitBtn.innerHTML = '';
    submitBtn.appendChild(svg(ICONS.spinner, { size: 16, class: 'tg-spin' }));
    submitBtn.appendChild(document.createTextNode(' ' + t('sending')));

    // One silent retry on a retryable 503: the server answers that ONLY when
    // nothing was committed — a form lookup that failed before any write, or a
    // master write that timed out and was VERIFIED not to have landed — so
    // re-sending can never duplicate a submission. The button stays in its
    // "Sending" state through the retry; the visitor only ever sees an error if
    // that fails too.
    var attemptSend = function (attemptNo) {
      fetch(API_BASE + '/api/enquiry/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
      }).then(function (result) {
        if (result.ok && result.body.ok) {
          self._renderThankYou(result.body, firstNameForTy);
          return;
        }
        if (attemptNo === 1 && result.status === 503 && result.body && result.body.retryable) {
          setTimeout(function () { attemptSend(2); }, 2000);
          return;
        }
        self._showSubmitError(submitBtn, summaryError, result.body);
        // Server-side validation carries a {fields:{path:message}} map — walk
        // it back to the exact renderers so the visitor sees WHICH answer to
        // fix, not just "One or more fields are invalid."
        if (result.status === 400 && result.body && result.body.fields) {
          try { self._showServerFieldErrors(fields, result.body.fields, summaryError); } catch (e) {}
        }
        try { console.warn('[TGEnquiryWidget] submit failed for', config.widgetId || config.formId, 'HTTP', result.status, '-', result.body && (result.body.error || result.body.message)); } catch (e) {}
        // Alert on any submit failure from a real embed except rate limiting:
        // 5xx is an outage, 404 is a broken embed, and a 400 here means the
        // widget produced a payload its own server rejects — every one of
        // those is OURS to hear about, not the visitor's to report.
        if (config.isLiveEmbed && result.status >= 400 && result.status !== 429) {
          report('submit failed', 'HTTP ' + result.status + ' ' + ((result.body && result.body.error) || '') + ' ' + Object.keys((result.body && result.body.fields) || {}).slice(0, 5).join(','), config.widgetId);
        }
      }).catch(function () {
        self._showSubmitError(submitBtn, summaryError, { message: t('genericError') });
        if (config.isLiveEmbed) report('submit network failure', 'fetch rejected or non-JSON response', config.widgetId);
      });
    };
    attemptSend(1);
  };

  TGEnquiryWidget.prototype._showSubmitError = function (submitBtn, summaryError, body) {
    var t = this.t;
    submitBtn.disabled = false;
    submitBtn.innerHTML = '';
    submitBtn.appendChild(el('span', { text: this.config.submitText || t('submitText') }));
    submitBtn.appendChild(svg(ICONS.arrow, { size: 16 }));
    summaryError.classList.add('is-shown');
    summaryError.querySelector('.tg-summary-error-text').textContent = (body && (body.message || body.error)) || t('genericError');
    // Reset the Turnstile challenge so the user can generate a fresh token —
    // the one they just used was consumed by the failed submit attempt.
    if (this.config.security && this.config.security.turnstile && this._turnstileFrame) {
      try { this._turnstileFrame.reset(); } catch (e) { /* ignore */ }
    }
  };

  // Walk server-side validation paths ("fields.first_name") back to the
  // renderer whose writeTo produces that payload key, highlight each one, and
  // surface the actual messages in the summary banner. Fields on hidden steps
  // still get their inline error, so stepping back reveals it.
  TGEnquiryWidget.prototype._showServerFieldErrors = function (fields, errorMap, summaryError) {
    var keyToField = {};
    fields.forEach(function (f) {
      var probe = {};
      try { f.writeTo(probe); } catch (e) { return; }
      Object.keys(probe).forEach(function (k) { keyToField[k] = f; });
    });
    var firstHit = null;
    var messages = [];
    Object.keys(errorMap).forEach(function (path) {
      var msg = String(errorMap[path] || '').slice(0, 200);
      if (msg) messages.push(msg);
      var key = String(path).split('.')[1];
      var f = key && keyToField[key];
      if (!f || !f.showError) return;
      f.showError(msg || 'Please check this answer.');
      if (!firstHit) firstHit = f;
    });
    if (messages.length && summaryError) {
      var textNode = summaryError.querySelector('.tg-summary-error-text');
      if (textNode) textNode.textContent = messages.slice(0, 3).join(' ');
    }
    if (firstHit && firstHit.focus) { try { firstHit.focus(); } catch (e) {} }
  };

  TGEnquiryWidget.prototype._renderThankYou = function (response, firstName) {
    var t = this.t;
    var shadow = this.shadow;
    // 'redirect' mode: the author configured a conversion/tracking page. The
    // widget used to ignore it entirely. Navigate the top page there; the
    // inline card below still renders as a fallback for blocked navigation
    // (sandboxed iframes and similar).
    var ty = (response && response.thankYou) || this.config.thankYou || {};
    if (ty.mode === 'redirect' && typeof ty.redirectUrl === 'string' && /^https?:\/\//i.test(ty.redirectUrl)) {
      try { window.top.location.assign(ty.redirectUrl); }
      catch (e) { try { window.location.assign(ty.redirectUrl); } catch (e2) { /* keep inline card */ } }
    }
    // Preserve the style element so we don't lose theming
    var styleEl = shadow.querySelector('style');
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    if (styleEl) shadow.appendChild(styleEl);
    else shadow.appendChild(el('style', { text: buildStyles(this.config.branding) }));

    var message = (response.thankYou && response.thankYou.message) ||
                  (this.config.thankYou && this.config.thankYou.message) ||
                  t('thankYouMessage');
    // Interpolate {firstName}; when absent, also tidy a leading separator
    // (e.g. "Thanks {firstName} —" becomes "Thanks —" not "Thanks  —").
    if (firstName) {
      message = message.replace(/\{firstName\}/g, firstName);
    } else {
      message = message.replace(/[ ,]*\{firstName\}/g, '');
    }

    var card = el('div', { class: 'tg-card' }, [
      el('div', { class: 'tg-ty', role: 'status', 'aria-live': 'polite' }, [
        el('div', { class: 'tg-ty-hero', 'aria-hidden': 'true' }, [svg(ICONS.check, { size: 28, strokeWidth: 2.5 })]),
        el('h2', { text: message }),
        el('p', { text: t('thankYouBody') }),
        el('div', { class: 'tg-ty-ref', text: t('reference', { ref: response.reference || '—' }) })
      ])
    ]);
    shadow.appendChild(card);

    setTimeout(function () {
      var h2 = card.querySelector('h2');
      if (h2) { h2.setAttribute('tabindex', '-1'); h2.focus(); }
    }, 100);
  };

  // PUBLIC: update the widget with a new config. Used by the editor preview.
  TGEnquiryWidget.prototype.update = function (newConfig) {
    this.config = this._normalise(newConfig || {});
    this.t = makeT(this.config.branding);
    this._applyI18n();
    this._render();
  };

  // PUBLIC: destroy the widget (cleanup for editor unmount etc.)
  TGEnquiryWidget.prototype.destroy = function () {
    // Clean up the Turnstile message listener before tearing down the DOM
    if (this._turnstileFrame) {
      try { this._turnstileFrame.destroy(); } catch (e) { /* ignore */ }
      this._turnstileFrame = null;
    }
    if (this.shadow) {
      while (this.shadow.firstChild) this.shadow.removeChild(this.shadow.firstChild);
    }
    this._fields = null;
  };

  // Expose the class globally — same pattern as TGFaqWidget etc.
  window.TGEnquiryWidget = TGEnquiryWidget;
  window.__TG_ENQUIRY_VERSION__ = WIDGET_VERSION;

  // ============================================================================
  //  Auto-init for live embeds
  //  Finds all [data-tg-widget="enquiry"] elements, fetches their config by
  //  widgetId from the API, and mounts a widget instance.
  // ============================================================================

  // Calm, muted notice for an EXPECTED state (e.g. a Draft form not published
  // yet) — role="status", no alarm styling, and the caller fires no alert.
  function renderNotice(shadow, msg) {
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    shadow.appendChild(el('style', {
      text: '.tg-note{padding:40px 32px;text-align:center;font-family:-apple-system,sans-serif;color:#64748b;font-size:14px;line-height:1.5}'
    }));
    shadow.appendChild(el('div', { class: 'tg-note', role: 'status' }, [el('p', { text: msg })]));
  }

  function renderError(shadow, msg, t) {
    t = t || makeT(null);
    while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
    shadow.appendChild(el('style', {
      text: '.tg-oops{padding:48px 32px;text-align:center;font-family:-apple-system,sans-serif}.tg-oops h3{font-size:18px;margin:0 0 8px}.tg-oops p{color:#475569;font-size:14px}'
    }));
    shadow.appendChild(el('div', { class: 'tg-oops', role: 'alert' }, [
      el('h3', { text: t('formUnavailable') }),
      el('p', { text: msg })
    ]));
  }

  async function initContainer(container) {
    if (container.__tgMounted) return;
    container.__tgMounted = true;

    var t = makeT(null);
    var widgetId = container.getAttribute('data-tg-id');
    var inlineConfig = container.getAttribute('data-tg-config');

    // Inline config path (rare, mostly for testing/demo)
    if (inlineConfig) {
      try {
        var parsed = JSON.parse(inlineConfig);
        new TGEnquiryWidget(container, parsed);
        return;
      } catch (e) {
        console.error('[TGEnquiryWidget] Invalid data-tg-config JSON:', e);
      }
    }

    if (!widgetId) {
      console.error('[TGEnquiryWidget] Container missing data-tg-id');
      return;
    }

    // Attach shadow and show loading state while fetching
    var shadow = container.attachShadow ? container.attachShadow({ mode: 'open' }) : container;
    shadow.appendChild(el('style', {
      text: '.tg-loading{padding:48px;text-align:center;color:#94A3B8;font-family:-apple-system,sans-serif;font-size:14px}.tg-loading svg{animation:tg-spin 1s linear infinite;margin-bottom:8px}@keyframes tg-spin{to{transform:rotate(360deg)}}'
    }));
    var loading = el('div', { class: 'tg-loading', role: 'status', 'aria-live': 'polite' }, [
      svg(ICONS.spinner, { size: 24 }),
      el('div', { text: t('loadingForm') })
    ]);
    shadow.appendChild(loading);

    try {
      var configUrl = API_BASE + '/api/enquiry-form-config?id=' + encodeURIComponent(widgetId);
      // One silent retry on a network reject or a 429/5xx — the GET is
      // idempotent and transient blips otherwise cost the whole form. A
      // resolved 404 is a real answer and is never retried.
      var response;
      try {
        response = await fetch(configUrl, { credentials: 'omit' });
        if (response.status === 429 || response.status >= 500) throw new Error('HTTP ' + response.status);
      } catch (firstErr) {
        await new Promise(function (resolve) { setTimeout(resolve, 600); });
        response = await fetch(configUrl, { credentials: 'omit' });
      }
      var data = await response.json();

      // Clear loading — we're going to let the widget take over the shadow
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);

      if (!response.ok) {
        // A Draft form not published yet is an expected setup state, not a
        // failure — show a calm notice and fire NO alert (it was paging us every
        // time an agent previewed an unpublished embed). Genuine errors still
        // alert. (24 Jul 2026.)
        if (data && data.code === 'not_published') {
          renderNotice(shadow, (data && data.error) || 'This form is not published yet.');
          return;
        }
        renderError(shadow, (data && data.error) || t('unableToLoad'), t);
        try { console.warn('[TGEnquiryWidget] config load failed for', widgetId, 'HTTP', response.status, '-', data && data.error, '(' + configUrl + ')'); } catch (e) {}
        report('config load failed', 'HTTP ' + response.status + ' ' + ((data && data.error) || ''), widgetId);
        return;
      }

      // The widget constructor calls attachShadow again — undo our attempt
      // by rebuilding the container. For embedded containers, shadow is already
      // attached so we pass a fresh container won't work. Instead, build the
      // widget UI *into the existing shadow* by calling _render on a bare
      // TGEnquiryWidget that we construct by hand.
      var widget = Object.create(TGEnquiryWidget.prototype);
      widget.instance = ++INSTANCE_COUNTER;
      widget.container = container;
      widget.shadow = shadow;
      widget.config = widget._normalise(data);
      // Mark this as a real client embed (not the editor preview). A live embed
      // whose saved config is missing a formId must NOT flash fake success and
      // silently drop the lead — it should attempt the real submit and surface
      // any server error. The editor preview leaves this unset.
      widget.config.isLiveEmbed = true;
      // Overlay the author's translations for the viewer language — the same
      // step update() performs. Live embeds used to skip it, leaving every
      // translated form English-only on client sites.
      try { widget._applyI18n(); } catch (e) { /* never block render */ }
      widget._render();

      // Stash for potential programmatic access
      container.__tgWidget = widget;
      heartbeat(widgetId);
    } catch (err) {
      console.error('[TGEnquiryWidget] Failed to load config for', widgetId, ':', err);
      renderError(shadow, t('unableToReach'), t);
      // Attempt the beacon even though the network just failed — a CSP block
      // on the config fetch often still allows sendBeacon, and this is the
      // only trace the outage leaves. But NOT when the tab is hidden/unloading:
      // that fetch was almost certainly aborted by the visitor navigating away
      // (Safari reports it as "Load failed"), which is benign and paged us as a
      // false config failure. A CSP block still fires on a visible page.
      var hidden = false; try { hidden = (document.visibilityState === 'hidden'); } catch (e2) {}
      if (!hidden) report('config load threw', String((err && err.message) || err).slice(0, 200), widgetId);
    }
  }

  function autoInit() {
    var containers = document.querySelectorAll('[data-tg-widget="enquiry"]');
    for (var i = 0; i < containers.length; i++) initContainer(containers[i]);
  }

  // Site builders, tag managers and consent gates often inject the container
  // AFTER this script has run — a one-shot scan left a permanently blank
  // space with zero telemetry. Watch for late arrivals for a bounded window.
  function watchForLateContainers() {
    try {
      if (typeof MutationObserver !== 'function' || !document.body) return;
      var observer = new MutationObserver(function () {
        var containers = document.querySelectorAll('[data-tg-widget="enquiry"]');
        for (var i = 0; i < containers.length; i++) {
          if (!containers[i].__tgMounted) initContainer(containers[i]);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { observer.disconnect(); }, 30000);
    } catch (e) { /* never break the host page */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { autoInit(); watchForLateContainers(); });
  } else {
    autoInit();
    watchForLateContainers();
  }
})();
