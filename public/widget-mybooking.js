/**
 * Travelgenix My Booking Widget v1.7.0
 * Self-contained, embeddable widget for retrieving and displaying confirmed bookings
 * Zero dependencies — works on any website via a single script tag
 *
 * v1.10.0 changes:
 *   - Payment schedule now reconciles against the real outstanding balance
 *     (total − paidToDate). An instalment settled manually in Travelify (e.g.
 *     a phone payment) no longer shows as "Next" — Travelify leaves the
 *     depositOption.breakdown unchanged after payments, so the remaining
 *     schedule is computed as the tail of the plan summing to the
 *     outstanding. The Pay button amount follows the same reconciliation.
 *
 * v1.9.0 changes:
 *   - Amendment requests: customers can send the travel company a free-text
 *     change request (date change, name correction, room/seat preference).
 *     It does NOT change the booking — the widget says so clearly. Gated by
 *     the new "Online amendments" toggle (on by default). 1000-char cap,
 *     validated client + server. New endpoint: /api/amend-order.
 *
 * v1.8.0 changes:
 *   - Flight info now shows the flight date, flight number(s) and an
 *     overnight "+1" arrival marker; baggage reads from any segment.
 *   - Payment section shows the full instalment schedule (every payment
 *     and date), not just the next one, when a plan is set up.
 *   - Added a Print action alongside Preview / Email / Download.
 *
 * v1.10.2 changes:
 *   - The dedicated "Cancellation policy" toggle (display.showCancellation)
 *     now actually gates the informational policy blocks (the flight "Fare
 *     conditions" cancellation terms and the "Cancellation policy"
 *     accordion). Previously only showCancel gated them, so switching
 *     "Cancellation policy" off did nothing. Both blocks now hide when
 *     EITHER toggle is off; the cancel ACTION section stays gated by
 *     showCancel alone.
 *
 * v1.7.1 changes:
 *   - Cancellation info now follows the cancel toggle: when cancellation is
 *     off, cancellation terms are hidden everywhere (the flight "Fare
 *     conditions" block and the "Cancellation policy" accordion), not just
 *     the cancel action.
 *   - "Things to know" heading only renders when a child block has content
 *     (no more orphaned heading on flight-only bookings).
 *
 * v1.7.0 changes:
 *   - Pay balance now opens an editable, prefilled amount field: a customer
 *     can pay in full (one tap) or overtype a smaller part payment. The typed
 *     amount is validated client-side AND re-validated server-side against the
 *     real outstanding (never trusting the client).
 *
 * v1.6.1 changes:
 *   - Balance/next-due/Pay CTA now reconcile against payments taken
 *     (outstanding = total − paidToDate). The depositOption.breakdown is
 *     only a schedule and isn't cleared after payment, so a fully-paid
 *     order no longer shows a phantom balance or Pay button.
 *
 * v1.6.0 changes:
 *   - Pay balance: order-level balance/instalment payment. Reads paidToDate +
 *     depositOption from the order, shows "Pay balance · £X" CTAs (one in the
 *     Payment card, one above the cancellation section), POSTs /api/pay-balance
 *     and redirects to the Travelify basket. Server computes the amount.
 *   - Payment card now surfaces order-level "Paid so far", "Balance remaining"
 *     and "Next payment due" rows (previously these read empty hotel-deposit
 *     data, so nothing showed).
 *   - Multiple pay CTAs bound and error-scoped independently.
 *
 * v1.5.0 changes:
 *   - Per-product online cancellation (two-step policy → confirm) with optional
 *     confirmation email. Gated behind the showCancel / cancelEmail toggles.
 *
 * v1.4.1 changes (CRITICAL DATA-INTEGRITY FIX):
 *   - Removed all fabricated fallbacks on supplier (Travelify) data. Booking
 *     data is now a strict passthrough: if a field is missing, the UI hides
 *     that line rather than inventing a value. This was producing wrong
 *     information to customers (e.g. fabricated "TG" prefix on booking refs,
 *     fabricated room type "Deluxe" when Travelify returned roomType:
 *     "Unknown" — masking the real room name in units[].name).
 *   - Booking reference now falls back to the customer-typed orderRef (which
 *     by definition matched the booking) instead of 'TG' + internal order.id.
 *   - Room cell now reads units[].name (the actual supplier room name like
 *     "8 BED MIXED DORM (for 1 people)") and only uses roomType when it is a
 *     real value (not "Unknown").
 *   - Board basis (Travelify enum like "BedAndBreakfast") now mapped through
 *     a strict whitelist to readable labels ("Bed & breakfast"); unknown
 *     enums fall back to the raw string rather than a fabricated default.
 *   - Pay-at-location fees with no name/description are skipped entirely
 *     rather than labelled "Local fee".
 *   - PDF filename mirrors the on-screen ref resolution (no 'TG' prefix).
 *   - Countdown copy is now context-aware: "until you fly" only when the
 *     booking contains flights; "until you check in" for accommodation-only;
 *     "until you travel" for airport-extras-only. Three new optional config
 *     labels (countdownFly / countdownCheckIn / countdownTravel) plus the
 *     legacy `countdown` label remains an explicit override.
 *   - Luna context summary (getSafeContextSummary): new neutral field
 *     `daysUntilTripStart` so Luna doesn't write "you fly in N days" on a
 *     hotel-only booking; `daysUntilDeparture` kept as a back-compat alias.
 *     New `tripStartEvent` field tells Luna whether the first event is a
 *     flight, check-in or other. `boardBasis` now returns the readable label
 *     via fmtBoard() rather than the raw Travelify enum.
 *
 * v1.4.0 changes:
 *   - New public method getSafeContextSummary() returns a privacy-redacted
 *     trip summary (destination, dates, hotel name, airports, airline, party
 *     shape — no names, no prices, no refs, no emails, no special requests)
 *     suitable for passing to AI chat as conversational context. Returns
 *     null until state.stage === 'found'. Used by Luna chat so follow-up
 *     questions get answered without re-asking facts visible on screen.
 *
 * v1.3.1 changes:
 *   - Container-driven narrow layout: when the widget's container is < 440px wide
 *     (e.g. embedded in the Luna chat bubble), a `tgm-narrow` class is applied to
 *     the widget root and parallel CSS rules stack the previously side-by-side
 *     sections (action row, accommodation grid, payment + travellers, flight legs).
 *   - Existing viewport @media rules left untouched, so behaviour at standalone
 *     widget sizes is unchanged. ResizeObserver is feature-detected and falls
 *     back to a one-shot width check on browsers without it.
 *
 * v1.3.0 changes:
 *   - Email action: customer can email their booking pack from the page
 *   - Three-button action row (Preview / Email / Download) on desktop, stacked on mobile
 *   - Email composer modal: pre-filled to the customer's address, supports up to 3 cc,
 *     optional message, sends via /api/booking-email with PDF attached server-side
 *   - Customer's email is enforced as a recipient (anti-abuse — see endpoint docs)
 *   - Per-widget agency branding (FromName, LogoUrl, EmailFooter) drives email layout
 *
 * v1.2.0 changes:
 *   - Two-button PDF action: 'Preview' opens an inline viewer; 'Download' saves the file
 *   - Inline PDF viewer rendered in an iframe below the action row (~840px tall)
 *   - Single fetch shared between preview and download (blob cached on instance)
 *   - Preview button toggles the viewer open/closed
 *
 * v1.1.0 changes:
 *   - PDF download wired to /api/booking-pdf (Puppeteer-rendered A4 pack)
 *   - Email action hidden (Phase 2)
 *   - Lookup credentials cached on widget instance for PDF re-lookup
 *   - Spinner-on-button + toast notifications during PDF generation
 *
 * Usage:
 *   <div data-tg-widget="mybooking" data-tg-id="YOUR_WIDGET_ID"></div>
 *   <script src="https://tg-widgets.vercel.app/widget-mybooking.js"></script>
 */
(function () {
  'use strict';

  // Derive the API base from this script's own src. When the widget is
  // loaded directly on widgets.travelify.io a relative "/api/..." works
  // fine, but when embedded cross-origin (e.g. inside Luna chat on a
  // client website) the relative path resolves against the host page
  // and 403s. Computing the base from document.currentScript ensures
  // we always hit the origin the widget was actually served from.
  function deriveApiBase() {
    if (typeof window === 'undefined') return '';
    if (typeof window.__TG_WIDGET_API_BASE__ === 'string' && window.__TG_WIDGET_API_BASE__) {
      return window.__TG_WIDGET_API_BASE__.replace(/\/$/, '');
    }
    try {
      var s = document.currentScript;
      if (!s) {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
          if (scripts[i].src && scripts[i].src.indexOf('widget-mybooking') !== -1) {
            s = scripts[i];
            break;
          }
        }
      }
      if (s && s.src) {
        var u = new URL(s.src, window.location.href);
        return u.origin;
      }
    } catch (_) {}
    return '';
  }

  var API_BASE = deriveApiBase();

  const API_CONFIG = (typeof window !== 'undefined' && window.__TG_WIDGET_API__) || (API_BASE + '/api/widget-config');
  const API_RETRIEVE = (typeof window !== 'undefined' && window.__TG_RETRIEVE_API__) || (API_BASE + '/api/retrieve-order');
  const API_PDF = (typeof window !== 'undefined' && window.__TG_PDF_API__) || (API_BASE + '/api/booking-pdf');
  const API_EMAIL = (typeof window !== 'undefined' && window.__TG_EMAIL_API__) || (API_BASE + '/api/booking-email');
  const API_CANCEL = (typeof window !== 'undefined' && window.__TG_CANCEL_API__) || (API_BASE + '/api/cancel-product');
  const API_PAY = (typeof window !== 'undefined' && window.__TG_PAY_API__) || (API_BASE + '/api/pay-balance');
  const API_AMEND = (typeof window !== 'undefined' && window.__TG_AMEND_API__) || (API_BASE + '/api/amend-order');
  const AMEND_MAX = 1000; // matches the server cap in /api/amend-order
  const VERSION = '1.10.3';

  // ─── i18n ───────────────────────────────────────────────────
  // Fixed UI chrome only. Booking data, PII, prices, dates, the agency name and
  // ATOL/ABTA wording are never translated. English is the source + fallback.
  // Author overrides via c.labels still win — these are only the defaults.
  const MESSAGES = {
    en: {
      title: 'My Booking',
      subtitle: 'Welcome back. Enter your details to view everything about your upcoming trip.',
      subtitleShort: 'Look up your trip in seconds',
      eyebrow: 'Secure booking lookup',
      email: 'Email address',
      date: 'Departure date',
      ref: 'Booking reference',
      refShort: 'Reference',
      refPlaceholder: 'e.g. ABC12345',
      submit: 'Find my booking',
      submitShort: 'Find booking',
      trust: 'Your details are encrypted and never stored.',
      trustShort: 'Secure lookup',
      loadingTitle: 'Finding your booking',
      loadingSub: 'This usually takes a couple of seconds.',
      nfTitle: 'We couldn\'t find that booking',
      nfBody: 'Please double-check your email address, departure date and booking reference. If the details look right, get in touch and we\'ll help you straight away.',
      nfRetry: 'Try again',
      nfContact: 'Contact support',
      flights: 'Flights',
      fareConditions: 'Fare conditions',
      flightsLine: 'Flights',
      outbound: 'Outbound',
      return: 'Return',
      whatToExpect: 'What to expect',
      atAGlance: 'At a glance',
      openingTimes: 'Opening times',
      dressCode: 'Dress code',
      included: 'Included',
      drinks: 'Drinks',
      food: 'Food',
      flightAnnouncements: 'Flight announcements',
      features: 'Features',
      transfer: 'Transfer',
      transferInfo: 'Important information',
      transfersLine: 'Transfers',
      cancellation: 'Cancellation policy',
      carHire: 'Car hire',
      carHireLine: 'Car hire',
      carHireInfo: 'Important information',
      suppliedBy: 'Supplied by',
      pickup: 'Pickup',
      dropoff: 'Dropoff',
      payAtPickup: 'Also payable at pickup',
      payAtPickupNote: 'Paid directly to the rental desk on pickup. Not included in your booking cost above.',
      ticket: 'Ticket',
      ticketsLine: 'Tickets',
      ticketDetails: 'Details',
      highlights: 'Highlights',
      notIncluded: 'Not included',
      meetingPoint: 'Meeting point',
      languages: 'Languages',
      cancelledPill: 'Cancelled',
      cancelBtn: 'Cancel',
      cancelSecTitle: 'Need to cancel something?',
      cancelSecSub: 'You\'ll see the cancellation policy and any charges before anything is confirmed.',
      amendSecTitle: 'Need to change something?',
      amendSecSub: 'Tell us what you\'d like to change and we\'ll pass it to the team. Nothing on your booking changes until they confirm it.',
      amendOpen: 'Request a change',
      amendFieldLabel: 'What would you like to change?',
      amendPlaceholder: 'For example a date change, a name correction, or a room or seat preference.',
      amendNote: 'This sends a request only. We\'ll be in touch to confirm, and your booking won\'t change straight away.',
      amendSubmit: 'Send request',
      amendCancel: 'Cancel',
      amendSending: 'Sending…',
      amendRateLimited: 'Too many attempts. Please wait a few minutes and try again.',
      amendDoneTitle: 'Request sent',
      amendDoneBody: 'We\'ve passed your request to the team. Nothing on your booking has changed yet, and we\'ll be in touch to confirm.',
      amendFailed: 'We couldn\'t send your request just now. Please try again, or contact us.',
      payNextBtn: 'Pay next payment',
      payBalanceBtn: 'Pay balance',
      payConfirm: 'Pay',
      payAmountLabel: 'Amount to pay',
      payCancel: 'Cancel',
      payRedirecting: 'Setting up payment…',
      payRateLimited: 'Too many attempts. Please wait a few minutes and try again.',
      payNoBalance: 'There\'s nothing left to pay on this booking.',
      payFailed: 'We couldn\'t start the payment just now. Please try again, or contact us.',
      payTooMuch: 'That\'s more than your balance of {amount}.',
      payTooSmall: 'The smallest part payment is {amount}.',
      payHintInstalment: 'Your next payment is {next}. Pay that, or enter a different amount up to {max}.',
      payHintFull: 'Pay your balance in full, or enter a smaller amount (up to {max}).',
      confirmed: 'Confirmed',
      atolProtected: 'ATOL Protected',
      packagedHoliday: 'Package Holiday',
      operatedBy: 'operated by',
      yourBooking: 'Your booking',
      reviews: 'reviews',
      greetingPrefix: 'Welcome back',
      greetingSuffix: 'your {city} escape is almost here.',
      countdownFly: 'until you fly',
      countdownCheckIn: 'until you check in',
      countdownTravel: 'until you travel',
      day: 'day',
      days: 'days',
      newLookup: 'Look up another booking',
      actionPreview: 'Preview',
      actionPreviewSub: 'View the booking pack inline',
      actionEmail: 'Email',
      actionEmailSub: 'Send to your inbox',
      actionDownload: 'Download',
      actionDownloadSub: 'Save the PDF to your device',
      actionPrint: 'Print',
      actionPrintSub: 'Open a printable copy',
      accommodation: 'Accommodation',
      checkin: 'Check-in',
      checkout: 'Check-out',
      nights: 'Nights',
      night: 'night',
      nightsPlural: 'nights',
      week: '1 week',
      room: 'Room',
      guest: 'guest',
      guests: 'guests',
      payment: 'Payment',
      hotelLine: 'Hotel',
      packageLine: 'Holiday package',
      extrasLine: 'Airport extras',
      paidSoFar: 'Paid so far',
      balanceRemaining: 'Balance remaining',
      paymentSchedule: 'Payment schedule',
      payments: 'payments',
      next: 'Next',
      nextDueDate: 'Next payment due',
      paidInFull: 'Paid in full',
      depositPaid: 'Deposit paid',
      balanceDue: 'Balance due',
      dueDate: 'Due date',
      instalmentPlan: 'Instalment plan',
      payOnArrival: 'Also payable on arrival',
      payOnArrivalNote: 'Paid directly to the hotel at check-in. Not included in your holiday cost above.',
      resortFee: 'Resort fees',
      travelling: 'Who\'s travelling',
      leadGuest: 'Lead guest',
      adult: 'Adult',
      specialRequests: 'Special requests',
      documents: 'Your documents',
      thingsToKnow: 'Things to know',
      aboutHotel: 'About the hotel',
      address: 'Address',
      viewMap: 'View on map',
      propertyDetails: 'Property details',
      yearBuilt: 'Year built',
      totalRooms: 'Total rooms',
      roomMix: 'Room mix',
      facilities: 'Facilities',
      paymentMethods: 'Accepted at the hotel',
      localFees: 'At the hotel',
      checkInOutTimes: 'Check-in & check-out',
      goodToKnow: 'Good to know',
      helpTitle: 'Need a hand?',
      helpBody: 'Our team\'s here if anything about your booking needs attention.',
      emailUs: 'Email us',
      callUs: 'Call us',
      flight: 'Flight',
      direct: 'Direct',
      stop: 'stop',
      stops: 'stops',
      stopoverIn: 'Stopover in {iata}',
      stopoverInTimed: '{dur} stopover in {iata}',
      aircraft: 'Aircraft',
      thisProduct: 'this product',
      product: 'product',
      cancelPrefix: 'Cancel',
      cancelLoadingSub: 'Checking the cancellation policy…',
      cancelLoading: 'Loading cancellation details…',
      cancelRef: 'Booking reference',
      cancelPoliciesSub: 'Please review the cancellation policy below.',
      cancelPoliciesLabel: 'Cancellation policy & charges',
      cancelNoPolicy: 'No specific charges were returned for this product.',
      cancelWarn: 'Cancelling cannot be undone. Any charges above will apply.',
      cancelKeep: 'Keep booking',
      cancelContinue: 'Continue',
      cancelReasonTitle: 'Confirm cancellation',
      cancelReasonSub: 'Let us know why you\'re cancelling (optional).',
      cancelReasonLabel: 'Reason for cancelling',
      cancelReasonPlaceholder: 'e.g. change of plans',
      cancelFinalWarn: 'This will cancel the product and can\'t be undone.',
      cancelBack: 'Back',
      cancelConfirm: 'Cancel this product',
      cancelConfirming: 'Cancelling…',
      cancelWorkingTitle: 'Cancelling…',
      cancelWorkingSub: 'Please wait while we process this.',
      cancelWorking: 'Cancelling your product…',
      cancelDoneTitle: 'Cancellation confirmed',
      cancelDoneHead: 'That\'s cancelled',
      cancelDoneBodyTmpl: 'Your {label} has been cancelled.',
      cancelRefLabel: 'Reference',
      cancelDoneBtn: 'Done',
      cancelErrorTitle: 'Unable to cancel',
      cancelClose: 'Close',
      emailModalTitle: 'Email booking pack',
      emailModalSubName: 'Send {name} a copy of this booking pack',
      emailModalSub: 'Send a copy of this booking pack',
      emailTo: 'Send to',
      emailToHelp: 'Defaults to the email on your booking. Edit to send to a different address.',
      emailCc: 'Also send to (optional)',
      emailCcHelp: 'Separate multiple addresses with commas. Up to 3.',
      emailMessage: 'Add a message (optional)',
      emailMessagePlaceholder: 'A short note that will appear above the booking summary.',
      emailAttachment: 'Attachment',
      emailAttachmentMeta: 'A4 booking confirmation pack',
      emailCancel: 'Cancel',
      emailSend: 'Send email',
      emailInvalidTo: 'Please enter a valid email address in the To field.',
      emailInvalidCc: '"{email}" doesn\'t look like a valid email address.',
      emailTooManyCc: 'You can include up to 3 additional addresses. Remove some and try again.',
      emailHolderReqd: 'The booking holder\'s email ({email}) must be included as a recipient.',
      emailHolderReqdShort: 'The booking holder\'s email must be included as a recipient.',
      emailSending: 'Sending…',
      emailToastSendTitle: 'Sending your booking pack',
      emailToastSendSub: 'Generating PDF and emailing it now.',
      emailTooMany: 'Too many email requests. Please wait a few minutes and try again.',
      emailInvalidRecipients: 'One of the email addresses looks invalid. Please check and try again.',
      emailInvalidMessage: 'Your message is too long. Please shorten it to under 1000 characters.',
      emailSendFailed: 'We couldn\'t send the email just now. Please try again in a moment.',
      emailNotFound: 'We couldn\'t find that booking. Please look it up again.',
      genericError: 'Something went wrong. Please try again in a moment.',
      emailSentTitle: 'Email sent',
      emailSentSub: 'Booking pack on its way to {email}.',
      emailNetworkError: 'Network error. Please check your connection and try again.',
      pdfCannotTitle: 'Cannot generate PDF',
      pdfLookupAgain: 'Please look up your booking again.',
      pdfGeneratingTitle: 'Generating your PDF',
      pdfGeneratingSub: 'This usually takes a few seconds.',
      pdfTooManyTitle: 'Too many requests',
      pdfTooManySub: 'Please wait a few minutes and try again.',
      pdfCouldntTitle: 'We couldn\'t generate that PDF',
      pdfWrongTitle: 'Something went wrong',
      pdfTryAgainSoon: 'Please try again in a moment.',
      pdfFailedTitle: 'Generation failed',
      pdfCheckConnection: 'Please check your connection and try again.',
      pdfDownloadedTitle: 'PDF downloaded',
      pdfPopupTitle: 'Allow pop-ups to print',
      pdfPopupSub: 'Or use Download, then print the saved PDF.',
      fillAllFields: 'Please fill in all three fields.',
      notConfigured: 'This widget is not configured yet. Please contact support.',
      tooManyAttempts: 'Too many attempts. Please wait a few minutes and try again.',
      somethingWrong: 'Something went wrong.',
      ariaClose: 'Close',
      ariaViewImage: 'View image {n}',
      totalCost: 'Total cost',
      totalHoliday: 'Total holiday cost',
      totalFlights: 'Total flight cost',
      totalExtras: 'Total cost',
      totalTickets: 'Total ticket cost',
      totalCarHire: 'Total car hire cost',
      totalTransfer: 'Total transfer cost',
      totalInsurance: 'Total insurance cost',
    },
    fr: {
      title: 'Ma réservation',
      subtitle: 'Bon retour. Saisissez vos informations pour voir tous les détails de votre prochain voyage.',
      subtitleShort: 'Retrouvez votre voyage en quelques secondes',
      eyebrow: 'Recherche de réservation sécurisée',
      email: 'Adresse e-mail',
      date: 'Date de départ',
      ref: 'Référence de réservation',
      refShort: 'Référence',
      refPlaceholder: 'ex. ABC12345',
      submit: 'Trouver ma réservation',
      submitShort: 'Trouver la réservation',
      trust: 'Vos données sont chiffrées et jamais stockées.',
      trustShort: 'Recherche sécurisée',
      loadingTitle: 'Recherche de votre réservation',
      loadingSub: 'Cela prend généralement quelques secondes.',
      nfTitle: 'Réservation introuvable',
      nfBody: 'Veuillez vérifier votre adresse e-mail, votre date de départ et votre référence de réservation. Si tout semble correct, contactez-nous et nous vous aiderons aussitôt.',
      nfRetry: 'Réessayer',
      nfContact: 'Contacter le service client',
      flights: 'Vols',
      fareConditions: 'Conditions tarifaires',
      flightsLine: 'Vols',
      outbound: 'Aller',
      return: 'Retour',
      whatToExpect: 'À quoi s\'attendre',
      atAGlance: 'En un coup d\'œil',
      openingTimes: 'Horaires d\'ouverture',
      dressCode: 'Code vestimentaire',
      included: 'Inclus',
      drinks: 'Boissons',
      food: 'Restauration',
      flightAnnouncements: 'Annonces de vol',
      features: 'Caractéristiques',
      transfer: 'Transfert',
      transferInfo: 'Informations importantes',
      transfersLine: 'Transferts',
      cancellation: 'Politique d\'annulation',
      carHire: 'Location de voiture',
      carHireLine: 'Location de voiture',
      carHireInfo: 'Informations importantes',
      suppliedBy: 'Fourni par',
      pickup: 'Prise en charge',
      dropoff: 'Restitution',
      payAtPickup: 'À régler également au retrait',
      payAtPickupNote: 'À régler directement au comptoir de location lors du retrait. Non compris dans le coût de votre réservation ci-dessus.',
      ticket: 'Billet',
      ticketsLine: 'Billets',
      ticketDetails: 'Détails',
      highlights: 'Points forts',
      notIncluded: 'Non inclus',
      meetingPoint: 'Point de rendez-vous',
      languages: 'Langues',
      cancelledPill: 'Annulée',
      cancelBtn: 'Annuler',
      cancelSecTitle: 'Besoin d\'annuler quelque chose ?',
      cancelSecSub: 'Vous verrez la politique d\'annulation et les éventuels frais avant toute confirmation.',
      amendSecTitle: 'Besoin de modifier quelque chose ?',
      amendSecSub: 'Dites-nous ce que vous souhaitez modifier et nous transmettrons votre demande à l\'équipe. Rien ne change sur votre réservation tant qu\'ils ne l\'ont pas confirmé.',
      amendOpen: 'Demander une modification',
      amendFieldLabel: 'Que souhaitez-vous modifier ?',
      amendPlaceholder: 'Par exemple un changement de date, une correction de nom ou une préférence de chambre ou de siège.',
      amendNote: 'Ceci envoie uniquement une demande. Nous vous contacterons pour confirmer et votre réservation ne changera pas immédiatement.',
      amendSubmit: 'Envoyer la demande',
      amendCancel: 'Annuler',
      amendSending: 'Envoi…',
      amendRateLimited: 'Trop de tentatives. Veuillez patienter quelques minutes et réessayer.',
      amendDoneTitle: 'Demande envoyée',
      amendDoneBody: 'Nous avons transmis votre demande à l\'équipe. Rien n\'a encore changé sur votre réservation et nous vous contacterons pour confirmer.',
      amendFailed: 'Nous n\'avons pas pu envoyer votre demande pour le moment. Veuillez réessayer ou nous contacter.',
      payNextBtn: 'Payer le prochain versement',
      payBalanceBtn: 'Payer le solde',
      payConfirm: 'Payer',
      payAmountLabel: 'Montant à payer',
      payCancel: 'Annuler',
      payRedirecting: 'Préparation du paiement…',
      payRateLimited: 'Trop de tentatives. Veuillez patienter quelques minutes et réessayer.',
      payNoBalance: 'Il n\'y a plus rien à payer sur cette réservation.',
      payFailed: 'Nous n\'avons pas pu démarrer le paiement pour le moment. Veuillez réessayer ou nous contacter.',
      payTooMuch: 'C\'est plus que votre solde de {amount}.',
      payTooSmall: 'Le paiement partiel minimum est de {amount}.',
      payHintInstalment: 'Votre prochain versement est de {next}. Réglez-le ou saisissez un autre montant jusqu\'à {max}.',
      payHintFull: 'Réglez l\'intégralité de votre solde ou saisissez un montant inférieur (jusqu\'à {max}).',
      confirmed: 'Confirmée',
      atolProtected: 'ATOL Protected',
      packagedHoliday: 'Séjour forfait',
      operatedBy: 'exploité par',
      yourBooking: 'Votre réservation',
      reviews: 'avis',
      greetingPrefix: 'Bon retour',
      greetingSuffix: 'votre escapade à {city} approche.',
      countdownFly: 'avant votre vol',
      countdownCheckIn: 'avant votre arrivée',
      countdownTravel: 'avant votre départ',
      day: 'jour',
      days: 'jours',
      newLookup: 'Rechercher une autre réservation',
      actionPreview: 'Aperçu',
      actionPreviewSub: 'Voir le dossier de réservation ici',
      actionEmail: 'E-mail',
      actionEmailSub: 'Envoyer dans votre boîte mail',
      actionDownload: 'Télécharger',
      actionDownloadSub: 'Enregistrer le PDF sur votre appareil',
      actionPrint: 'Imprimer',
      actionPrintSub: 'Ouvrir une version imprimable',
      accommodation: 'Hébergement',
      checkin: 'Arrivée',
      checkout: 'Départ',
      nights: 'Nuits',
      night: 'nuit',
      nightsPlural: 'nuits',
      week: '1 semaine',
      room: 'Chambre',
      guest: 'voyageur',
      guests: 'voyageurs',
      payment: 'Paiement',
      hotelLine: 'Hôtel',
      packageLine: 'Forfait vacances',
      extrasLine: 'Extras aéroport',
      paidSoFar: 'Payé à ce jour',
      balanceRemaining: 'Solde restant',
      paymentSchedule: 'Échéancier de paiement',
      payments: 'versements',
      next: 'Prochain',
      nextDueDate: 'Prochain paiement dû',
      paidInFull: 'Intégralement payé',
      depositPaid: 'Acompte versé',
      balanceDue: 'Solde à payer',
      dueDate: 'Date d\'échéance',
      instalmentPlan: 'Plan de paiement échelonné',
      payOnArrival: 'À régler également à l\'arrivée',
      payOnArrivalNote: 'À régler directement à l\'hôtel lors de l\'arrivée. Non compris dans le coût de votre séjour ci-dessus.',
      resortFee: 'Frais de complexe',
      travelling: 'Qui voyage',
      leadGuest: 'Voyageur principal',
      adult: 'Adulte',
      specialRequests: 'Demandes spéciales',
      documents: 'Vos documents',
      thingsToKnow: 'Bon à savoir',
      aboutHotel: 'À propos de l\'hôtel',
      address: 'Adresse',
      viewMap: 'Voir sur la carte',
      propertyDetails: 'Détails de l\'établissement',
      yearBuilt: 'Année de construction',
      totalRooms: 'Nombre de chambres',
      roomMix: 'Types de chambres',
      facilities: 'Équipements',
      paymentMethods: 'Acceptés à l\'hôtel',
      localFees: 'À l\'hôtel',
      checkInOutTimes: 'Arrivée et départ',
      goodToKnow: 'Bon à savoir',
      helpTitle: 'Besoin d\'aide ?',
      helpBody: 'Notre équipe est là si quoi que ce soit concernant votre réservation nécessite une attention.',
      emailUs: 'Nous écrire',
      callUs: 'Nous appeler',
      flight: 'Vol',
      direct: 'Direct',
      stop: 'escale',
      stops: 'escales',
      stopoverIn: 'Escale à {iata}',
      stopoverInTimed: 'Escale de {dur} à {iata}',
      aircraft: 'Appareil',
      thisProduct: 'ce produit',
      product: 'produit',
      cancelPrefix: 'Annuler',
      cancelLoadingSub: 'Vérification de la politique d\'annulation…',
      cancelLoading: 'Chargement des détails d\'annulation…',
      cancelRef: 'Référence de réservation',
      cancelPoliciesSub: 'Veuillez consulter la politique d\'annulation ci-dessous.',
      cancelPoliciesLabel: 'Politique d\'annulation et frais',
      cancelNoPolicy: 'Aucun frais spécifique n\'a été indiqué pour ce produit.',
      cancelWarn: 'L\'annulation est irréversible. Les frais indiqués ci-dessus s\'appliqueront.',
      cancelKeep: 'Conserver la réservation',
      cancelContinue: 'Continuer',
      cancelReasonTitle: 'Confirmer l\'annulation',
      cancelReasonSub: 'Dites-nous pourquoi vous annulez (facultatif).',
      cancelReasonLabel: 'Motif de l\'annulation',
      cancelReasonPlaceholder: 'ex. changement de programme',
      cancelFinalWarn: 'Cela annulera le produit et est irréversible.',
      cancelBack: 'Retour',
      cancelConfirm: 'Annuler ce produit',
      cancelConfirming: 'Annulation…',
      cancelWorkingTitle: 'Annulation…',
      cancelWorkingSub: 'Veuillez patienter pendant le traitement.',
      cancelWorking: 'Annulation de votre produit…',
      cancelDoneTitle: 'Annulation confirmée',
      cancelDoneHead: 'C\'est annulé',
      cancelDoneBodyTmpl: 'Votre {label} a été annulé.',
      cancelRefLabel: 'Référence',
      cancelDoneBtn: 'Terminé',
      cancelErrorTitle: 'Annulation impossible',
      cancelClose: 'Fermer',
      emailModalTitle: 'Envoyer le dossier par e-mail',
      emailModalSubName: 'Envoyer à {name} une copie de ce dossier de réservation',
      emailModalSub: 'Envoyer une copie de ce dossier de réservation',
      emailTo: 'Envoyer à',
      emailToHelp: 'Par défaut, l\'e-mail de votre réservation. Modifiez pour envoyer à une autre adresse.',
      emailCc: 'Envoyer aussi à (facultatif)',
      emailCcHelp: 'Séparez plusieurs adresses par des virgules. Jusqu\'à 3.',
      emailMessage: 'Ajouter un message (facultatif)',
      emailMessagePlaceholder: 'Une courte note qui apparaîtra au-dessus du récapitulatif de réservation.',
      emailAttachment: 'Pièce jointe',
      emailAttachmentMeta: 'Dossier de confirmation de réservation A4',
      emailCancel: 'Annuler',
      emailSend: 'Envoyer l\'e-mail',
      emailInvalidTo: 'Veuillez saisir une adresse e-mail valide dans le champ Envoyer à.',
      emailInvalidCc: '« {email} » ne semble pas être une adresse e-mail valide.',
      emailTooManyCc: 'Vous pouvez inclure jusqu\'à 3 adresses supplémentaires. Supprimez-en et réessayez.',
      emailHolderReqd: 'L\'e-mail du titulaire de la réservation ({email}) doit figurer parmi les destinataires.',
      emailHolderReqdShort: 'L\'e-mail du titulaire de la réservation doit figurer parmi les destinataires.',
      emailSending: 'Envoi…',
      emailToastSendTitle: 'Envoi de votre dossier de réservation',
      emailToastSendSub: 'Génération du PDF et envoi en cours.',
      emailTooMany: 'Trop de demandes d\'e-mail. Veuillez patienter quelques minutes et réessayer.',
      emailInvalidRecipients: 'L\'une des adresses e-mail semble invalide. Veuillez vérifier et réessayer.',
      emailInvalidMessage: 'Votre message est trop long. Veuillez le raccourcir à moins de 1000 caractères.',
      emailSendFailed: 'Nous n\'avons pas pu envoyer l\'e-mail pour le moment. Veuillez réessayer dans un instant.',
      emailNotFound: 'Réservation introuvable. Veuillez la rechercher à nouveau.',
      genericError: 'Une erreur s\'est produite. Veuillez réessayer dans un instant.',
      emailSentTitle: 'E-mail envoyé',
      emailSentSub: 'Dossier de réservation en route vers {email}.',
      emailNetworkError: 'Erreur réseau. Veuillez vérifier votre connexion et réessayer.',
      pdfCannotTitle: 'Impossible de générer le PDF',
      pdfLookupAgain: 'Veuillez rechercher à nouveau votre réservation.',
      pdfGeneratingTitle: 'Génération de votre PDF',
      pdfGeneratingSub: 'Cela prend généralement quelques secondes.',
      pdfTooManyTitle: 'Trop de demandes',
      pdfTooManySub: 'Veuillez patienter quelques minutes et réessayer.',
      pdfCouldntTitle: 'Impossible de générer ce PDF',
      pdfWrongTitle: 'Une erreur s\'est produite',
      pdfTryAgainSoon: 'Veuillez réessayer dans un instant.',
      pdfFailedTitle: 'Échec de la génération',
      pdfCheckConnection: 'Veuillez vérifier votre connexion et réessayer.',
      pdfDownloadedTitle: 'PDF téléchargé',
      pdfPopupTitle: 'Autoriser les pop-ups pour imprimer',
      pdfPopupSub: 'Ou utilisez Télécharger, puis imprimez le PDF enregistré.',
      fillAllFields: 'Veuillez remplir les trois champs.',
      notConfigured: 'Ce widget n\'est pas encore configuré. Veuillez contacter le support.',
      tooManyAttempts: 'Trop de tentatives. Veuillez patienter quelques minutes et réessayer.',
      somethingWrong: 'Une erreur s\'est produite.',
      ariaClose: 'Fermer',
      ariaViewImage: 'Voir l\'image {n}',
      totalCost: 'Coût total',
      totalHoliday: 'Coût total du séjour',
      totalFlights: 'Coût total des vols',
      totalExtras: 'Coût total',
      totalTickets: 'Coût total des billets',
      totalCarHire: 'Coût total de la location de voiture',
      totalTransfer: 'Coût total du transfert',
      totalInsurance: 'Coût total de l\'assurance',
    },
    de: {
      title: 'Meine Buchung',
      subtitle: 'Willkommen zurück. Geben Sie Ihre Daten ein, um alles zu Ihrer bevorstehenden Reise zu sehen.',
      subtitleShort: 'Finden Sie Ihre Reise in Sekunden',
      eyebrow: 'Sichere Buchungssuche',
      email: 'E-Mail-Adresse',
      date: 'Abreisedatum',
      ref: 'Buchungsnummer',
      refShort: 'Referenz',
      refPlaceholder: 'z. B. ABC12345',
      submit: 'Meine Buchung finden',
      submitShort: 'Buchung finden',
      trust: 'Ihre Daten werden verschlüsselt und niemals gespeichert.',
      trustShort: 'Sichere Suche',
      loadingTitle: 'Ihre Buchung wird gesucht',
      loadingSub: 'Das dauert normalerweise nur ein paar Sekunden.',
      nfTitle: 'Buchung nicht gefunden',
      nfBody: 'Bitte überprüfen Sie Ihre E-Mail-Adresse, Ihr Abreisedatum und Ihre Buchungsnummer. Wenn die Angaben stimmen, melden Sie sich und wir helfen Ihnen sofort.',
      nfRetry: 'Erneut versuchen',
      nfContact: 'Support kontaktieren',
      flights: 'Flüge',
      fareConditions: 'Tarifbedingungen',
      flightsLine: 'Flüge',
      outbound: 'Hinflug',
      return: 'Rückreise',
      whatToExpect: 'Was Sie erwartet',
      atAGlance: 'Auf einen Blick',
      openingTimes: 'Öffnungszeiten',
      dressCode: 'Kleiderordnung',
      included: 'Inbegriffen',
      drinks: 'Getränke',
      food: 'Essen',
      flightAnnouncements: 'Flugdurchsagen',
      features: 'Ausstattung',
      transfer: 'Transfer',
      transferInfo: 'Wichtige Informationen',
      transfersLine: 'Transfers',
      cancellation: 'Stornierungsbedingungen',
      carHire: 'Mietwagen',
      carHireLine: 'Mietwagen',
      carHireInfo: 'Wichtige Informationen',
      suppliedBy: 'Bereitgestellt von',
      pickup: 'Abholung',
      dropoff: 'Rückgabe',
      payAtPickup: 'Auch bei Abholung zahlbar',
      payAtPickupNote: 'Direkt am Mietschalter bei Abholung zu zahlen. Nicht im oben genannten Buchungspreis enthalten.',
      ticket: 'Ticket',
      ticketsLine: 'Tickets',
      ticketDetails: 'Details',
      highlights: 'Höhepunkte',
      notIncluded: 'Nicht inbegriffen',
      meetingPoint: 'Treffpunkt',
      languages: 'Sprachen',
      cancelledPill: 'Storniert',
      cancelBtn: 'Stornieren',
      cancelSecTitle: 'Müssen Sie etwas stornieren?',
      cancelSecSub: 'Sie sehen die Stornierungsbedingungen und etwaige Gebühren, bevor etwas bestätigt wird.',
      amendSecTitle: 'Möchten Sie etwas ändern?',
      amendSecSub: 'Sagen Sie uns, was Sie ändern möchten, und wir leiten es an das Team weiter. An Ihrer Buchung ändert sich nichts, bis es bestätigt wurde.',
      amendOpen: 'Änderung anfragen',
      amendFieldLabel: 'Was möchten Sie ändern?',
      amendPlaceholder: 'Zum Beispiel eine Datumsänderung, eine Namenskorrektur oder ein Zimmer- oder Sitzplatzwunsch.',
      amendNote: 'Dies sendet nur eine Anfrage. Wir melden uns zur Bestätigung, und Ihre Buchung ändert sich nicht sofort.',
      amendSubmit: 'Anfrage senden',
      amendCancel: 'Abbrechen',
      amendSending: 'Wird gesendet…',
      amendRateLimited: 'Zu viele Versuche. Bitte warten Sie einige Minuten und versuchen Sie es erneut.',
      amendDoneTitle: 'Anfrage gesendet',
      amendDoneBody: 'Wir haben Ihre Anfrage an das Team weitergeleitet. An Ihrer Buchung hat sich noch nichts geändert, und wir melden uns zur Bestätigung.',
      amendFailed: 'Wir konnten Ihre Anfrage gerade nicht senden. Bitte versuchen Sie es erneut oder kontaktieren Sie uns.',
      payNextBtn: 'Nächste Zahlung leisten',
      payBalanceBtn: 'Restbetrag zahlen',
      payConfirm: 'Zahlen',
      payAmountLabel: 'Zu zahlender Betrag',
      payCancel: 'Abbrechen',
      payRedirecting: 'Zahlung wird vorbereitet…',
      payRateLimited: 'Zu viele Versuche. Bitte warten Sie einige Minuten und versuchen Sie es erneut.',
      payNoBalance: 'Für diese Buchung ist nichts mehr zu zahlen.',
      payFailed: 'Wir konnten die Zahlung gerade nicht starten. Bitte versuchen Sie es erneut oder kontaktieren Sie uns.',
      payTooMuch: 'Das ist mehr als Ihr Restbetrag von {amount}.',
      payTooSmall: 'Die kleinste Teilzahlung beträgt {amount}.',
      payHintInstalment: 'Ihre nächste Zahlung beträgt {next}. Zahlen Sie diese oder geben Sie einen anderen Betrag bis zu {max} ein.',
      payHintFull: 'Zahlen Sie Ihren Restbetrag vollständig oder geben Sie einen kleineren Betrag ein (bis zu {max}).',
      confirmed: 'Bestätigt',
      atolProtected: 'ATOL Protected',
      packagedHoliday: 'Pauschalreise',
      operatedBy: 'durchgeführt von',
      yourBooking: 'Ihre Buchung',
      reviews: 'Bewertungen',
      greetingPrefix: 'Willkommen zurück',
      greetingSuffix: 'Ihre Auszeit in {city} steht fast bevor.',
      countdownFly: 'bis zum Abflug',
      countdownCheckIn: 'bis zum Check-in',
      countdownTravel: 'bis zur Abreise',
      day: 'Tag',
      days: 'Tage',
      newLookup: 'Andere Buchung suchen',
      actionPreview: 'Vorschau',
      actionPreviewSub: 'Buchungsunterlagen direkt ansehen',
      actionEmail: 'E-Mail',
      actionEmailSub: 'An Ihr Postfach senden',
      actionDownload: 'Herunterladen',
      actionDownloadSub: 'PDF auf Ihrem Gerät speichern',
      actionPrint: 'Drucken',
      actionPrintSub: 'Druckversion öffnen',
      accommodation: 'Unterkunft',
      checkin: 'Check-in',
      checkout: 'Check-out',
      nights: 'Nächte',
      night: 'Nacht',
      nightsPlural: 'Nächte',
      week: '1 Woche',
      room: 'Zimmer',
      guest: 'Gast',
      guests: 'Gäste',
      payment: 'Zahlung',
      hotelLine: 'Hotel',
      packageLine: 'Reisepaket',
      extrasLine: 'Flughafen-Extras',
      paidSoFar: 'Bisher gezahlt',
      balanceRemaining: 'Verbleibender Restbetrag',
      paymentSchedule: 'Zahlungsplan',
      payments: 'Zahlungen',
      next: 'Nächste',
      nextDueDate: 'Nächste Zahlung fällig',
      paidInFull: 'Vollständig bezahlt',
      depositPaid: 'Anzahlung geleistet',
      balanceDue: 'Restbetrag fällig',
      dueDate: 'Fälligkeitsdatum',
      instalmentPlan: 'Ratenzahlungsplan',
      payOnArrival: 'Auch bei Ankunft zahlbar',
      payOnArrivalNote: 'Direkt im Hotel beim Check-in zu zahlen. Nicht in den oben genannten Reisekosten enthalten.',
      resortFee: 'Resortgebühren',
      travelling: 'Wer reist',
      leadGuest: 'Hauptgast',
      adult: 'Erwachsener',
      specialRequests: 'Sonderwünsche',
      documents: 'Ihre Dokumente',
      thingsToKnow: 'Wissenswertes',
      aboutHotel: 'Über das Hotel',
      address: 'Adresse',
      viewMap: 'Auf Karte ansehen',
      propertyDetails: 'Objektdetails',
      yearBuilt: 'Baujahr',
      totalRooms: 'Anzahl Zimmer',
      roomMix: 'Zimmerarten',
      facilities: 'Einrichtungen',
      paymentMethods: 'Im Hotel akzeptiert',
      localFees: 'Im Hotel',
      checkInOutTimes: 'Check-in & Check-out',
      goodToKnow: 'Gut zu wissen',
      helpTitle: 'Brauchen Sie Hilfe?',
      helpBody: 'Unser Team ist da, falls bei Ihrer Buchung etwas Aufmerksamkeit braucht.',
      emailUs: 'E-Mail an uns',
      callUs: 'Anrufen',
      flight: 'Flug',
      direct: 'Direkt',
      stop: 'Stopp',
      stops: 'Stopps',
      stopoverIn: 'Zwischenstopp in {iata}',
      stopoverInTimed: '{dur} Zwischenstopp in {iata}',
      aircraft: 'Flugzeug',
      thisProduct: 'dieses Produkt',
      product: 'Produkt',
      cancelPrefix: 'Stornieren',
      cancelLoadingSub: 'Stornierungsbedingungen werden geprüft…',
      cancelLoading: 'Stornierungsdetails werden geladen…',
      cancelRef: 'Buchungsnummer',
      cancelPoliciesSub: 'Bitte prüfen Sie die Stornierungsbedingungen unten.',
      cancelPoliciesLabel: 'Stornierungsbedingungen & Gebühren',
      cancelNoPolicy: 'Für dieses Produkt wurden keine speziellen Gebühren angegeben.',
      cancelWarn: 'Die Stornierung kann nicht rückgängig gemacht werden. Etwaige oben genannte Gebühren fallen an.',
      cancelKeep: 'Buchung behalten',
      cancelContinue: 'Weiter',
      cancelReasonTitle: 'Stornierung bestätigen',
      cancelReasonSub: 'Sagen Sie uns, warum Sie stornieren (optional).',
      cancelReasonLabel: 'Grund für die Stornierung',
      cancelReasonPlaceholder: 'z. B. geänderte Pläne',
      cancelFinalWarn: 'Dadurch wird das Produkt storniert und kann nicht rückgängig gemacht werden.',
      cancelBack: 'Zurück',
      cancelConfirm: 'Dieses Produkt stornieren',
      cancelConfirming: 'Wird storniert…',
      cancelWorkingTitle: 'Wird storniert…',
      cancelWorkingSub: 'Bitte warten Sie, während wir dies bearbeiten.',
      cancelWorking: 'Ihr Produkt wird storniert…',
      cancelDoneTitle: 'Stornierung bestätigt',
      cancelDoneHead: 'Storniert',
      cancelDoneBodyTmpl: 'Ihr {label} wurde storniert.',
      cancelRefLabel: 'Referenz',
      cancelDoneBtn: 'Fertig',
      cancelErrorTitle: 'Stornierung nicht möglich',
      cancelClose: 'Schließen',
      emailModalTitle: 'Buchungsunterlagen per E-Mail',
      emailModalSubName: '{name} eine Kopie dieser Buchungsunterlagen senden',
      emailModalSub: 'Eine Kopie dieser Buchungsunterlagen senden',
      emailTo: 'Senden an',
      emailToHelp: 'Standardmäßig die E-Mail Ihrer Buchung. Ändern Sie sie, um an eine andere Adresse zu senden.',
      emailCc: 'Auch senden an (optional)',
      emailCcHelp: 'Trennen Sie mehrere Adressen durch Kommas. Bis zu 3.',
      emailMessage: 'Nachricht hinzufügen (optional)',
      emailMessagePlaceholder: 'Eine kurze Notiz, die über der Buchungsübersicht erscheint.',
      emailAttachment: 'Anhang',
      emailAttachmentMeta: 'A4-Buchungsbestätigungsunterlagen',
      emailCancel: 'Abbrechen',
      emailSend: 'E-Mail senden',
      emailInvalidTo: 'Bitte geben Sie eine gültige E-Mail-Adresse im Feld Senden an ein.',
      emailInvalidCc: '„{email}" sieht nicht wie eine gültige E-Mail-Adresse aus.',
      emailTooManyCc: 'Sie können bis zu 3 zusätzliche Adressen angeben. Entfernen Sie einige und versuchen Sie es erneut.',
      emailHolderReqd: 'Die E-Mail des Buchungsinhabers ({email}) muss als Empfänger enthalten sein.',
      emailHolderReqdShort: 'Die E-Mail des Buchungsinhabers muss als Empfänger enthalten sein.',
      emailSending: 'Wird gesendet…',
      emailToastSendTitle: 'Ihre Buchungsunterlagen werden gesendet',
      emailToastSendSub: 'PDF wird erstellt und jetzt per E-Mail versendet.',
      emailTooMany: 'Zu viele E-Mail-Anfragen. Bitte warten Sie einige Minuten und versuchen Sie es erneut.',
      emailInvalidRecipients: 'Eine der E-Mail-Adressen scheint ungültig zu sein. Bitte prüfen Sie sie und versuchen Sie es erneut.',
      emailInvalidMessage: 'Ihre Nachricht ist zu lang. Bitte kürzen Sie sie auf unter 1000 Zeichen.',
      emailSendFailed: 'Wir konnten die E-Mail gerade nicht senden. Bitte versuchen Sie es gleich erneut.',
      emailNotFound: 'Buchung nicht gefunden. Bitte suchen Sie sie erneut.',
      genericError: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es gleich erneut.',
      emailSentTitle: 'E-Mail gesendet',
      emailSentSub: 'Buchungsunterlagen sind unterwegs an {email}.',
      emailNetworkError: 'Netzwerkfehler. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
      pdfCannotTitle: 'PDF kann nicht erstellt werden',
      pdfLookupAgain: 'Bitte suchen Sie Ihre Buchung erneut.',
      pdfGeneratingTitle: 'Ihr PDF wird erstellt',
      pdfGeneratingSub: 'Das dauert normalerweise ein paar Sekunden.',
      pdfTooManyTitle: 'Zu viele Anfragen',
      pdfTooManySub: 'Bitte warten Sie einige Minuten und versuchen Sie es erneut.',
      pdfCouldntTitle: 'Dieses PDF konnte nicht erstellt werden',
      pdfWrongTitle: 'Etwas ist schiefgelaufen',
      pdfTryAgainSoon: 'Bitte versuchen Sie es gleich erneut.',
      pdfFailedTitle: 'Erstellung fehlgeschlagen',
      pdfCheckConnection: 'Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
      pdfDownloadedTitle: 'PDF heruntergeladen',
      pdfPopupTitle: 'Pop-ups zum Drucken zulassen',
      pdfPopupSub: 'Oder verwenden Sie Herunterladen und drucken Sie dann das gespeicherte PDF.',
      fillAllFields: 'Bitte füllen Sie alle drei Felder aus.',
      notConfigured: 'Dieses Widget ist noch nicht konfiguriert. Bitte wenden Sie sich an den Support.',
      tooManyAttempts: 'Zu viele Versuche. Bitte warten Sie einige Minuten und versuchen Sie es erneut.',
      somethingWrong: 'Etwas ist schiefgelaufen.',
      ariaClose: 'Schließen',
      ariaViewImage: 'Bild {n} ansehen',
      totalCost: 'Gesamtkosten',
      totalHoliday: 'Gesamtkosten der Reise',
      totalFlights: 'Gesamtkosten der Flüge',
      totalExtras: 'Gesamtkosten',
      totalTickets: 'Gesamtkosten der Tickets',
      totalCarHire: 'Gesamtkosten des Mietwagens',
      totalTransfer: 'Gesamtkosten des Transfers',
      totalInsurance: 'Gesamtkosten der Versicherung',
    },
    es: {
      title: 'Mi reserva',
      subtitle: 'Bienvenido de nuevo. Introduce tus datos para ver todo sobre tu próximo viaje.',
      subtitleShort: 'Encuentra tu viaje en segundos',
      eyebrow: 'Búsqueda de reserva segura',
      email: 'Correo electrónico',
      date: 'Fecha de salida',
      ref: 'Referencia de reserva',
      refShort: 'Referencia',
      refPlaceholder: 'p. ej. ABC12345',
      submit: 'Buscar mi reserva',
      submitShort: 'Buscar reserva',
      trust: 'Tus datos están cifrados y nunca se almacenan.',
      trustShort: 'Búsqueda segura',
      loadingTitle: 'Buscando tu reserva',
      loadingSub: 'Esto suele tardar unos segundos.',
      nfTitle: 'Reserva no encontrada',
      nfBody: 'Comprueba tu correo electrónico, la fecha de salida y la referencia de reserva. Si los datos son correctos, ponte en contacto y te ayudaremos enseguida.',
      nfRetry: 'Volver a intentar',
      nfContact: 'Contactar con soporte',
      flights: 'Vuelos',
      fareConditions: 'Condiciones de la tarifa',
      flightsLine: 'Vuelos',
      outbound: 'Ida',
      return: 'Regreso',
      whatToExpect: 'Qué esperar',
      atAGlance: 'De un vistazo',
      openingTimes: 'Horario',
      dressCode: 'Código de vestimenta',
      included: 'Incluido',
      drinks: 'Bebidas',
      food: 'Comida',
      flightAnnouncements: 'Anuncios de vuelo',
      features: 'Características',
      transfer: 'Traslado',
      transferInfo: 'Información importante',
      transfersLine: 'Traslados',
      cancellation: 'Política de cancelación',
      carHire: 'Alquiler de coche',
      carHireLine: 'Alquiler de coche',
      carHireInfo: 'Información importante',
      suppliedBy: 'Suministrado por',
      pickup: 'Recogida',
      dropoff: 'Devolución',
      payAtPickup: 'También a pagar en la recogida',
      payAtPickupNote: 'Se paga directamente en el mostrador de alquiler en la recogida. No está incluido en el coste de tu reserva indicado arriba.',
      ticket: 'Entrada',
      ticketsLine: 'Entradas',
      ticketDetails: 'Detalles',
      highlights: 'Lo más destacado',
      notIncluded: 'No incluido',
      meetingPoint: 'Punto de encuentro',
      languages: 'Idiomas',
      cancelledPill: 'Cancelada',
      cancelBtn: 'Cancelar',
      cancelSecTitle: '¿Necesitas cancelar algo?',
      cancelSecSub: 'Verás la política de cancelación y cualquier cargo antes de confirmar nada.',
      amendSecTitle: '¿Necesitas cambiar algo?',
      amendSecSub: 'Dinos qué te gustaría cambiar y lo pasaremos al equipo. Nada de tu reserva cambia hasta que lo confirmen.',
      amendOpen: 'Solicitar un cambio',
      amendFieldLabel: '¿Qué te gustaría cambiar?',
      amendPlaceholder: 'Por ejemplo un cambio de fecha, una corrección de nombre o una preferencia de habitación o asiento.',
      amendNote: 'Esto solo envía una solicitud. Nos pondremos en contacto para confirmar y tu reserva no cambiará de inmediato.',
      amendSubmit: 'Enviar solicitud',
      amendCancel: 'Cancelar',
      amendSending: 'Enviando…',
      amendRateLimited: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
      amendDoneTitle: 'Solicitud enviada',
      amendDoneBody: 'Hemos pasado tu solicitud al equipo. Aún no ha cambiado nada de tu reserva y nos pondremos en contacto para confirmar.',
      amendFailed: 'No hemos podido enviar tu solicitud ahora mismo. Inténtalo de nuevo o contáctanos.',
      payNextBtn: 'Pagar el próximo pago',
      payBalanceBtn: 'Pagar saldo',
      payConfirm: 'Pagar',
      payAmountLabel: 'Importe a pagar',
      payCancel: 'Cancelar',
      payRedirecting: 'Preparando el pago…',
      payRateLimited: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
      payNoBalance: 'No queda nada por pagar en esta reserva.',
      payFailed: 'No hemos podido iniciar el pago ahora mismo. Inténtalo de nuevo o contáctanos.',
      payTooMuch: 'Eso supera tu saldo de {amount}.',
      payTooSmall: 'El pago parcial mínimo es de {amount}.',
      payHintInstalment: 'Tu próximo pago es de {next}. Págalo o introduce otro importe de hasta {max}.',
      payHintFull: 'Paga tu saldo completo o introduce un importe menor (hasta {max}).',
      confirmed: 'Confirmada',
      atolProtected: 'ATOL Protected',
      packagedHoliday: 'Viaje combinado',
      operatedBy: 'operado por',
      yourBooking: 'Tu reserva',
      reviews: 'reseñas',
      greetingPrefix: 'Bienvenido de nuevo',
      greetingSuffix: 'tu escapada a {city} está casi aquí.',
      countdownFly: 'hasta tu vuelo',
      countdownCheckIn: 'hasta tu llegada',
      countdownTravel: 'hasta tu viaje',
      day: 'día',
      days: 'días',
      newLookup: 'Buscar otra reserva',
      actionPreview: 'Vista previa',
      actionPreviewSub: 'Ver el dosier de reserva aquí',
      actionEmail: 'Correo',
      actionEmailSub: 'Enviar a tu correo',
      actionDownload: 'Descargar',
      actionDownloadSub: 'Guarda el PDF en tu dispositivo',
      actionPrint: 'Imprimir',
      actionPrintSub: 'Abrir una copia imprimible',
      accommodation: 'Alojamiento',
      checkin: 'Entrada',
      checkout: 'Salida',
      nights: 'Noches',
      night: 'noche',
      nightsPlural: 'noches',
      week: '1 semana',
      room: 'Habitación',
      guest: 'huésped',
      guests: 'huéspedes',
      payment: 'Pago',
      hotelLine: 'Hotel',
      packageLine: 'Paquete vacacional',
      extrasLine: 'Extras de aeropuerto',
      paidSoFar: 'Pagado hasta ahora',
      balanceRemaining: 'Saldo restante',
      paymentSchedule: 'Calendario de pagos',
      payments: 'pagos',
      next: 'Próximo',
      nextDueDate: 'Próximo pago',
      paidInFull: 'Pagado en su totalidad',
      depositPaid: 'Depósito pagado',
      balanceDue: 'Saldo pendiente',
      dueDate: 'Fecha de vencimiento',
      instalmentPlan: 'Plan de pago a plazos',
      payOnArrival: 'También a pagar a la llegada',
      payOnArrivalNote: 'Se paga directamente en el hotel al hacer el check-in. No está incluido en el coste de tu viaje indicado arriba.',
      resortFee: 'Tasas del complejo',
      travelling: 'Quién viaja',
      leadGuest: 'Huésped principal',
      adult: 'Adulto',
      specialRequests: 'Peticiones especiales',
      documents: 'Tus documentos',
      thingsToKnow: 'Cosas que debes saber',
      aboutHotel: 'Sobre el hotel',
      address: 'Dirección',
      viewMap: 'Ver en el mapa',
      propertyDetails: 'Detalles del establecimiento',
      yearBuilt: 'Año de construcción',
      totalRooms: 'Total de habitaciones',
      roomMix: 'Tipos de habitación',
      facilities: 'Instalaciones',
      paymentMethods: 'Aceptados en el hotel',
      localFees: 'En el hotel',
      checkInOutTimes: 'Entrada y salida',
      goodToKnow: 'Información útil',
      helpTitle: '¿Necesitas ayuda?',
      helpBody: 'Nuestro equipo está aquí si algo de tu reserva necesita atención.',
      emailUs: 'Escríbenos',
      callUs: 'Llámanos',
      flight: 'Vuelo',
      direct: 'Directo',
      stop: 'escala',
      stops: 'escalas',
      stopoverIn: 'Escala en {iata}',
      stopoverInTimed: 'Escala de {dur} en {iata}',
      aircraft: 'Aeronave',
      thisProduct: 'este producto',
      product: 'producto',
      cancelPrefix: 'Cancelar',
      cancelLoadingSub: 'Comprobando la política de cancelación…',
      cancelLoading: 'Cargando los detalles de cancelación…',
      cancelRef: 'Referencia de reserva',
      cancelPoliciesSub: 'Revisa la política de cancelación a continuación.',
      cancelPoliciesLabel: 'Política de cancelación y cargos',
      cancelNoPolicy: 'No se han indicado cargos específicos para este producto.',
      cancelWarn: 'La cancelación no se puede deshacer. Se aplicarán los cargos indicados arriba.',
      cancelKeep: 'Mantener la reserva',
      cancelContinue: 'Continuar',
      cancelReasonTitle: 'Confirmar la cancelación',
      cancelReasonSub: 'Cuéntanos por qué cancelas (opcional).',
      cancelReasonLabel: 'Motivo de la cancelación',
      cancelReasonPlaceholder: 'p. ej. cambio de planes',
      cancelFinalWarn: 'Esto cancelará el producto y no se puede deshacer.',
      cancelBack: 'Atrás',
      cancelConfirm: 'Cancelar este producto',
      cancelConfirming: 'Cancelando…',
      cancelWorkingTitle: 'Cancelando…',
      cancelWorkingSub: 'Espera mientras lo procesamos.',
      cancelWorking: 'Cancelando tu producto…',
      cancelDoneTitle: 'Cancelación confirmada',
      cancelDoneHead: 'Listo, cancelado',
      cancelDoneBodyTmpl: 'Tu {label} ha sido cancelado.',
      cancelRefLabel: 'Referencia',
      cancelDoneBtn: 'Hecho',
      cancelErrorTitle: 'No se puede cancelar',
      cancelClose: 'Cerrar',
      emailModalTitle: 'Enviar el dosier por correo',
      emailModalSubName: 'Enviar a {name} una copia de este dosier de reserva',
      emailModalSub: 'Enviar una copia de este dosier de reserva',
      emailTo: 'Enviar a',
      emailToHelp: 'Por defecto, el correo de tu reserva. Edítalo para enviarlo a otra dirección.',
      emailCc: 'Enviar también a (opcional)',
      emailCcHelp: 'Separa varias direcciones con comas. Hasta 3.',
      emailMessage: 'Añadir un mensaje (opcional)',
      emailMessagePlaceholder: 'Una nota breve que aparecerá sobre el resumen de la reserva.',
      emailAttachment: 'Adjunto',
      emailAttachmentMeta: 'Dosier de confirmación de reserva A4',
      emailCancel: 'Cancelar',
      emailSend: 'Enviar correo',
      emailInvalidTo: 'Introduce una dirección de correo válida en el campo Enviar a.',
      emailInvalidCc: '«{email}» no parece una dirección de correo válida.',
      emailTooManyCc: 'Puedes incluir hasta 3 direcciones adicionales. Quita algunas e inténtalo de nuevo.',
      emailHolderReqd: 'El correo del titular de la reserva ({email}) debe incluirse como destinatario.',
      emailHolderReqdShort: 'El correo del titular de la reserva debe incluirse como destinatario.',
      emailSending: 'Enviando…',
      emailToastSendTitle: 'Enviando tu dosier de reserva',
      emailToastSendSub: 'Generando el PDF y enviándolo ahora.',
      emailTooMany: 'Demasiadas solicitudes de correo. Espera unos minutos e inténtalo de nuevo.',
      emailInvalidRecipients: 'Una de las direcciones de correo parece inválida. Compruébalo e inténtalo de nuevo.',
      emailInvalidMessage: 'Tu mensaje es demasiado largo. Acórtalo a menos de 1000 caracteres.',
      emailSendFailed: 'No hemos podido enviar el correo ahora mismo. Inténtalo de nuevo en un momento.',
      emailNotFound: 'No hemos encontrado esa reserva. Búscala de nuevo.',
      genericError: 'Algo salió mal. Inténtalo de nuevo en un momento.',
      emailSentTitle: 'Correo enviado',
      emailSentSub: 'El dosier de reserva va de camino a {email}.',
      emailNetworkError: 'Error de red. Comprueba tu conexión e inténtalo de nuevo.',
      pdfCannotTitle: 'No se puede generar el PDF',
      pdfLookupAgain: 'Busca tu reserva de nuevo.',
      pdfGeneratingTitle: 'Generando tu PDF',
      pdfGeneratingSub: 'Esto suele tardar unos segundos.',
      pdfTooManyTitle: 'Demasiadas solicitudes',
      pdfTooManySub: 'Espera unos minutos e inténtalo de nuevo.',
      pdfCouldntTitle: 'No hemos podido generar ese PDF',
      pdfWrongTitle: 'Algo salió mal',
      pdfTryAgainSoon: 'Inténtalo de nuevo en un momento.',
      pdfFailedTitle: 'Generación fallida',
      pdfCheckConnection: 'Comprueba tu conexión e inténtalo de nuevo.',
      pdfDownloadedTitle: 'PDF descargado',
      pdfPopupTitle: 'Permite las ventanas emergentes para imprimir',
      pdfPopupSub: 'O usa Descargar y luego imprime el PDF guardado.',
      fillAllFields: 'Por favor, rellena los tres campos.',
      notConfigured: 'Este widget aún no está configurado. Ponte en contacto con soporte.',
      tooManyAttempts: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
      somethingWrong: 'Algo salió mal.',
      ariaClose: 'Cerrar',
      ariaViewImage: 'Ver imagen {n}',
      totalCost: 'Coste total',
      totalHoliday: 'Coste total del viaje',
      totalFlights: 'Coste total de los vuelos',
      totalExtras: 'Coste total',
      totalTickets: 'Coste total de las entradas',
      totalCarHire: 'Coste total del alquiler de coche',
      totalTransfer: 'Coste total del traslado',
      totalInsurance: 'Coste total del seguro',
    },
    it: {
      title: 'La mia prenotazione',
      subtitle: 'Bentornato. Inserisci i tuoi dati per vedere tutto sul tuo prossimo viaggio.',
      subtitleShort: 'Trova il tuo viaggio in pochi secondi',
      eyebrow: 'Ricerca prenotazione sicura',
      email: 'Indirizzo email',
      date: 'Data di partenza',
      ref: 'Riferimento prenotazione',
      refShort: 'Riferimento',
      refPlaceholder: 'es. ABC12345',
      submit: 'Trova la mia prenotazione',
      submitShort: 'Trova prenotazione',
      trust: 'I tuoi dati sono crittografati e mai memorizzati.',
      trustShort: 'Ricerca sicura',
      loadingTitle: 'Ricerca della tua prenotazione',
      loadingSub: 'Di solito ci vogliono pochi secondi.',
      nfTitle: 'Prenotazione non trovata',
      nfBody: 'Controlla il tuo indirizzo email, la data di partenza e il riferimento della prenotazione. Se i dati sono corretti, contattaci e ti aiuteremo subito.',
      nfRetry: 'Riprova',
      nfContact: 'Contatta l\'assistenza',
      flights: 'Voli',
      fareConditions: 'Condizioni tariffarie',
      flightsLine: 'Voli',
      outbound: 'Andata',
      return: 'Ritorno',
      whatToExpect: 'Cosa aspettarsi',
      atAGlance: 'In breve',
      openingTimes: 'Orari di apertura',
      dressCode: 'Codice di abbigliamento',
      included: 'Incluso',
      drinks: 'Bevande',
      food: 'Cibo',
      flightAnnouncements: 'Annunci di volo',
      features: 'Caratteristiche',
      transfer: 'Trasferimento',
      transferInfo: 'Informazioni importanti',
      transfersLine: 'Trasferimenti',
      cancellation: 'Politica di cancellazione',
      carHire: 'Noleggio auto',
      carHireLine: 'Noleggio auto',
      carHireInfo: 'Informazioni importanti',
      suppliedBy: 'Fornito da',
      pickup: 'Ritiro',
      dropoff: 'Riconsegna',
      payAtPickup: 'Da pagare anche al ritiro',
      payAtPickupNote: 'Da pagare direttamente al banco del noleggio al ritiro. Non incluso nel costo della prenotazione sopra.',
      ticket: 'Biglietto',
      ticketsLine: 'Biglietti',
      ticketDetails: 'Dettagli',
      highlights: 'In evidenza',
      notIncluded: 'Non incluso',
      meetingPoint: 'Punto d\'incontro',
      languages: 'Lingue',
      cancelledPill: 'Annullata',
      cancelBtn: 'Annulla',
      cancelSecTitle: 'Devi annullare qualcosa?',
      cancelSecSub: 'Vedrai la politica di cancellazione ed eventuali costi prima di confermare qualsiasi cosa.',
      amendSecTitle: 'Devi modificare qualcosa?',
      amendSecSub: 'Dicci cosa vorresti modificare e lo gireremo al team. Nulla della tua prenotazione cambia finché non lo confermano.',
      amendOpen: 'Richiedi una modifica',
      amendFieldLabel: 'Cosa vorresti modificare?',
      amendPlaceholder: 'Per esempio un cambio di data, una correzione del nome o una preferenza di camera o posto.',
      amendNote: 'Questo invia solo una richiesta. Ti contatteremo per confermare e la tua prenotazione non cambierà subito.',
      amendSubmit: 'Invia richiesta',
      amendCancel: 'Annulla',
      amendSending: 'Invio…',
      amendRateLimited: 'Troppi tentativi. Attendi qualche minuto e riprova.',
      amendDoneTitle: 'Richiesta inviata',
      amendDoneBody: 'Abbiamo inoltrato la tua richiesta al team. Nulla della tua prenotazione è ancora cambiato e ti contatteremo per confermare.',
      amendFailed: 'Non siamo riusciti a inviare la tua richiesta in questo momento. Riprova o contattaci.',
      payNextBtn: 'Paga la prossima rata',
      payBalanceBtn: 'Paga il saldo',
      payConfirm: 'Paga',
      payAmountLabel: 'Importo da pagare',
      payCancel: 'Annulla',
      payRedirecting: 'Preparazione del pagamento…',
      payRateLimited: 'Troppi tentativi. Attendi qualche minuto e riprova.',
      payNoBalance: 'Non c\'è più nulla da pagare su questa prenotazione.',
      payFailed: 'Non siamo riusciti ad avviare il pagamento in questo momento. Riprova o contattaci.',
      payTooMuch: 'È più del tuo saldo di {amount}.',
      payTooSmall: 'Il pagamento parziale minimo è di {amount}.',
      payHintInstalment: 'Il tuo prossimo pagamento è di {next}. Pagalo o inserisci un importo diverso fino a {max}.',
      payHintFull: 'Paga il saldo per intero o inserisci un importo inferiore (fino a {max}).',
      confirmed: 'Confermata',
      atolProtected: 'ATOL Protected',
      packagedHoliday: 'Vacanza tutto incluso',
      operatedBy: 'operato da',
      yourBooking: 'La tua prenotazione',
      reviews: 'recensioni',
      greetingPrefix: 'Bentornato',
      greetingSuffix: 'la tua fuga a {city} è ormai vicina.',
      countdownFly: 'al tuo volo',
      countdownCheckIn: 'al check-in',
      countdownTravel: 'alla partenza',
      day: 'giorno',
      days: 'giorni',
      newLookup: 'Cerca un\'altra prenotazione',
      actionPreview: 'Anteprima',
      actionPreviewSub: 'Visualizza il pacchetto di prenotazione qui',
      actionEmail: 'Email',
      actionEmailSub: 'Invia alla tua casella',
      actionDownload: 'Scarica',
      actionDownloadSub: 'Salva il PDF sul tuo dispositivo',
      actionPrint: 'Stampa',
      actionPrintSub: 'Apri una copia stampabile',
      accommodation: 'Alloggio',
      checkin: 'Check-in',
      checkout: 'Check-out',
      nights: 'Notti',
      night: 'notte',
      nightsPlural: 'notti',
      week: '1 settimana',
      room: 'Camera',
      guest: 'ospite',
      guests: 'ospiti',
      payment: 'Pagamento',
      hotelLine: 'Hotel',
      packageLine: 'Pacchetto vacanza',
      extrasLine: 'Extra aeroporto',
      paidSoFar: 'Pagato finora',
      balanceRemaining: 'Saldo residuo',
      paymentSchedule: 'Piano dei pagamenti',
      payments: 'pagamenti',
      next: 'Prossimo',
      nextDueDate: 'Prossimo pagamento',
      paidInFull: 'Pagato per intero',
      depositPaid: 'Acconto versato',
      balanceDue: 'Saldo dovuto',
      dueDate: 'Data di scadenza',
      instalmentPlan: 'Piano rateale',
      payOnArrival: 'Da pagare anche all\'arrivo',
      payOnArrivalNote: 'Da pagare direttamente in hotel al check-in. Non incluso nel costo della vacanza sopra.',
      resortFee: 'Tasse del resort',
      travelling: 'Chi viaggia',
      leadGuest: 'Ospite principale',
      adult: 'Adulto',
      specialRequests: 'Richieste speciali',
      documents: 'I tuoi documenti',
      thingsToKnow: 'Cose da sapere',
      aboutHotel: 'Informazioni sull\'hotel',
      address: 'Indirizzo',
      viewMap: 'Vedi sulla mappa',
      propertyDetails: 'Dettagli della struttura',
      yearBuilt: 'Anno di costruzione',
      totalRooms: 'Numero di camere',
      roomMix: 'Tipi di camera',
      facilities: 'Servizi',
      paymentMethods: 'Accettati in hotel',
      localFees: 'In hotel',
      checkInOutTimes: 'Check-in e check-out',
      goodToKnow: 'Buono a sapersi',
      helpTitle: 'Hai bisogno di aiuto?',
      helpBody: 'Il nostro team è qui se qualcosa nella tua prenotazione richiede attenzione.',
      emailUs: 'Scrivici',
      callUs: 'Chiamaci',
      flight: 'Volo',
      direct: 'Diretto',
      stop: 'scalo',
      stops: 'scali',
      stopoverIn: 'Scalo a {iata}',
      stopoverInTimed: 'Scalo di {dur} a {iata}',
      aircraft: 'Aeromobile',
      thisProduct: 'questo prodotto',
      product: 'prodotto',
      cancelPrefix: 'Annulla',
      cancelLoadingSub: 'Verifica della politica di cancellazione…',
      cancelLoading: 'Caricamento dei dettagli di cancellazione…',
      cancelRef: 'Riferimento prenotazione',
      cancelPoliciesSub: 'Consulta la politica di cancellazione qui sotto.',
      cancelPoliciesLabel: 'Politica di cancellazione e costi',
      cancelNoPolicy: 'Nessun costo specifico è stato indicato per questo prodotto.',
      cancelWarn: 'La cancellazione non può essere annullata. Si applicheranno gli eventuali costi sopra indicati.',
      cancelKeep: 'Mantieni la prenotazione',
      cancelContinue: 'Continua',
      cancelReasonTitle: 'Conferma la cancellazione',
      cancelReasonSub: 'Facci sapere perché annulli (facoltativo).',
      cancelReasonLabel: 'Motivo della cancellazione',
      cancelReasonPlaceholder: 'es. cambio di programma',
      cancelFinalWarn: 'Questo annullerà il prodotto e non può essere annullato.',
      cancelBack: 'Indietro',
      cancelConfirm: 'Annulla questo prodotto',
      cancelConfirming: 'Annullamento…',
      cancelWorkingTitle: 'Annullamento…',
      cancelWorkingSub: 'Attendi mentre elaboriamo la richiesta.',
      cancelWorking: 'Annullamento del tuo prodotto…',
      cancelDoneTitle: 'Cancellazione confermata',
      cancelDoneHead: 'Fatto, annullato',
      cancelDoneBodyTmpl: 'Il tuo {label} è stato annullato.',
      cancelRefLabel: 'Riferimento',
      cancelDoneBtn: 'Fatto',
      cancelErrorTitle: 'Impossibile annullare',
      cancelClose: 'Chiudi',
      emailModalTitle: 'Invia il pacchetto via email',
      emailModalSubName: 'Invia a {name} una copia di questo pacchetto di prenotazione',
      emailModalSub: 'Invia una copia di questo pacchetto di prenotazione',
      emailTo: 'Invia a',
      emailToHelp: 'Per impostazione predefinita, l\'email della tua prenotazione. Modifica per inviare a un altro indirizzo.',
      emailCc: 'Invia anche a (facoltativo)',
      emailCcHelp: 'Separa più indirizzi con le virgole. Fino a 3.',
      emailMessage: 'Aggiungi un messaggio (facoltativo)',
      emailMessagePlaceholder: 'Una breve nota che apparirà sopra il riepilogo della prenotazione.',
      emailAttachment: 'Allegato',
      emailAttachmentMeta: 'Pacchetto di conferma prenotazione A4',
      emailCancel: 'Annulla',
      emailSend: 'Invia email',
      emailInvalidTo: 'Inserisci un indirizzo email valido nel campo Invia a.',
      emailInvalidCc: '"{email}" non sembra un indirizzo email valido.',
      emailTooManyCc: 'Puoi includere fino a 3 indirizzi aggiuntivi. Rimuovine alcuni e riprova.',
      emailHolderReqd: 'L\'email dell\'intestatario della prenotazione ({email}) deve essere incluso tra i destinatari.',
      emailHolderReqdShort: 'L\'email dell\'intestatario della prenotazione deve essere incluso tra i destinatari.',
      emailSending: 'Invio…',
      emailToastSendTitle: 'Invio del tuo pacchetto di prenotazione',
      emailToastSendSub: 'Generazione del PDF e invio in corso.',
      emailTooMany: 'Troppe richieste email. Attendi qualche minuto e riprova.',
      emailInvalidRecipients: 'Uno degli indirizzi email sembra non valido. Controlla e riprova.',
      emailInvalidMessage: 'Il tuo messaggio è troppo lungo. Riducilo a meno di 1000 caratteri.',
      emailSendFailed: 'Non siamo riusciti a inviare l\'email in questo momento. Riprova tra poco.',
      emailNotFound: 'Prenotazione non trovata. Cercala di nuovo.',
      genericError: 'Qualcosa è andato storto. Riprova tra poco.',
      emailSentTitle: 'Email inviata',
      emailSentSub: 'Il pacchetto di prenotazione è in arrivo a {email}.',
      emailNetworkError: 'Errore di rete. Controlla la connessione e riprova.',
      pdfCannotTitle: 'Impossibile generare il PDF',
      pdfLookupAgain: 'Cerca di nuovo la tua prenotazione.',
      pdfGeneratingTitle: 'Generazione del tuo PDF',
      pdfGeneratingSub: 'Di solito ci vogliono pochi secondi.',
      pdfTooManyTitle: 'Troppe richieste',
      pdfTooManySub: 'Attendi qualche minuto e riprova.',
      pdfCouldntTitle: 'Non siamo riusciti a generare quel PDF',
      pdfWrongTitle: 'Qualcosa è andato storto',
      pdfTryAgainSoon: 'Riprova tra poco.',
      pdfFailedTitle: 'Generazione non riuscita',
      pdfCheckConnection: 'Controlla la connessione e riprova.',
      pdfDownloadedTitle: 'PDF scaricato',
      pdfPopupTitle: 'Consenti i pop-up per stampare',
      pdfPopupSub: 'Oppure usa Scarica e poi stampa il PDF salvato.',
      fillAllFields: 'Compila tutti e tre i campi.',
      notConfigured: 'Questo widget non è ancora configurato. Contatta l\'assistenza.',
      tooManyAttempts: 'Troppi tentativi. Attendi qualche minuto e riprova.',
      somethingWrong: 'Qualcosa è andato storto.',
      ariaClose: 'Chiudi',
      ariaViewImage: 'Vedi immagine {n}',
      totalCost: 'Costo totale',
      totalHoliday: 'Costo totale della vacanza',
      totalFlights: 'Costo totale dei voli',
      totalExtras: 'Costo totale',
      totalTickets: 'Costo totale dei biglietti',
      totalCarHire: 'Costo totale del noleggio auto',
      totalTransfer: 'Costo totale del trasferimento',
      totalInsurance: 'Costo totale dell\'assicurazione',
    },
    ro: {
      title: 'Rezervarea mea',
      subtitle: 'Bine ai revenit. Introdu datele tale pentru a vedea totul despre următoarea ta călătorie.',
      subtitleShort: 'Găsește-ți călătoria în câteva secunde',
      eyebrow: 'Căutare securizată a rezervării',
      email: 'Adresă de e-mail',
      date: 'Data plecării',
      ref: 'Referință rezervare',
      refShort: 'Referință',
      refPlaceholder: 'ex. ABC12345',
      submit: 'Găsește rezervarea mea',
      submitShort: 'Găsește rezervarea',
      trust: 'Datele tale sunt criptate și nu sunt stocate niciodată.',
      trustShort: 'Căutare securizată',
      loadingTitle: 'Căutăm rezervarea ta',
      loadingSub: 'De obicei durează câteva secunde.',
      nfTitle: 'Rezervarea nu a fost găsită',
      nfBody: 'Verifică adresa de e-mail, data plecării și referința rezervării. Dacă datele sunt corecte, contactează-ne și te vom ajuta imediat.',
      nfRetry: 'Încearcă din nou',
      nfContact: 'Contactează asistența',
      flights: 'Zboruri',
      fareConditions: 'Condiții tarifare',
      flightsLine: 'Zboruri',
      outbound: 'Dus',
      return: 'Întoarcere',
      whatToExpect: 'La ce să te aștepți',
      atAGlance: 'Pe scurt',
      openingTimes: 'Program',
      dressCode: 'Cod vestimentar',
      included: 'Inclus',
      drinks: 'Băuturi',
      food: 'Mâncare',
      flightAnnouncements: 'Anunțuri de zbor',
      features: 'Caracteristici',
      transfer: 'Transfer',
      transferInfo: 'Informații importante',
      transfersLine: 'Transferuri',
      cancellation: 'Politica de anulare',
      carHire: 'Închiriere mașină',
      carHireLine: 'Închiriere mașină',
      carHireInfo: 'Informații importante',
      suppliedBy: 'Furnizat de',
      pickup: 'Preluare',
      dropoff: 'Returnare',
      payAtPickup: 'De plătit și la preluare',
      payAtPickupNote: 'Se plătește direct la ghișeul de închiriere la preluare. Nu este inclus în costul rezervării de mai sus.',
      ticket: 'Bilet',
      ticketsLine: 'Bilete',
      ticketDetails: 'Detalii',
      highlights: 'Puncte forte',
      notIncluded: 'Neinclus',
      meetingPoint: 'Punct de întâlnire',
      languages: 'Limbi',
      cancelledPill: 'Anulată',
      cancelBtn: 'Anulează',
      cancelSecTitle: 'Trebuie să anulezi ceva?',
      cancelSecSub: 'Vei vedea politica de anulare și eventualele taxe înainte ca ceva să fie confirmat.',
      amendSecTitle: 'Trebuie să modifici ceva?',
      amendSecSub: 'Spune-ne ce ai dori să modifici și vom transmite echipei. Nimic din rezervarea ta nu se schimbă până nu confirmă.',
      amendOpen: 'Solicită o modificare',
      amendFieldLabel: 'Ce ai dori să modifici?',
      amendPlaceholder: 'De exemplu o schimbare de dată, o corecție de nume sau o preferință de cameră ori loc.',
      amendNote: 'Acest lucru trimite doar o cerere. Te vom contacta pentru confirmare, iar rezervarea ta nu se va schimba imediat.',
      amendSubmit: 'Trimite cererea',
      amendCancel: 'Anulează',
      amendSending: 'Se trimite…',
      amendRateLimited: 'Prea multe încercări. Așteaptă câteva minute și încearcă din nou.',
      amendDoneTitle: 'Cerere trimisă',
      amendDoneBody: 'Am transmis cererea ta echipei. Nimic din rezervarea ta nu s-a schimbat încă și te vom contacta pentru confirmare.',
      amendFailed: 'Nu am putut trimite cererea ta acum. Încearcă din nou sau contactează-ne.',
      payNextBtn: 'Plătește următoarea rată',
      payBalanceBtn: 'Plătește soldul',
      payConfirm: 'Plătește',
      payAmountLabel: 'Sumă de plată',
      payCancel: 'Anulează',
      payRedirecting: 'Se pregătește plata…',
      payRateLimited: 'Prea multe încercări. Așteaptă câteva minute și încearcă din nou.',
      payNoBalance: 'Nu mai este nimic de plătit pentru această rezervare.',
      payFailed: 'Nu am putut începe plata acum. Încearcă din nou sau contactează-ne.',
      payTooMuch: 'Aceasta depășește soldul tău de {amount}.',
      payTooSmall: 'Plata parțială minimă este de {amount}.',
      payHintInstalment: 'Următoarea ta plată este {next}. Plătește-o sau introdu o altă sumă până la {max}.',
      payHintFull: 'Plătește soldul integral sau introdu o sumă mai mică (până la {max}).',
      confirmed: 'Confirmată',
      atolProtected: 'ATOL Protected',
      packagedHoliday: 'Pachet de vacanță',
      operatedBy: 'operat de',
      yourBooking: 'Rezervarea ta',
      reviews: 'recenzii',
      greetingPrefix: 'Bine ai revenit',
      greetingSuffix: 'escapada ta la {city} este aproape aici.',
      countdownFly: 'până la zbor',
      countdownCheckIn: 'până la check-in',
      countdownTravel: 'până la plecare',
      day: 'zi',
      days: 'zile',
      newLookup: 'Caută altă rezervare',
      actionPreview: 'Previzualizare',
      actionPreviewSub: 'Vezi dosarul rezervării aici',
      actionEmail: 'E-mail',
      actionEmailSub: 'Trimite în căsuța ta',
      actionDownload: 'Descarcă',
      actionDownloadSub: 'Salvează PDF-ul pe dispozitiv',
      actionPrint: 'Printează',
      actionPrintSub: 'Deschide o copie printabilă',
      accommodation: 'Cazare',
      checkin: 'Check-in',
      checkout: 'Check-out',
      nights: 'Nopți',
      night: 'noapte',
      nightsPlural: 'nopți',
      week: '1 săptămână',
      room: 'Cameră',
      guest: 'oaspete',
      guests: 'oaspeți',
      payment: 'Plată',
      hotelLine: 'Hotel',
      packageLine: 'Pachet de vacanță',
      extrasLine: 'Extra aeroport',
      paidSoFar: 'Plătit până acum',
      balanceRemaining: 'Sold rămas',
      paymentSchedule: 'Calendar de plăți',
      payments: 'plăți',
      next: 'Următor',
      nextDueDate: 'Următoarea plată',
      paidInFull: 'Plătit integral',
      depositPaid: 'Avans plătit',
      balanceDue: 'Sold de plată',
      dueDate: 'Data scadentă',
      instalmentPlan: 'Plan de rate',
      payOnArrival: 'De plătit și la sosire',
      payOnArrivalNote: 'Se plătește direct la hotel la check-in. Nu este inclus în costul vacanței de mai sus.',
      resortFee: 'Taxe de stațiune',
      travelling: 'Cine călătorește',
      leadGuest: 'Oaspete principal',
      adult: 'Adult',
      specialRequests: 'Cereri speciale',
      documents: 'Documentele tale',
      thingsToKnow: 'Lucruri de știut',
      aboutHotel: 'Despre hotel',
      address: 'Adresă',
      viewMap: 'Vezi pe hartă',
      propertyDetails: 'Detalii proprietate',
      yearBuilt: 'Anul construcției',
      totalRooms: 'Total camere',
      roomMix: 'Tipuri de camere',
      facilities: 'Facilități',
      paymentMethods: 'Acceptate la hotel',
      localFees: 'La hotel',
      checkInOutTimes: 'Check-in și check-out',
      goodToKnow: 'Bine de știut',
      helpTitle: 'Ai nevoie de ajutor?',
      helpBody: 'Echipa noastră este aici dacă ceva legat de rezervarea ta necesită atenție.',
      emailUs: 'Scrie-ne',
      callUs: 'Sună-ne',
      flight: 'Zbor',
      direct: 'Direct',
      stop: 'escală',
      stops: 'escale',
      stopoverIn: 'Escală în {iata}',
      stopoverInTimed: 'Escală de {dur} în {iata}',
      aircraft: 'Aeronavă',
      thisProduct: 'acest produs',
      product: 'produs',
      cancelPrefix: 'Anulează',
      cancelLoadingSub: 'Se verifică politica de anulare…',
      cancelLoading: 'Se încarcă detaliile de anulare…',
      cancelRef: 'Referință rezervare',
      cancelPoliciesSub: 'Te rugăm să consulți politica de anulare de mai jos.',
      cancelPoliciesLabel: 'Politica de anulare și taxe',
      cancelNoPolicy: 'Nu au fost returnate taxe specifice pentru acest produs.',
      cancelWarn: 'Anularea nu poate fi anulată. Se vor aplica taxele de mai sus.',
      cancelKeep: 'Păstrează rezervarea',
      cancelContinue: 'Continuă',
      cancelReasonTitle: 'Confirmă anularea',
      cancelReasonSub: 'Spune-ne de ce anulezi (opțional).',
      cancelReasonLabel: 'Motivul anulării',
      cancelReasonPlaceholder: 'ex. schimbarea planurilor',
      cancelFinalWarn: 'Aceasta va anula produsul și nu poate fi anulată.',
      cancelBack: 'Înapoi',
      cancelConfirm: 'Anulează acest produs',
      cancelConfirming: 'Se anulează…',
      cancelWorkingTitle: 'Se anulează…',
      cancelWorkingSub: 'Te rugăm să aștepți cât procesăm.',
      cancelWorking: 'Se anulează produsul tău…',
      cancelDoneTitle: 'Anulare confirmată',
      cancelDoneHead: 'Gata, anulat',
      cancelDoneBodyTmpl: '{label} a fost anulat.',
      cancelRefLabel: 'Referință',
      cancelDoneBtn: 'Gata',
      cancelErrorTitle: 'Nu se poate anula',
      cancelClose: 'Închide',
      emailModalTitle: 'Trimite dosarul pe e-mail',
      emailModalSubName: 'Trimite-i lui {name} o copie a acestui dosar de rezervare',
      emailModalSub: 'Trimite o copie a acestui dosar de rezervare',
      emailTo: 'Trimite către',
      emailToHelp: 'Implicit, e-mailul din rezervarea ta. Modifică pentru a trimite la altă adresă.',
      emailCc: 'Trimite și către (opțional)',
      emailCcHelp: 'Separă mai multe adrese cu virgule. Până la 3.',
      emailMessage: 'Adaugă un mesaj (opțional)',
      emailMessagePlaceholder: 'O notă scurtă care va apărea deasupra rezumatului rezervării.',
      emailAttachment: 'Atașament',
      emailAttachmentMeta: 'Dosar de confirmare a rezervării A4',
      emailCancel: 'Anulează',
      emailSend: 'Trimite e-mailul',
      emailInvalidTo: 'Introdu o adresă de e-mail validă în câmpul Trimite către.',
      emailInvalidCc: '„{email}" nu pare o adresă de e-mail validă.',
      emailTooManyCc: 'Poți include până la 3 adrese suplimentare. Elimină câteva și încearcă din nou.',
      emailHolderReqd: 'E-mailul titularului rezervării ({email}) trebuie inclus ca destinatar.',
      emailHolderReqdShort: 'E-mailul titularului rezervării trebuie inclus ca destinatar.',
      emailSending: 'Se trimite…',
      emailToastSendTitle: 'Se trimite dosarul tău de rezervare',
      emailToastSendSub: 'Se generează PDF-ul și se trimite acum.',
      emailTooMany: 'Prea multe cereri de e-mail. Așteaptă câteva minute și încearcă din nou.',
      emailInvalidRecipients: 'Una dintre adresele de e-mail pare invalidă. Verifică și încearcă din nou.',
      emailInvalidMessage: 'Mesajul tău este prea lung. Scurtează-l la sub 1000 de caractere.',
      emailSendFailed: 'Nu am putut trimite e-mailul acum. Încearcă din nou în câteva momente.',
      emailNotFound: 'Rezervarea nu a fost găsită. Caut-o din nou.',
      genericError: 'Ceva nu a funcționat. Încearcă din nou în câteva momente.',
      emailSentTitle: 'E-mail trimis',
      emailSentSub: 'Dosarul de rezervare este pe drum către {email}.',
      emailNetworkError: 'Eroare de rețea. Verifică conexiunea și încearcă din nou.',
      pdfCannotTitle: 'Nu se poate genera PDF-ul',
      pdfLookupAgain: 'Caută rezervarea din nou.',
      pdfGeneratingTitle: 'Se generează PDF-ul tău',
      pdfGeneratingSub: 'De obicei durează câteva secunde.',
      pdfTooManyTitle: 'Prea multe cereri',
      pdfTooManySub: 'Așteaptă câteva minute și încearcă din nou.',
      pdfCouldntTitle: 'Nu am putut genera acel PDF',
      pdfWrongTitle: 'Ceva nu a funcționat',
      pdfTryAgainSoon: 'Încearcă din nou în câteva momente.',
      pdfFailedTitle: 'Generare eșuată',
      pdfCheckConnection: 'Verifică conexiunea și încearcă din nou.',
      pdfDownloadedTitle: 'PDF descărcat',
      pdfPopupTitle: 'Permite ferestrele pop-up pentru a printa',
      pdfPopupSub: 'Sau folosește Descarcă, apoi printează PDF-ul salvat.',
      fillAllFields: 'Te rugăm să completezi toate cele trei câmpuri.',
      notConfigured: 'Acest widget nu este încă configurat. Contactează asistența.',
      tooManyAttempts: 'Prea multe încercări. Așteaptă câteva minute și încearcă din nou.',
      somethingWrong: 'Ceva nu a funcționat.',
      ariaClose: 'Închide',
      ariaViewImage: 'Vezi imaginea {n}',
      totalCost: 'Cost total',
      totalHoliday: 'Cost total vacanță',
      totalFlights: 'Cost total zboruri',
      totalExtras: 'Cost total',
      totalTickets: 'Cost total bilete',
      totalCarHire: 'Cost total închiriere mașină',
      totalTransfer: 'Cost total transfer',
      totalInsurance: 'Cost total asigurare',
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


  // ----- Inline SVG icons -----
  const IC = {
    mail:    'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6L12 13 2 6',
    cal:     'M3 4h18v18H3zM3 10h18M16 2v6M8 2v6',
    pin:     'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    arrow:   'M5 12h14M12 5l7 7-7 7',
    shield:  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    check:   'M20 6L9 17 4 12',
    chev:    'M6 9l6 6 6-6',
    moon:    'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    user:    'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    users:   'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    card:    'M2 5h20v14H2zM2 10h20',
    file:    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
    dl:      'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    print:   'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
    edit:    'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
    send:    'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
    home:    'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    info:    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01',
    coin:    'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    search:  'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    clock:   'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    phone:   'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7a2 2 0 0 1 1.72 2z',
    booking: 'M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M3 5h18v14H3z',
    ref:     'M3 3h18v18H3zM9 9h6M9 13h6M9 17h4',
    refresh: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-7.07 3M3 4v5h5',
    alert:   'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
    plane:   'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
    bag:     'M16 3h-1V1h-2v2H7V1H5v2H4a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM4 8h12v12H4V8z',
    bed:     'M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M12 4v6M2 18h20',
    lounge:  'M19 7v3.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 10.5V7M3 21V11a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10M3 17h18',
    arrowR:  'M5 12h14M13 5l7 7-7 7',
    leaf:    'M11 20A7 7 0 0 1 4 13c0-2 1-4 3-6 1-1 2-3 4-5l1 4c2-1 4 1 5 3 1 3 0 5-1 6-2 2-4 5-5 5z',
    eye:     'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    x:       'M18 6L6 18M6 6l12 12',
    car:     'M3 17h2l1 4h12l1-4h2v-7l-2-5H5L3 10zM7 17v2M17 17v2M5 14h14',
    van:     'M3 17h18M3 17V8a1 1 0 0 1 1-1h11l4 5h1a1 1 0 0 1 1 1v4M7 17v2M17 17v2M15 7v5h5',
    ticket:  'M3 7v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2zM13 5v14',
  };
  function svg(p, sw, size) {
    sw = sw || 2;
    const s = size || 20;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p.split(/(?=M)/).map(d => '<path d="' + d + '"/>').join('') + '</svg>';
  }
  function star() {
    return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><polygon points="12 2 15 9 22 9.3 17 14 18.5 21 12 17.5 5.5 21 7 14 2 9.3 9 9 12 2"/></svg>';
  }

  // ----- Helpers -----
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // The theme overrides are assembled into the root style attribute, so author
  // colours and font must be validated (can't add declarations or break out) and
  // the attribute is esc()'d at injection.
  function safeColorM(v, fb) {
    const s = String(v == null ? '' : v).trim();
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
    if (/^rgba?\([0-9.,\s%]+\)$/i.test(s)) return s;
    if (/^hsla?\([0-9.,\s%deg]+\)$/i.test(s)) return s;
    if (/^[a-z]{3,20}$/i.test(s)) return s;
    return fb;
  }
  function safeFontStackM(v, fb) {
    const s = String(v == null ? '' : v).trim();
    return (s && s.length <= 120 && /^[A-Za-z0-9 ,"'-]+$/.test(s)) ? s : fb;
  }
  function ensureFont(family) {
    if (!family || family === 'Inter' || typeof document === 'undefined') return;
    const id = 'tg-font-' + String(family).toLowerCase().replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':ital,wght@0,400;0,500;0,600;1,400&display=swap';
    document.head.appendChild(l);
  }
  function fmtMoney(amount, currency) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
    const cur = currency || 'GBP';
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(amount);
    } catch {
      return '£' + amount.toFixed(2);
    }
  }

  /**
   * Decide what the Total line should be called based on what's in the order.
   *
   * Tiered logic, in order of precedence:
   *   1. Accommodation present       → "Total holiday cost"
   *      (Anything with a hotel is a holiday, regardless of what else is bundled.
   *      Package Holidays from Travelify also fall here when they include an
   *      Accommodation item.)
   *   2. Flights present (no hotel)  → "Total flight cost"
   *      (Flights anchor the booking even when bundled with extras.)
   *   3. Single dominant product     → product-specific label
   *      (One product type only — call it what it is.)
   *   4. Mixed extras / unknown      → "Total cost"
   *      (Generic fallback. Always correct even if Travelify adds new
   *      product types we haven't seen yet.)
   *
   * Labels are also exposed through c.labels so an agency can override
   * any of them in their widget config.
   */
  function resolveTotalLabel(items, c) {
    const labels = c?.labels || {};
    if (!Array.isArray(items) || items.length === 0) {
      return labels.totalCost || (c && c.t ? c.t('totalCost') : 'Total cost');
    }

    const products = new Set(items.map(i => i?.product).filter(Boolean));

    // Holiday tier: anything with accommodation OR a package counts as a
    // holiday. ATOL package bookings (Jet2 Holidays, EveryHoliday, TUI etc)
    // are sold as a single 'Packages' item that bundles hotel + flights;
    // from the customer's POV that's just a holiday.
    if (products.has('Accommodation') || products.has('Packages')) {
      return labels.totalHoliday || labels.totalCost || (c && c.t ? c.t('totalHoliday') : 'Total holiday cost');
    }
    if (products.has('Flights')) {
      return labels.totalFlights || (c && c.t ? c.t('totalFlights') : 'Total flight cost');
    }
    // No hotel, no flights — single-product case.
    if (products.size === 1) {
      const only = products.values().next().value;
      // Map of known single-product labels. Anything not listed falls
      // through to the generic "Total cost".
      const singleProductMap = {
        AirportExtras:       labels.totalExtras || (c && c.t ? c.t('totalExtras') : 'Total cost'),
        TicketsAttractions:  labels.totalTickets || (c && c.t ? c.t('totalTickets') : 'Total ticket cost'),
        Tickets:             labels.totalTickets || (c && c.t ? c.t('totalTickets') : 'Total ticket cost'),
        Ticket:              labels.totalTickets || (c && c.t ? c.t('totalTickets') : 'Total ticket cost'),
        CarRental:           labels.totalCarHire || (c && c.t ? c.t('totalCarHire') : 'Total car hire cost'),
        CarHire:             labels.totalCarHire || (c && c.t ? c.t('totalCarHire') : 'Total car hire cost'),
        Transfers:           labels.totalTransfer || (c && c.t ? c.t('totalTransfer') : 'Total transfer cost'),
        Transfer:            labels.totalTransfer || (c && c.t ? c.t('totalTransfer') : 'Total transfer cost'),
        Insurance:           labels.totalInsurance || (c && c.t ? c.t('totalInsurance') : 'Total insurance cost'),
      };
      return singleProductMap[only] || labels.totalCost || (c && c.t ? c.t('totalCost') : 'Total cost');
    }
    return labels.totalCost || (c && c.t ? c.t('totalCost') : 'Total cost');
  }
  function fmtDate(iso, opts) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDayMonth(iso) {
    return fmtDate(iso, { day: 'numeric', month: 'short' });
  }
  function fmtWeekday(iso) {
    return fmtDate(iso, { weekday: 'short' });
  }
  function fmtYear(iso) {
    return fmtDate(iso, { year: 'numeric' });
  }
  function daysUntil(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const ms = d.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }
  // Travelify returns board basis as a machine enum (e.g. "BedAndBreakfast",
  // "AllInclusive"). Strict whitelist of known values mapped to readable
  // labels — anything not in the list falls back to the raw string so we
  // never silently lose information. Never invent a value when the supplier
  // returned nothing or returned "Unknown".
  const BOARD_LABELS = {
    'RoomOnly':        'Room only',
    'SelfCatering':    'Self catering',
    'BedAndBreakfast': 'Bed & breakfast',
    'HalfBoard':       'Half board',
    'HalfBoardPlus':   'Half board plus',
    'FullBoard':       'Full board',
    'FullBoardPlus':   'Full board plus',
    'AllInclusive':    'All inclusive',
    'AllInclusivePlus':'All inclusive plus',
    'UltraAllInclusive':'Ultra all inclusive',
  };
  function fmtBoard(raw) {
    if (typeof raw !== 'string') return null;
    const v = raw.trim();
    if (!v || v.toLowerCase() === 'unknown') return null;
    if (Object.prototype.hasOwnProperty.call(BOARD_LABELS, v)) return BOARD_LABELS[v];
    return v; // fall back to raw rather than invent a value
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }
  function fmtDuration(mins) {
    if (typeof mins !== 'number' || !Number.isFinite(mins) || mins <= 0) return '';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h && m) return h + 'h ' + m + 'm';
    if (h) return h + 'h';
    return m + 'm';
  }
  function initials(first, last) {
    const a = (first || '').trim();
    const b = (last || '').trim();
    return ((a[0] || '') + (b[0] || '')).toUpperCase() || '?';
  }
  function fileIconForExt(ext) {
    return svg(IC.file);
  }
  function fmtFileSize(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ----- Styles -----
  const STYLES = `
    :host { all: initial; display: block; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }

    .tgm-root {
      --tgm-primary: #1B2B5B;
      --tgm-primary-light: #2A3F7A;
      --tgm-primary-dark: #111D3E;
      --tgm-accent: #00B4D8;
      --tgm-accent-light: #48CAE4;
      --tgm-accent-dark: #0096B7;
      --tgm-success: #10B981;
      --tgm-warning: #F59E0B;
      --tgm-error: #EF4444;
      --tgm-bg: #FFFFFF;
      --tgm-bg-2: #F8FAFC;
      --tgm-bg-3: #F1F5F9;
      --tgm-border: #E2E8F0;
      --tgm-border-light: #F1F5F9;
      --tgm-text: #0F172A;
      --tgm-text-2: #475569;
      --tgm-text-3: #94A3B8;
      --tgm-radius: 16px;
      --tgm-radius-sm: 6px;
      --tgm-radius-md: 8px;
      --tgm-radius-lg: 12px;
      --tgm-radius-xl: 16px;
      --tgm-radius-2xl: 20px;
      font-size: 15px;
      color: var(--tgm-text);
      line-height: 1.6;
      position: relative;
    }
    .tgm-root[data-theme="dark"] {
      --tgm-bg: #0F172A;
      --tgm-bg-2: #1E293B;
      --tgm-bg-3: #334155;
      --tgm-border: #334155;
      --tgm-border-light: #1E293B;
      --tgm-text: #F8FAFC;
      --tgm-text-2: #CBD5E1;
      --tgm-text-3: #64748B;
    }
    .tgm-num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    button { font-family: inherit; cursor: pointer; }
    a { color: inherit; }

    /* ===== VERTICAL FORM ===== */
    .tgm-form { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-2xl); overflow: hidden; box-shadow: 0 10px 15px rgba(0,0,0,.08), 0 4px 6px rgba(0,0,0,.04); max-width: 560px; margin: 0 auto; }
    .tgm-hero-form { position: relative; padding: 48px 32px 32px; background: radial-gradient(circle at 20% 0%, rgba(0,180,216,.18), transparent 50%), radial-gradient(circle at 100% 100%, rgba(72,202,228,.10), transparent 50%), linear-gradient(135deg, var(--tgm-primary) 0%, var(--tgm-primary-dark) 100%); color: #fff; }
    .tgm-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--tgm-accent-light); margin-bottom: 12px; }
    .tgm-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--tgm-accent); box-shadow: 0 0 12px var(--tgm-accent); }
    .tgm-form-title { font-size: 32px; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; margin: 0 0 12px; color: #fff; }
    .tgm-form-sub { font-size: 16px; line-height: 1.5; color: rgba(248,250,252,.78); margin: 0; max-width: 52ch; }
    .tgm-form-body { padding: 32px; }
    .tgm-field { margin-bottom: 20px; }
    .tgm-label { display: block; font-size: 13px; font-weight: 500; color: var(--tgm-text-2); margin-bottom: 4px; }
    .tgm-input-wrap { position: relative; display: flex; align-items: center; }
    .tgm-input-wrap > svg { position: absolute; left: 12px; width: 18px; height: 18px; color: var(--tgm-text-3); pointer-events: none; }
    .tgm-input { width: 100%; height: 48px; padding: 0 12px 0 40px; font-family: inherit; font-size: 15px; color: var(--tgm-text); background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); outline: none; transition: border-color .15s, box-shadow .15s; }
    .tgm-input:focus { border-color: var(--tgm-accent); box-shadow: 0 0 0 3px rgba(0,180,216,.15); }
    .tgm-input::placeholder { color: var(--tgm-text-3); }
    .tgm-input.code { letter-spacing: .04em; font-variant-numeric: tabular-nums; }
    .tgm-cta { width: 100%; height: 48px; font-family: inherit; font-size: 16px; font-weight: 600; color: #fff; background: var(--tgm-primary); border: none; border-radius: var(--tgm-radius-md); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: background .15s, transform .1s, box-shadow .15s; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .tgm-cta:hover { background: var(--tgm-primary-light); box-shadow: 0 4px 6px rgba(0,0,0,.06); }
    .tgm-cta:active { transform: scale(.98); }
    .tgm-cta:disabled { opacity: .6; cursor: not-allowed; transform: none; }
    .tgm-cta svg { width: 18px; height: 18px; }
    .tgm-trust { margin-top: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: var(--tgm-text-3); }
    .tgm-trust svg { width: 14px; height: 14px; }

    .tgm-error-msg { margin-top: 12px; padding: 10px 12px; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.2); border-radius: var(--tgm-radius-md); color: var(--tgm-error); font-size: 13px; line-height: 1.5; display: flex; align-items: center; gap: 8px; }
    .tgm-error-msg svg { width: 14px; height: 14px; flex-shrink: 0; }

    /* ===== HORIZONTAL FORM ===== */
    .tgm-hform { position: relative; padding: 24px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-2xl); overflow: hidden; box-shadow: 0 10px 15px rgba(0,0,0,.08), 0 4px 6px rgba(0,0,0,.04); }
    .tgm-hform::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 10% 20%, rgba(0,180,216,.06), transparent 50%); pointer-events: none; }
    .tgm-hform-top { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .tgm-hform-heading { display: flex; align-items: center; gap: 12px; }
    .tgm-hform-icon { width: 40px; height: 40px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .tgm-hform-icon svg { width: 20px; height: 20px; color: var(--tgm-accent); }
    .tgm-hform-title { font-size: 18px; font-weight: 700; letter-spacing: -.01em; margin: 0 0 2px; color: var(--tgm-text); line-height: 1.2; }
    .tgm-hform-sub { font-size: 13px; color: var(--tgm-text-2); margin: 0; }
    .tgm-hform-trust { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; color: var(--tgm-text-2); padding: 8px 12px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border); border-radius: 9999px; }
    .tgm-hform-trust svg { width: 12px; height: 12px; }
    .tgm-hform-row { position: relative; display: grid; grid-template-columns: 1.2fr 1fr 1fr auto; gap: 12px; align-items: end; }
    .tgm-hform-field { display: flex; flex-direction: column; }
    .tgm-hform-field label { font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: var(--tgm-text-2); margin-bottom: 4px; }
    .tgm-hform-iw { position: relative; display: flex; align-items: center; }
    .tgm-hform-iw svg { position: absolute; left: 12px; width: 16px; height: 16px; color: var(--tgm-text-3); pointer-events: none; }
    .tgm-hform-input { width: 100%; height: 44px; padding: 0 12px 0 36px; font-family: inherit; font-size: 15px; color: var(--tgm-text); background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); outline: none; transition: all .15s; }
    .tgm-hform-input::placeholder { color: var(--tgm-text-3); }
    .tgm-hform-input:focus { border-color: var(--tgm-accent); box-shadow: 0 0 0 3px rgba(0,180,216,.15); }
    .tgm-hform-cta { height: 44px; padding: 0 20px; font-family: inherit; font-size: 15px; font-weight: 600; color: #fff; background: var(--tgm-primary); border: none; border-radius: var(--tgm-radius-md); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: background .15s, transform .1s; box-shadow: 0 4px 12px rgba(15,23,42,.15); white-space: nowrap; }
    .tgm-hform-cta:hover { background: var(--tgm-primary-light); }
    .tgm-hform-cta:active { transform: scale(.97); }
    .tgm-hform-cta:disabled { opacity: .6; cursor: not-allowed; }
    .tgm-hform-cta svg { width: 16px; height: 16px; }

    .tgm-root[data-theme="dark"] .tgm-hform { background: linear-gradient(135deg, var(--tgm-primary) 0%, var(--tgm-primary-dark) 100%); border-color: transparent; }
    .tgm-root[data-theme="dark"] .tgm-hform::before { background: radial-gradient(circle at 10% 20%, rgba(0,180,216,.15), transparent 50%), radial-gradient(circle at 90% 80%, rgba(72,202,228,.08), transparent 50%); }
    .tgm-root[data-theme="dark"] .tgm-hform-icon { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.2); }
    .tgm-root[data-theme="dark"] .tgm-hform-icon svg { color: var(--tgm-accent-light); }
    .tgm-root[data-theme="dark"] .tgm-hform-title { color: #fff; }
    .tgm-root[data-theme="dark"] .tgm-hform-sub { color: rgba(248,250,252,.7); }
    .tgm-root[data-theme="dark"] .tgm-hform-trust { color: rgba(248,250,252,.7); background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.12); }
    .tgm-root[data-theme="dark"] .tgm-hform-field label { color: rgba(248,250,252,.7); }
    .tgm-root[data-theme="dark"] .tgm-hform-iw svg { color: rgba(255,255,255,.5); }
    .tgm-root[data-theme="dark"] .tgm-hform-input { color: #fff; background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.15); }
    .tgm-root[data-theme="dark"] .tgm-hform-input::placeholder { color: rgba(255,255,255,.4); }
    .tgm-root[data-theme="dark"] .tgm-hform-input:focus { background: rgba(255,255,255,.12); border-color: var(--tgm-accent); box-shadow: 0 0 0 3px rgba(0,180,216,.25); }
    .tgm-root[data-theme="dark"] .tgm-hform-input::-webkit-calendar-picker-indicator { filter: invert(1) opacity(.6); }
    .tgm-root[data-theme="dark"] .tgm-hform-cta { color: var(--tgm-primary); background: var(--tgm-accent); box-shadow: 0 4px 12px rgba(0,180,216,.25); }
    .tgm-root[data-theme="dark"] .tgm-hform-cta:hover { background: var(--tgm-accent-light); }

    @media (max-width: 860px) {
      .tgm-hform-row { grid-template-columns: 1fr 1fr; }
      .tgm-hform-cta { grid-column: 1 / -1; width: 100%; }
    }
    @media (max-width: 480px) {
      .tgm-hform { padding: 16px; }
      .tgm-hform-row { grid-template-columns: 1fr; }
      .tgm-hform-top { flex-direction: column; align-items: flex-start; }
    }
    .tgm-hform.compact { padding: 16px; }
    .tgm-hform.compact .tgm-hform-top { margin-bottom: 12px; }
    .tgm-hform.compact .tgm-hform-icon { width: 32px; height: 32px; }
    .tgm-hform.compact .tgm-hform-title { font-size: 16px; }
    .tgm-hform.compact .tgm-hform-row { grid-template-columns: 1fr; }
    .tgm-hform.compact .tgm-hform-cta { width: 100%; grid-column: auto; }

    /* ===== LOADING ===== */
    .tgm-loading { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-2xl); padding: 64px 32px; text-align: center; box-shadow: 0 10px 15px rgba(0,0,0,.08), 0 4px 6px rgba(0,0,0,.04); max-width: 560px; margin: 0 auto; }
    .tgm-spinner { width: 40px; height: 40px; margin: 0 auto 24px; border: 2.5px solid var(--tgm-bg-3); border-top-color: var(--tgm-accent); border-radius: 50%; animation: tgm-spin .8s linear infinite; }
    @keyframes tgm-spin { to { transform: rotate(360deg); } }
    .tgm-loading h2 { font-size: 18px; font-weight: 600; margin: 0 0 4px; letter-spacing: -.01em; }
    .tgm-loading p { font-size: 15px; color: var(--tgm-text-2); margin: 0; }

    /* ===== FOUND ===== */
    .tgm-found { animation: tgm-fadeup .4s cubic-bezier(.2,.7,.2,1); }
    @keyframes tgm-fadeup { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .tgm-hero { position: relative; height: 380px; border-radius: var(--tgm-radius-2xl); overflow: hidden; box-shadow: 0 20px 25px rgba(0,0,0,.08), 0 10px 10px rgba(0,0,0,.04); margin-bottom: 16px; }
    .tgm-hero-img { position: absolute; inset: 0; background-size: cover; background-position: center; transform: scale(1.04); animation: tgm-zoom 24s ease-in-out infinite alternate; }
    /* Full-image mode (display.showFullImage): show the whole image, filling the
       frame even if it stretches. Drop the crop-zoom so nothing is cut off. */
    .tgm-hero-img.tgm-hero-img--full { background-size: 100% 100%; transform: none; animation: none; }
    @keyframes tgm-zoom { to { transform: scale(1.1); } }
    .tgm-hero-overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(15,23,42,.10) 0%, rgba(15,23,42,.20) 40%, rgba(15,23,42,.85) 100%); }
    .tgm-hero-content { position: absolute; inset: 0; padding: 32px; display: flex; flex-direction: column; justify-content: space-between; color: #fff; }
    .tgm-hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .tgm-hero-top > * { flex-shrink: 0; }
    .tgm-confirmed { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; background: rgba(16,185,129,.95); backdrop-filter: blur(8px); border-radius: 9999px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #fff; box-shadow: 0 2px 8px rgba(16,185,129,.3); }
    .tgm-confirmed svg { width: 13px; height: 13px; stroke-width: 3; }
    .tgm-ref { padding: 6px 12px; background: rgba(15,23,42,.65); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,.18); border-radius: var(--tgm-radius-md); font-size: 11px; font-weight: 500; color: rgba(255,255,255,.92); letter-spacing: .04em; box-shadow: 0 2px 8px rgba(15,23,42,.25); }
    .tgm-ref strong { color: #fff; margin-left: 8px; font-weight: 700; letter-spacing: .02em; font-variant-numeric: tabular-nums; }

    /* ATOL / operator badge — surfaced on the hero for Packages bookings.
       Required trust signal: when an agency sells an ATOL-protected package
       (Jet2 Holidays, EveryHoliday, TUI etc) the operator's name must be
       visible to the customer. Indigo/gold treatment reads as a regulatory
       badge rather than a generic chip. */
    .tgm-atol { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: linear-gradient(135deg, rgba(67,56,202,.95), rgba(91,33,182,.95)); border: 1px solid rgba(255,255,255,.18); border-radius: var(--tgm-radius-md); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #fff; box-shadow: 0 2px 8px rgba(67,56,202,.3); }
    .tgm-atol svg { width: 13px; height: 13px; stroke-width: 2.5; color: #FCD34D; }
    .tgm-atol .tgm-atol-op { color: rgba(255,255,255,.92); font-weight: 500; text-transform: none; letter-spacing: .02em; margin-left: 4px; }
    .tgm-atol .tgm-atol-op::before { content: "·"; margin-right: 6px; color: rgba(255,255,255,.5); }
    .tgm-hero-rating { display: inline-flex; gap: 2px; align-items: center; margin-bottom: 12px; }
    .tgm-hero-rating svg { width: 14px; height: 14px; fill: #FFD166; color: #FFD166; }
    .tgm-review-chip { display: inline-flex; align-items: center; gap: 6px; margin-left: 12px; padding: 3px 10px; background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.25); border-radius: 9999px; font-size: 12px; font-weight: 500; color: #fff; backdrop-filter: blur(4px); }
    .tgm-review-chip strong { font-weight: 700; font-variant-numeric: tabular-nums; }
    .tgm-hero-name { font-size: 32px; font-weight: 700; letter-spacing: -.02em; line-height: 1.05; margin: 0 0 4px; text-shadow: 0 2px 12px rgba(0,0,0,.3); }
    .tgm-hero-loc { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; color: rgba(255,255,255,.88); margin: 0; }
    .tgm-hero-loc svg { width: 14px; height: 14px; }
    .tgm-hero-thumbs { position: absolute; bottom: 16px; right: 16px; display: flex; gap: 8px; }
    .tgm-hero-thumbs button { width: 48px; height: 48px; border-radius: var(--tgm-radius-md); background-size: cover; background-position: center; border: 2px solid rgba(255,255,255,.3); cursor: pointer; padding: 0; transition: transform .15s, border-color .15s; }
    .tgm-hero-thumbs button:hover { transform: translateY(-2px); border-color: #fff; }
    .tgm-hero-thumbs button.active { border-color: #fff; }

    .tgm-greeting { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
    .tgm-greeting-text { font-size: 15px; }
    .tgm-greeting-text strong { font-weight: 600; }
    .tgm-countdown { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--tgm-text-2); padding: 4px 12px; background: var(--tgm-bg-2); border-radius: 9999px; font-weight: 500; }
    .tgm-countdown svg { width: 14px; height: 14px; }
    .tgm-countdown strong { color: var(--tgm-accent-dark); font-weight: 700; font-variant-numeric: tabular-nums; }

    /* ===== PDF action row — three buttons (Preview + Email + Download) ===== */
    .tgm-action-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
    @media (max-width: 760px) { .tgm-action-row { grid-template-columns: 1fr; } }
    .tgm-action { display: flex; align-items: center; gap: 12px; padding: 16px 18px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); cursor: pointer; text-align: left; font-family: inherit; transition: all .25s cubic-bezier(.2,.7,.2,1); width: 100%; position: relative; }
    .tgm-action:hover:not(:disabled) { border-color: var(--tgm-accent); transform: translateY(-1px); box-shadow: 0 4px 6px rgba(0,0,0,.06), 0 2px 4px rgba(0,0,0,.04); }
    .tgm-action:disabled { cursor: wait; opacity: .85; }
    .tgm-action.is-active { border-color: var(--tgm-accent); background: var(--tgm-bg-2); }
    .tgm-action-icon { width: 40px; height: 40px; border-radius: var(--tgm-radius-md); background: linear-gradient(135deg, var(--tgm-accent) 0%, var(--tgm-accent-dark) 100%); display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }
    .tgm-action-icon svg { width: 18px; height: 18px; }
    .tgm-action-text { flex: 1; min-width: 0; }
    .tgm-action-title { font-size: 15px; font-weight: 600; color: var(--tgm-text); margin-bottom: 2px; letter-spacing: -.01em; line-height: 1.3; }
    .tgm-action-sub { font-size: 12px; color: var(--tgm-text-2); line-height: 1.4; }
    .tgm-action-arrow { width: 18px; height: 18px; color: var(--tgm-text-3); transition: transform .15s, color .15s; flex-shrink: 0; }
    .tgm-action:hover:not(:disabled) .tgm-action-arrow { transform: translateX(2px); color: var(--tgm-accent); }
    .tgm-action.is-loading .tgm-action-arrow { display: none; }
    .tgm-action-loader { width: 18px; height: 18px; border: 2px solid var(--tgm-bg-3); border-top-color: var(--tgm-accent); border-radius: 50%; animation: tgm-spin .7s linear infinite; flex-shrink: 0; display: none; }
    .tgm-action.is-loading .tgm-action-loader { display: block; }

    /* Issue 4: subtle "Look up another booking" text link that lets the
       customer return to the lookup form without refreshing the page. Sits
       above the action row, right-aligned so it doesn't compete with the
       greeting copy on the left. */
    .tgm-newlookup-row { display: flex; justify-content: flex-end; margin: -4px 0 12px; }
    .tgm-newlookup { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; margin: 0; background: transparent; border: 0; border-radius: var(--tgm-radius-sm); font-family: inherit; font-size: 13px; font-weight: 500; color: var(--tgm-text-2); cursor: pointer; transition: color .15s, background .15s; }
    .tgm-newlookup:hover { color: var(--tgm-accent); background: var(--tgm-bg-2); }
    .tgm-newlookup svg { width: 14px; height: 14px; }
    @media (max-width: 480px) {
      .tgm-newlookup-row { justify-content: flex-start; }
    }

    /* When the action row is at 3 columns, the action title can get tight.
       Hide the arrow on narrow desktop sizes between 760-1100px so titles
       and sub-copy have room to breathe. */
    @media (min-width: 761px) and (max-width: 1100px) {
      .tgm-action { padding: 14px 14px; gap: 10px; }
      .tgm-action-icon { width: 36px; height: 36px; }
      .tgm-action-icon svg { width: 16px; height: 16px; }
      .tgm-action-arrow { display: none; }
    }

    /* Inline PDF viewer panel */
    .tgm-pdf-viewer { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); overflow: hidden; margin-bottom: 16px; box-shadow: 0 4px 6px rgba(0,0,0,.04), 0 2px 4px rgba(0,0,0,.02); animation: tgm-fadeup .3s cubic-bezier(.2,.7,.2,1); }
    .tgm-pdf-viewer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: var(--tgm-bg-2); border-bottom: 1px solid var(--tgm-border); }
    .tgm-pdf-viewer-title { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--tgm-text); letter-spacing: -.01em; }
    .tgm-pdf-viewer-title svg { width: 16px; height: 16px; color: var(--tgm-accent); }
    .tgm-pdf-viewer-actions { display: flex; gap: 8px; align-items: center; }
    .tgm-pdf-viewer-btn { height: 32px; padding: 0 12px; font-family: inherit; font-size: 13px; font-weight: 500; color: var(--tgm-text-2); background: transparent; border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-sm); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all .15s; }
    .tgm-pdf-viewer-btn:hover { border-color: var(--tgm-accent); color: var(--tgm-text); }
    .tgm-pdf-viewer-btn svg { width: 14px; height: 14px; }
    .tgm-pdf-viewer-frame { width: 100%; height: 840px; border: none; display: block; background: var(--tgm-bg-3); }
    @media (max-width: 480px) { .tgm-pdf-viewer-frame { height: 600px; } }
    /* Mobile fallback — iOS Safari can't render <iframe src="blob:..."> for PDFs.
       We swap to a download-only state with a clear call to action. */
    .tgm-pdf-viewer-fallback { padding: 32px 24px; text-align: center; }
    .tgm-pdf-viewer-fallback p { font-size: 14px; color: var(--tgm-text-2); margin: 0 0 16px; line-height: 1.5; }

    /* ===== Email modal ===== */
    /* Modal lives inside the widget shadow root so it inherits all our tokens
       and doesn't conflict with the host page. We use position: fixed so it
       overlays the host viewport, not the widget container. */
    /* backdrop-filter removed: caused per-keystroke re-blur of the entire
       viewport which made the email modal feel laggy (especially inside the
       editor preview iframe). The flat rgba dim reads as a modal scrim
       without the cost. */
    .tgm-modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, .55); z-index: 999998; display: flex; align-items: center; justify-content: center; padding: 16px; animation: tgm-fade .2s ease; }
    @keyframes tgm-fade { from { opacity: 0; } to { opacity: 1; } }
    .tgm-modal { background: var(--tgm-bg); border-radius: var(--tgm-radius-2xl); width: 100%; max-width: 520px; max-height: calc(100vh - 32px); overflow-y: auto; box-shadow: 0 25px 50px rgba(0,0,0,.25), 0 12px 24px rgba(0,0,0,.15); animation: tgm-modal-in .3s cubic-bezier(.2,.7,.2,1); position: relative; }
    @keyframes tgm-modal-in { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: none; } }
    .tgm-modal-head { padding: 24px 24px 16px; border-bottom: 1px solid var(--tgm-border-light); display: flex; align-items: flex-start; gap: 16px; }
    .tgm-modal-head-icon { width: 40px; height: 40px; border-radius: var(--tgm-radius-md); background: linear-gradient(135deg, var(--tgm-accent), var(--tgm-accent-dark)); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .tgm-modal-head-icon svg { width: 20px; height: 20px; }
    .tgm-modal-head-text { flex: 1; min-width: 0; }
    .tgm-modal-head-title { font-size: 18px; font-weight: 700; color: var(--tgm-text); margin: 0 0 2px; letter-spacing: -.01em; line-height: 1.3; }
    .tgm-modal-head-sub { font-size: 13px; color: var(--tgm-text-2); margin: 0; line-height: 1.5; }
    .tgm-modal-close { width: 32px; height: 32px; border-radius: var(--tgm-radius-sm); border: 1px solid var(--tgm-border); background: var(--tgm-bg); color: var(--tgm-text-3); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all .15s; padding: 0; }
    .tgm-modal-close:hover { border-color: var(--tgm-accent); color: var(--tgm-text); }
    .tgm-modal-close svg { width: 14px; height: 14px; }
    .tgm-modal-body { padding: 20px 24px; }
    .tgm-modal-field { margin-bottom: 16px; }
    .tgm-modal-field:last-child { margin-bottom: 0; }
    .tgm-modal-field label { display: block; font-size: 12px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: var(--tgm-text-2); margin-bottom: 6px; }
    .tgm-modal-input, .tgm-modal-textarea { width: 100%; font-family: inherit; font-size: 15px; color: var(--tgm-text); background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); outline: none; transition: border-color .15s, box-shadow .15s; padding: 10px 12px; }
    .tgm-modal-input { height: 44px; }
    .tgm-modal-textarea { min-height: 84px; resize: vertical; line-height: 1.5; font-family: inherit; }
    .tgm-modal-input:focus, .tgm-modal-textarea:focus { border-color: var(--tgm-accent); box-shadow: 0 0 0 3px rgba(0,180,216,.15); }
    .tgm-modal-input::placeholder, .tgm-modal-textarea::placeholder { color: var(--tgm-text-3); }
    .tgm-modal-help { font-size: 12px; color: var(--tgm-text-3); margin-top: 6px; line-height: 1.5; }
    .tgm-modal-attach { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); margin-top: 4px; }
    .tgm-modal-attach-icon { width: 32px; height: 32px; border-radius: var(--tgm-radius-sm); background: var(--tgm-bg); border: 1px solid var(--tgm-border); display: flex; align-items: center; justify-content: center; color: var(--tgm-accent); flex-shrink: 0; }
    .tgm-modal-attach-icon svg { width: 16px; height: 16px; }
    .tgm-modal-attach-text { flex: 1; min-width: 0; font-size: 13px; }
    .tgm-modal-attach-name { font-weight: 600; color: var(--tgm-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tgm-modal-attach-meta { color: var(--tgm-text-2); margin-top: 1px; }
    .tgm-modal-foot { padding: 16px 24px 20px; display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .tgm-modal-foot .tgm-btn-1, .tgm-modal-foot .tgm-btn-2 { min-width: 110px; }
    .tgm-modal-error { background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.25); border-radius: var(--tgm-radius-md); padding: 10px 12px; font-size: 13px; color: var(--tgm-error); display: flex; align-items: center; gap: 8px; margin-top: 12px; }
    .tgm-modal-error svg { width: 14px; height: 14px; flex-shrink: 0; }
    @media (max-width: 480px) {
      .tgm-modal { max-width: 100%; max-height: 100vh; border-radius: 0; }
      .tgm-modal-head, .tgm-modal-body, .tgm-modal-foot { padding-left: 16px; padding-right: 16px; }
      .tgm-modal-foot { flex-direction: column-reverse; }
      .tgm-modal-foot .tgm-btn-1, .tgm-modal-foot .tgm-btn-2 { width: 100%; }
    }

    /* ----- Cancel a product (manage booking) ----- */
    .tgm-cancel-sec { margin-top: 20px; border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); overflow: hidden; }
    .tgm-cancel-sec-head { padding: 16px 20px; background: var(--tgm-bg-2); border-bottom: 1px solid var(--tgm-border); }
    .tgm-cancel-sec-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--tgm-text); display: flex; align-items: center; gap: 8px; }
    .tgm-cancel-sec-head h3 svg { width: 17px; height: 17px; flex-shrink: 0; color: var(--tgm-text-2); }
    .tgm-cancel-sec-head p { margin: 4px 0 0; font-size: 13px; color: var(--tgm-text-3); }
    .tgm-cancel-row { display: flex; align-items: center; gap: 14px; padding: 14px 20px; border-bottom: 1px solid var(--tgm-border-light); }
    .tgm-cancel-row:last-child { border-bottom: 0; }
    .tgm-cancel-row-icon { width: 34px; height: 34px; flex-shrink: 0; border-radius: var(--tgm-radius-md); background: var(--tgm-bg-3); display: flex; align-items: center; justify-content: center; color: var(--tgm-text-2); }
    .tgm-cancel-row-icon svg { width: 17px; height: 17px; }
    .tgm-cancel-row-text { flex: 1; min-width: 0; }
    .tgm-cancel-row-title { font-size: 14px; font-weight: 600; color: var(--tgm-text); }
    .tgm-cancel-row-sub { font-size: 12.5px; color: var(--tgm-text-3); margin-top: 1px; }
    .tgm-cancel-btn { height: 38px; padding: 0 16px; flex-shrink: 0; background: var(--tgm-bg); border: 1px solid rgba(239,68,68,.4); border-radius: var(--tgm-radius-md); font-family: inherit; font-size: 13.5px; font-weight: 600; color: var(--tgm-error); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: all .15s; }
    .tgm-cancel-btn:hover { background: rgba(239,68,68,.07); border-color: var(--tgm-error); }
    .tgm-cancel-btn svg { width: 14px; height: 14px; }
    .tgm-cancel-row.is-cancelled .tgm-cancel-btn { display: none; }
    .tgm-cancel-pill { flex-shrink: 0; font-size: 12px; font-weight: 600; color: var(--tgm-text-3); background: var(--tgm-bg-3); border-radius: 999px; padding: 5px 12px; }
    /* Danger primary button for the final confirm */
    .tgm-btn-danger { height: 44px; padding: 0 20px; background: var(--tgm-error); border: 1px solid var(--tgm-error); border-radius: var(--tgm-radius-md); font-family: inherit; font-size: 15px; font-weight: 500; color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: all .15s; }
    .tgm-btn-danger:hover { filter: brightness(.94); }
    .tgm-btn-danger[disabled] { opacity: .6; cursor: default; }
    .tgm-btn-danger svg { width: 16px; height: 16px; }
    /* Policy list inside the modal */
    .tgm-policies { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 2px; }
    .tgm-policy { display: flex; gap: 10px; align-items: flex-start; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border-light); border-radius: var(--tgm-radius-md); padding: 11px 13px; font-size: 13.5px; line-height: 1.45; color: var(--tgm-text); }
    .tgm-policy svg { width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px; color: var(--tgm-warning); }
    .tgm-cancel-warn { display: flex; gap: 10px; align-items: flex-start; background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.28); border-radius: var(--tgm-radius-md); padding: 11px 13px; font-size: 13px; line-height: 1.45; color: var(--tgm-text); margin-top: 12px; }
    .tgm-cancel-warn svg { width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px; color: var(--tgm-warning); }
    .tgm-reason-count { text-align: right; font-size: 12px; color: var(--tgm-text-3); margin-top: 4px; }
    .tgm-cancel-done { text-align: center; padding: 8px 4px 4px; }
    .tgm-cancel-done-icon { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%; background: rgba(16,185,129,.12); display: flex; align-items: center; justify-content: center; color: var(--tgm-success); }
    .tgm-cancel-done-icon svg { width: 28px; height: 28px; }
    .tgm-cancel-done h2 { margin: 0 0 6px; font-size: 18px; font-weight: 700; color: var(--tgm-text); }
    .tgm-cancel-done p { margin: 0; font-size: 14px; color: var(--tgm-text-3); }
    .tgm-cancel-ref { display: inline-block; margin-top: 14px; font-size: 13px; font-weight: 600; color: var(--tgm-text); background: var(--tgm-bg-2); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); padding: 8px 16px; }
    .tgm-cancel-spin { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 28px 4px; color: var(--tgm-text-3); font-size: 14px; }
    .tgm-cancel-spin .tgm-spinner { width: 32px; height: 32px; border: 3px solid var(--tgm-border); border-top-color: var(--tgm-primary); border-radius: 50%; animation: tgm-spin .7s linear infinite; }
    @keyframes tgm-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .tgm-cancel-spin .tgm-spinner { animation-duration: 2s; } }

    /* ===== Amendment request section ===== */
    .tgm-amend-sec { margin-top: 16px; border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); overflow: hidden; }
    .tgm-amend-head { padding: 16px 20px; background: var(--tgm-bg-2); border-bottom: 1px solid var(--tgm-border); }
    .tgm-amend-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--tgm-text); display: flex; align-items: center; gap: 8px; }
    .tgm-amend-head h3 svg { width: 17px; height: 17px; flex-shrink: 0; color: var(--tgm-text-2); }
    .tgm-amend-head p { margin: 4px 0 0; font-size: 13px; color: var(--tgm-text-3); line-height: 1.45; }
    .tgm-amend-body { padding: 16px 20px; }
    .tgm-amend-open { height: 40px; padding: 0 16px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); font-family: inherit; font-size: 14px; font-weight: 600; color: var(--tgm-text); cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: all .15s; }
    .tgm-amend-open:hover { border-color: var(--tgm-accent); }
    .tgm-amend-open svg { width: 15px; height: 15px; color: var(--tgm-accent); }
    .tgm-amend-label { display: block; font-size: 13px; font-weight: 500; color: var(--tgm-text-2); margin-bottom: 6px; }
    .tgm-amend-input { width: 100%; min-height: 96px; resize: vertical; padding: 12px 14px; font-family: inherit; font-size: 15px; line-height: 1.5; color: var(--tgm-text); background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); box-sizing: border-box; transition: border-color .15s, box-shadow .15s; }
    .tgm-amend-input:focus { outline: 0; border-color: var(--tgm-accent); box-shadow: 0 0 0 3px rgba(0,180,216,.18); }
    .tgm-amend-foot { display: flex; justify-content: flex-end; margin-top: 6px; }
    .tgm-amend-count { font-size: 12px; color: var(--tgm-text-3); font-variant-numeric: tabular-nums; }
    .tgm-amend-count.tgm-near { color: #D97706; }
    .tgm-amend-note { font-size: 12.5px; color: var(--tgm-text-3); line-height: 1.45; margin-top: 10px; }
    .tgm-amend-actions { display: flex; gap: 10px; margin-top: 14px; }
    .tgm-amend-cancel { height: 44px; padding: 0 18px; background: transparent; border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); color: var(--tgm-text-2); font-family: inherit; font-size: 15px; font-weight: 500; cursor: pointer; transition: background .15s; }
    .tgm-amend-cancel:hover { background: var(--tgm-border-light); }
    .tgm-amend-submit { flex: 1; height: 44px; padding: 0 18px; background: var(--tgm-primary); border: none; border-radius: var(--tgm-radius-md); color: #fff; font-family: inherit; font-size: 15px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: background .15s, opacity .15s; }
    .tgm-amend-submit:hover:not(:disabled) { background: var(--tgm-primary-light); }
    .tgm-amend-submit:disabled { opacity: .5; cursor: not-allowed; }
    .tgm-amend-submit svg { width: 16px; height: 16px; }
    .tgm-amend-done { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border-light); border-radius: var(--tgm-radius-md); }
    .tgm-amend-done-icon { width: 32px; height: 32px; border-radius: 50%; background: var(--tgm-success); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .tgm-amend-done-icon svg { width: 16px; height: 16px; }
    .tgm-amend-done-text { font-size: 13.5px; color: var(--tgm-text); line-height: 1.5; }
    .tgm-amend-done-text strong { display: block; margin-bottom: 2px; }

    /* ----- Pay balance ----- */
    .tgm-pay-action { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--tgm-border-light); }
    .tgm-pay-cta { width: 100%; height: 48px; padding: 0 20px; background: var(--tgm-primary); border: 1px solid var(--tgm-primary); border-radius: var(--tgm-radius-md); color: #fff; font-family: inherit; font-size: 16px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: filter .15s, opacity .15s; }
    .tgm-pay-cta:hover { filter: brightness(1.07); }
    .tgm-pay-cta[disabled] { opacity: .6; cursor: default; }
    .tgm-pay-cta svg { width: 18px; height: 18px; }
    .tgm-pay-note { font-size: 12.5px; color: var(--tgm-text-3); margin-top: 8px; text-align: center; line-height: 1.45; }
    .tgm-pay-form { margin-top: 14px; }
    .tgm-pay-field { display: block; }
    .tgm-pay-field-label { display: block; font-size: 13px; font-weight: 500; color: var(--tgm-text-2); margin-bottom: 6px; }
    .tgm-pay-input-wrap { display: flex; align-items: center; height: 48px; border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); background: var(--tgm-bg); transition: border-color .15s, box-shadow .15s; }
    .tgm-pay-input-wrap:focus-within { border-color: var(--tgm-accent); box-shadow: 0 0 0 3px rgba(0,180,216,.18); }
    .tgm-pay-cur { padding: 0 2px 0 14px; font-size: 16px; font-weight: 600; color: var(--tgm-text-2); }
    .tgm-pay-input { flex: 1 1 auto; min-width: 0; width: 100%; height: 100%; border: 0; outline: 0; background: transparent; padding: 0 14px 0 4px; font-family: inherit; font-size: 16px; font-weight: 600; color: var(--tgm-text); font-variant-numeric: tabular-nums; }
    .tgm-pay-hint { font-size: 12.5px; color: var(--tgm-text-3); margin-top: 8px; line-height: 1.45; }
    .tgm-pay-hint.tgm-err { color: #DC2626; }
    .tgm-pay-form-row { display: flex; gap: 10px; align-items: stretch; margin-top: 14px; }
    .tgm-pay-cancel { flex: 0 0 auto; height: 48px; padding: 0 18px; background: transparent; border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); color: var(--tgm-text-2); font-family: inherit; font-size: 15px; font-weight: 500; cursor: pointer; transition: background .15s; }
    .tgm-pay-cancel:hover { background: var(--tgm-border-light); }
    .tgm-pay-confirm { flex: 1 1 auto; }
    .tgm-pay-error { display: flex; gap: 8px; align-items: center; margin-top: 10px; background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.25); border-radius: var(--tgm-radius-md); padding: 9px 12px; font-size: 13px; color: var(--tgm-error); }
    .tgm-pay-error svg { width: 14px; height: 14px; flex-shrink: 0; }

    /* Toast notifications */
    .tgm-toast-stack { position: fixed; top: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; z-index: 999999; max-width: 380px; }
    .tgm-toast { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); box-shadow: 0 10px 25px rgba(0,0,0,.12), 0 4px 10px rgba(0,0,0,.06); font-size: 14px; color: var(--tgm-text); pointer-events: auto; animation: tgm-toast-in .35s cubic-bezier(.2,.7,.2,1); min-width: 280px; }
    .tgm-toast.is-leaving { animation: tgm-toast-out .25s cubic-bezier(.4,0,1,1) forwards; }
    @keyframes tgm-toast-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
    @keyframes tgm-toast-out { to { opacity: 0; transform: translateX(20px); } }
    .tgm-toast-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #fff; }
    .tgm-toast-icon svg { width: 16px; height: 16px; stroke-width: 2.5; }
    .tgm-toast.is-loading .tgm-toast-icon { background: var(--tgm-accent); }
    .tgm-toast.is-success .tgm-toast-icon { background: var(--tgm-success); }
    .tgm-toast.is-error .tgm-toast-icon { background: var(--tgm-error); }
    .tgm-toast.is-loading .tgm-toast-icon::before { content: ''; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: tgm-spin .7s linear infinite; }
    .tgm-toast.is-loading .tgm-toast-icon svg { display: none; }
    .tgm-toast-content { flex: 1; min-width: 0; }
    .tgm-toast-title { font-weight: 600; font-size: 14px; color: var(--tgm-text); }
    .tgm-toast-sub { font-size: 12px; color: var(--tgm-text-2); margin-top: 1px; }

    .tgm-stay { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); padding: 20px; margin-bottom: 16px; }
    .tgm-stay h3 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; margin: 0 0 16px; color: var(--tgm-text); letter-spacing: -.01em; }
    .tgm-stay h3 svg { color: var(--tgm-accent); }
    .tgm-stay h3 .tgm-stay-meta { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--tgm-text-3); }
    .tgm-stay-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px; }
    .tgm-stay-cell { padding: 0 16px; border-right: 1px solid var(--tgm-border-light); }
    .tgm-stay-cell:first-child { padding-left: 0; }
    .tgm-stay-cell:last-child { border-right: none; padding-right: 0; }
    .tgm-stay-label { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-3); margin-bottom: 8px; }
    .tgm-stay-label svg { width: 13px; height: 13px; }
    .tgm-stay-value { font-size: 18px; font-weight: 600; color: var(--tgm-text); letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
    .tgm-stay-sub { font-size: 13px; color: var(--tgm-text-2); margin-top: 2px; }
    @media (max-width: 780px) {
      .tgm-stay-grid { grid-template-columns: 1fr 1fr; }
      .tgm-stay-cell { padding: 0; border-right: none; border-bottom: 1px solid var(--tgm-border-light); padding-bottom: 12px; }
      .tgm-stay-cell:nth-last-child(-n+2) { border-bottom: none; padding-bottom: 0; padding-top: 12px; }
    }

    .tgm-two { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; margin-bottom: 16px; }
    @media (max-width: 780px) { .tgm-two { grid-template-columns: 1fr; } }

    .tgm-section { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); padding: 20px; margin-bottom: 16px; }
    .tgm-section h3 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; margin: 0 0 16px; color: var(--tgm-text); letter-spacing: -.01em; }
    .tgm-section h3 svg { width: 16px; height: 16px; color: var(--tgm-accent); }

    .tgm-pay-total { display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid var(--tgm-border-light); margin-bottom: 16px; }
    .tgm-pay-label { font-size: 13px; color: var(--tgm-text-2); }
    .tgm-pay-total-amt { font-size: 28px; font-weight: 700; color: var(--tgm-text); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .tgm-pay-row { display: flex; justify-content: space-between; font-size: 15px; padding: 8px 0; }
    .tgm-pay-row .v { font-weight: 500; color: var(--tgm-text); font-variant-numeric: tabular-nums; }
    .tgm-pay-row .v.paid { color: var(--tgm-success); }
    .tgm-pay-row .v.due { color: var(--tgm-warning); }
    .tgm-pay-sched { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--tgm-border-light); }
    .tgm-pay-sched-title { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-3); margin-bottom: 12px; }
    .tgm-inst { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; margin-bottom: 4px; border-radius: var(--tgm-radius-sm); font-size: 13px; transition: background .15s; }
    .tgm-inst:hover { background: var(--tgm-bg-2); }
    .tgm-inst .date { color: var(--tgm-text-2); font-variant-numeric: tabular-nums; }
    .tgm-inst .amt { font-weight: 600; color: var(--tgm-text); font-variant-numeric: tabular-nums; }

    /* "Also payable on arrival" — surfaces in-resort fees inside the Payment
       card so they sit next to total/deposit/balance instead of buried
       inside the collapsed "At the hotel" accordion. Amber treatment marks
       this as an obligation the customer must plan for, separately from
       the holiday cost they've already paid towards. */
    .tgm-pay-onarrival { margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--tgm-border-light); }
    .tgm-pay-onarrival-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-warning); margin-bottom: 10px; }
    .tgm-pay-onarrival-title svg { width: 13px; height: 13px; }
    .tgm-pay-onarrival-line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 6px 0; font-size: 14px; }
    .tgm-pay-onarrival-line .name { color: var(--tgm-text-2); }
    .tgm-pay-onarrival-line .name small { display: block; font-size: 11px; color: var(--tgm-text-3); margin-top: 1px; }
    .tgm-pay-onarrival-line .val { font-weight: 600; color: var(--tgm-text); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tgm-pay-onarrival-note { font-size: 11px; color: var(--tgm-text-3); margin-top: 6px; line-height: 1.5; }

    .tgm-guest { display: flex; align-items: center; gap: 12px; }
    .tgm-guest-av { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, var(--tgm-accent), var(--tgm-accent-dark)); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 13px; letter-spacing: .04em; flex-shrink: 0; }
    .tgm-guest-info { flex: 1; min-width: 0; }
    .tgm-guest-name { font-size: 15px; font-weight: 500; color: var(--tgm-text); }
    .tgm-guest-meta { font-size: 13px; color: var(--tgm-text-3); }
    .tgm-guest + .tgm-guest { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--tgm-border-light); }

    .tgm-collapse { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); margin-bottom: 8px; overflow: hidden; }
    .tgm-collapse-trig { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: transparent; border: none; cursor: pointer; text-align: left; font-family: inherit; font-size: 16px; font-weight: 500; color: var(--tgm-text); transition: background .15s; }
    .tgm-collapse-trig:hover { background: var(--tgm-bg-2); }
    .tgm-collapse-trig .chev { width: 18px; height: 18px; color: var(--tgm-text-3); transition: transform .25s; }
    .tgm-collapse.open .chev { transform: rotate(180deg); }
    .tgm-collapse-left { display: flex; align-items: center; gap: 12px; }
    .tgm-collapse-left > svg:first-child { width: 18px; height: 18px; color: var(--tgm-accent); }
    .tgm-collapse-body { max-height: 0; overflow: hidden; transition: max-height .4s cubic-bezier(.2,.7,.2,1); }
    .tgm-collapse.open .tgm-collapse-body { max-height: 1200px; }
    .tgm-collapse-inner { padding: 0 20px 20px; font-size: 15px; color: var(--tgm-text-2); line-height: 1.6; }
    .tgm-collapse-inner p { margin: 0 0 12px; }
    .tgm-collapse-inner p:last-child { margin-bottom: 0; }
    .tgm-collapse-inner strong { color: var(--tgm-text); font-weight: 600; }

    .tgm-docs { display: flex; flex-direction: column; gap: 8px; }
    .tgm-doc { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); text-decoration: none; color: inherit; transition: all .15s; }
    .tgm-doc:hover { border-color: var(--tgm-accent); background: var(--tgm-bg-2); transform: translateX(2px); }
    .tgm-doc-icon { width: 36px; height: 36px; border-radius: var(--tgm-radius-sm); background: var(--tgm-bg-3); display: flex; align-items: center; justify-content: center; color: var(--tgm-primary); flex-shrink: 0; }
    .tgm-doc-icon svg { width: 18px; height: 18px; }
    .tgm-doc-info { flex: 1; min-width: 0; }
    .tgm-doc-name { font-size: 15px; font-weight: 500; color: var(--tgm-text); }
    .tgm-doc-meta { font-size: 13px; color: var(--tgm-text-3); }
    .tgm-doc-dl { width: 18px; height: 18px; color: var(--tgm-text-3); flex-shrink: 0; }

    .tgm-facilities { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .tgm-fac { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border-light); border-radius: 9999px; font-size: 13px; color: var(--tgm-text-2); }
    .tgm-fac svg { width: 13px; height: 13px; color: var(--tgm-success); }

    .tgm-subhead { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-3); margin: 16px 0 8px; }
    .tgm-subhead:first-child { margin-top: 0; }
    .tgm-kv { display: grid; grid-template-columns: minmax(120px, 30%) 1fr; gap: 8px 16px; font-size: 14px; }
    .tgm-kv dt { color: var(--tgm-text-3); font-weight: 500; }
    .tgm-kv dd { color: var(--tgm-text); margin: 0; font-variant-numeric: tabular-nums; }
    .tgm-fee-line { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; font-size: 14px; }
    .tgm-fee-line + .tgm-fee-line { border-top: 1px dashed var(--tgm-border-light); }
    .tgm-fee-line .name { color: var(--tgm-text-2); }
    .tgm-fee-line .name small { color: var(--tgm-text-3); display: block; font-size: 12px; margin-top: 2px; }
    .tgm-fee-line .val { font-weight: 600; color: var(--tgm-text); font-variant-numeric: tabular-nums; }
    .tgm-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .tgm-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: var(--tgm-bg-2); border: 1px solid var(--tgm-border-light); border-radius: 9999px; font-size: 13px; color: var(--tgm-text-2); }
    .tgm-chip svg { width: 13px; height: 13px; color: var(--tgm-text-3); }
    .tgm-pay-breakdown { padding: 12px 0; border-top: 1px dashed var(--tgm-border-light); margin-top: 8px; }
    .tgm-pay-breakdown .tgm-fee-line:first-child { padding-top: 0; }
    .tgm-pay-breakdown .tgm-fee-line:first-child + .tgm-fee-line { border-top: 1px dashed var(--tgm-border-light); }

    .tgm-flight-card { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); padding: 20px; margin-bottom: 16px; }
    .tgm-flight-card h3 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; margin: 0 0 16px; color: var(--tgm-text); letter-spacing: -.01em; }
    .tgm-flight-card h3 svg { color: var(--tgm-accent); }
    .tgm-flight-card h3 .tgm-flight-meta { margin-left: auto; font-size: 13px; font-weight: 400; color: var(--tgm-text-3); }
    .tgm-leg { padding: 16px 0; border-top: 1px solid var(--tgm-border-light); }
    .tgm-leg:first-of-type { border-top: none; padding-top: 0; }
    .tgm-leg-dir { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; background: var(--tgm-bg-2); border-radius: 9999px; font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-2); margin-bottom: 12px; }
    .tgm-leg-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tgm-leg-head .tgm-leg-dir { margin-bottom: 0; }
    .tgm-leg-head { margin-bottom: 12px; }
    .tgm-leg-date { font-size: 12px; font-weight: 600; color: var(--tgm-text-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .tgm-leg-plus { font-size: 11px; font-weight: 600; color: var(--tgm-accent); margin-left: 1px; }
    .tgm-inst.is-next { background: var(--tgm-bg-2); }
    .tgm-inst .tgm-inst-tag { font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--tgm-accent); margin-left: 8px; }
    .tgm-leg-route { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; }
    .tgm-leg-end { min-width: 0; }
    .tgm-leg-end.dest { text-align: right; }
    .tgm-leg-time { font-size: 22px; font-weight: 700; color: var(--tgm-text); letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.2; }
    .tgm-leg-iata { font-size: 13px; font-weight: 600; color: var(--tgm-text-2); margin-top: 2px; letter-spacing: .04em; }
    .tgm-leg-airport { font-size: 13px; color: var(--tgm-text-3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tgm-leg-line { display: flex; flex-direction: column; align-items: center; min-width: 100px; }
    .tgm-leg-line-dur { font-size: 11px; color: var(--tgm-text-3); margin-bottom: 10px; font-variant-numeric: tabular-nums; }
    .tgm-leg-line-bar { width: 100%; height: 2px; background: var(--tgm-border); position: relative; display: flex; align-items: center; justify-content: center; }
    .tgm-leg-line-bar::before, .tgm-leg-line-bar::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--tgm-accent); position: absolute; top: 50%; transform: translateY(-50%); }
    .tgm-leg-line-bar::before { left: 0; }
    .tgm-leg-line-bar::after { right: 0; }
    .tgm-leg-line-icon { background: var(--tgm-bg); padding: 0 6px; color: var(--tgm-accent); position: relative; z-index: 1; }
    .tgm-leg-stops { font-size: 11px; color: var(--tgm-text-3); margin-top: 10px; font-variant-numeric: tabular-nums; }
    .tgm-leg-meta { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--tgm-border-light); font-size: 13px; color: var(--tgm-text-2); }
    .tgm-leg-meta-item { display: inline-flex; align-items: center; gap: 6px; }
    .tgm-leg-meta-item svg { color: var(--tgm-text-3); }
    .tgm-leg-meta-item strong { color: var(--tgm-text); font-weight: 600; }

    .tgm-segs { padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--tgm-border-light); }
    .tgm-seg { display: grid; grid-template-columns: 60px 1fr 60px; gap: 12px; padding: 10px 0; align-items: center; font-size: 13px; }
    .tgm-seg + .tgm-seg { border-top: 1px dashed var(--tgm-border-light); }
    .tgm-seg-time { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--tgm-text); }
    .tgm-seg-iata { font-size: 11px; color: var(--tgm-text-3); }
    .tgm-seg-route { color: var(--tgm-text-2); }
    .tgm-seg-route strong { color: var(--tgm-text); font-weight: 600; }
    .tgm-seg-flight { font-size: 11px; color: var(--tgm-text-3); margin-top: 2px; }
    .tgm-stop-marker { padding: 8px 0 8px 12px; font-size: 12px; color: var(--tgm-text-3); border-left: 2px solid var(--tgm-border); margin-left: 26px; font-style: italic; }

    @media (max-width: 480px) {
      .tgm-leg-route { grid-template-columns: 1fr; gap: 12px; }
      .tgm-leg-end.dest { text-align: left; }
      .tgm-leg-line { transform: rotate(90deg); height: 24px; min-width: 0; width: 24px; align-self: center; }
    }

    .tgm-extra-card { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-lg); padding: 20px; margin-bottom: 16px; }
    .tgm-extra-head { display: flex; align-items: flex-start; gap: 16px; }
    .tgm-extra-icon { width: 44px; height: 44px; border-radius: var(--tgm-radius-md); background: var(--tgm-bg-2); display: flex; align-items: center; justify-content: center; color: var(--tgm-primary); flex-shrink: 0; }
    .tgm-extra-info { flex: 1; min-width: 0; }
    .tgm-extra-kind { font-size: 11px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--tgm-text-3); }
    .tgm-extra-name { font-size: 18px; font-weight: 600; color: var(--tgm-text); margin: 2px 0 4px; letter-spacing: -.01em; }
    .tgm-extra-sub { font-size: 13px; color: var(--tgm-text-2); }
    .tgm-extra-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--tgm-border-light); font-size: 13px; color: var(--tgm-text-2); }
    .tgm-extra-meta-item { display: inline-flex; align-items: center; gap: 6px; }
    .tgm-extra-meta-item strong { color: var(--tgm-text); font-weight: 600; }

    .tgm-help { background: linear-gradient(135deg, var(--tgm-primary) 0%, var(--tgm-primary-dark) 100%); color: #fff; padding: 20px; border-radius: var(--tgm-radius-lg); display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 24px; }
    .tgm-help h3 { font-size: 16px; font-weight: 600; margin: 0 0 4px; letter-spacing: -.01em; color: #fff; }
    .tgm-help p { font-size: 13px; color: rgba(248,250,252,.78); margin: 0; }
    .tgm-help-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .tgm-help-btn { padding: 8px 16px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); color: #fff; font-size: 13px; font-weight: 500; border-radius: var(--tgm-radius-md); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; transition: background .15s; }
    .tgm-help-btn:hover { background: rgba(255,255,255,.18); }
    .tgm-help-btn svg { width: 14px; height: 14px; }

    .tgm-h-eyebrow { font-size: 16px; font-weight: 600; margin: 32px 0 12px; color: var(--tgm-text); letter-spacing: -.01em; }

    /* ===== NOT FOUND ===== */
    .tgm-nf { background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-2xl); padding: 48px 32px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,.06), 0 2px 4px rgba(0,0,0,.04); max-width: 560px; margin: 0 auto; }
    .tgm-nf-icon { width: 64px; height: 64px; margin: 0 auto 20px; background: var(--tgm-bg-3); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--tgm-text-3); }
    .tgm-nf-icon svg { width: 28px; height: 28px; }
    .tgm-nf h2 { font-size: 22px; font-weight: 600; margin: 0 0 8px; letter-spacing: -.01em; color: var(--tgm-text); }
    .tgm-nf p { font-size: 15px; color: var(--tgm-text-2); max-width: 48ch; margin: 0 auto 24px; line-height: 1.6; }
    .tgm-nf-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .tgm-btn-2 { height: 44px; padding: 0 20px; background: var(--tgm-bg); border: 1px solid var(--tgm-border); border-radius: var(--tgm-radius-md); font-family: inherit; font-size: 15px; font-weight: 500; color: var(--tgm-text); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; transition: all .15s; }
    .tgm-btn-2:hover { border-color: var(--tgm-accent); }
    .tgm-btn-1 { height: 44px; padding: 0 20px; background: var(--tgm-primary); border: 1px solid var(--tgm-primary); border-radius: var(--tgm-radius-md); font-family: inherit; font-size: 15px; font-weight: 500; color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; transition: all .15s; }
    .tgm-btn-1:hover { background: var(--tgm-primary-light); }
    .tgm-btn-1 svg, .tgm-btn-2 svg { width: 16px; height: 16px; }

    @media (max-width: 480px) {
      .tgm-hero { height: 320px; }
      .tgm-hero-name { font-size: 24px; }
      .tgm-hero-content { padding: 20px; }
      .tgm-hero-thumbs { display: none; }
      .tgm-form-title { font-size: 24px; }
      .tgm-form-hero { padding: 32px 20px 24px; }
      .tgm-form-body { padding: 20px; }
      .tgm-section, .tgm-stay { padding: 16px; }
      .tgm-toast-stack { left: 16px; right: 16px; max-width: none; }
      .tgm-toast { min-width: 0; }
    }

    /* ─── Narrow-container layout (Luna chat embed, < 440px container width) ───
       Container-driven, not viewport-driven. Applied via JS when ResizeObserver
       detects the widget's container dropping below the threshold. Mirrors the
       existing @media (max-width: 480/760/780px) rules so a narrow embed on a
       wide viewport gets the same stacked treatment a mobile viewport does. */
    .tgm-root.tgm-narrow .tgm-hero { height: 220px; border-radius: var(--tgm-radius-xl); margin-bottom: 12px; }
    .tgm-root.tgm-narrow .tgm-hero-content { padding: 16px; }
    .tgm-root.tgm-narrow .tgm-hero-name { font-size: 22px; line-height: 1.1; }
    .tgm-root.tgm-narrow .tgm-hero-loc { font-size: 13px; }
    .tgm-root.tgm-narrow .tgm-hero-thumbs { display: none; }
    .tgm-root.tgm-narrow .tgm-hero-rating { gap: 6px; }
    .tgm-root.tgm-narrow .tgm-review-chip { font-size: 11px; padding: 3px 8px; }
    .tgm-root.tgm-narrow .tgm-atol { font-size: 10px; padding: 4px 10px; }
    .tgm-root.tgm-narrow .tgm-atol .tgm-atol-op { display: none; }

    .tgm-root.tgm-narrow .tgm-greeting { flex-direction: column; align-items: flex-start; padding: 14px 16px; gap: 8px; }
    .tgm-root.tgm-narrow .tgm-greeting-text { font-size: 14px; line-height: 1.4; }

    .tgm-root.tgm-narrow .tgm-action-row { grid-template-columns: 1fr; gap: 10px; margin-bottom: 14px; }
    .tgm-root.tgm-narrow .tgm-action { padding: 12px 14px; gap: 12px; }
    .tgm-root.tgm-narrow .tgm-action-icon { width: 36px; height: 36px; }
    .tgm-root.tgm-narrow .tgm-action-icon svg { width: 16px; height: 16px; }
    .tgm-root.tgm-narrow .tgm-action-arrow { display: none; }
    .tgm-root.tgm-narrow .tgm-action-title { font-size: 14px; }
    .tgm-root.tgm-narrow .tgm-action-sub { font-size: 11px; }

    .tgm-root.tgm-narrow .tgm-stay { padding: 16px; }
    .tgm-root.tgm-narrow .tgm-stay h3 { font-size: 15px; flex-wrap: wrap; }
    .tgm-root.tgm-narrow .tgm-stay h3 .tgm-stay-meta { margin-left: 0; flex-basis: 100%; margin-top: 2px; font-size: 12px; }
    .tgm-root.tgm-narrow .tgm-stay-grid { grid-template-columns: 1fr 1fr; gap: 14px 12px; }
    .tgm-root.tgm-narrow .tgm-stay-cell { padding: 0; border-right: none; }
    .tgm-root.tgm-narrow .tgm-stay-cell:nth-child(odd) { border-right: 1px solid var(--tgm-border-light); padding-right: 12px; }
    .tgm-root.tgm-narrow .tgm-stay-value { font-size: 16px; }
    .tgm-root.tgm-narrow .tgm-stay-sub { font-size: 12px; }

    .tgm-root.tgm-narrow .tgm-two { grid-template-columns: 1fr; gap: 12px; }
    .tgm-root.tgm-narrow .tgm-section { padding: 16px; }
    .tgm-root.tgm-narrow .tgm-section h3 { font-size: 15px; }
    .tgm-root.tgm-narrow .tgm-pay-total-amt { font-size: 22px; }

    .tgm-root.tgm-narrow .tgm-leg-route { grid-template-columns: 1fr; gap: 12px; }
    .tgm-root.tgm-narrow .tgm-leg-end.dest { text-align: left; }
    .tgm-root.tgm-narrow .tgm-leg-line { transform: rotate(90deg); height: 24px; min-width: 0; width: 24px; align-self: center; }
    .tgm-root.tgm-narrow .tgm-seg { grid-template-columns: 48px 1fr 48px; gap: 8px; font-size: 12px; }
    .tgm-root.tgm-narrow .tgm-kv { grid-template-columns: 1fr; gap: 4px 0; font-size: 13px; }
    .tgm-root.tgm-narrow .tgm-kv > div + div { margin-top: 8px; }

    .tgm-root.tgm-narrow .tgm-pdf-viewer-frame { height: 600px; }

    .tgm-root.tgm-narrow .tgm-modal { padding: 0; align-items: flex-end; }
    .tgm-root.tgm-narrow .tgm-modal-card { max-width: 100%; width: 100%; border-radius: var(--tgm-radius-xl) var(--tgm-radius-xl) 0 0; max-height: 92vh; }
  `;

  // ----- Templates -----

  function renderForm(c, state, prefill) {
    const layout = c.layout || 'vertical';
    if (layout === 'horizontal' || layout === 'compact') {
      return renderFormHorizontal(c, state, layout === 'compact', prefill);
    }
    return renderFormVertical(c, state, prefill);
  }

  function renderFormVertical(c, state, prefill) {
    const errMsg = state && state.error
      ? '<div class="tgm-error-msg" role="alert">' + svg(IC.info) + esc(state.error) + '</div>'
      : '';
    // Pre-fill values come either from a prior failed attempt (so the customer
    // can correct one typo instead of retyping everything) or are blank on
    // first render. Always run through esc() before injection.
    const valEmail = prefill?.email ? esc(prefill.email) : '';
    const valDate  = prefill?.date  ? esc(prefill.date)  : '';
    const valRef   = prefill?.ref   ? esc(prefill.ref)   : '';
    return `
      <div class="tgm-form">
        <div class="tgm-hero-form">
          <span class="tgm-eyebrow"><span class="tgm-eyebrow-dot"></span>${esc(c.eyebrow || c.t('eyebrow'))}</span>
          <h1 class="tgm-form-title">${esc(c.title || c.t('title'))}</h1>
          <p class="tgm-form-sub">${esc(c.subtitle || c.t('subtitle'))}</p>
        </div>
        <form class="tgm-form-body" data-tgm-form>
          <div class="tgm-field">
            <label class="tgm-label" for="tgm-email">${esc(c.labels?.email || c.t('email'))}</label>
            <div class="tgm-input-wrap">
              ${svg(IC.mail)}
              <input type="email" class="tgm-input" id="tgm-email" name="email" placeholder="you@example.com" autocomplete="email" value="${valEmail}" required>
            </div>
          </div>
          <div class="tgm-field">
            <label class="tgm-label" for="tgm-date">${esc(c.labels?.date || c.t('date'))}</label>
            <div class="tgm-input-wrap">
              ${svg(IC.cal)}
              <input type="date" class="tgm-input" id="tgm-date" name="date" value="${valDate}" required>
            </div>
          </div>
          <div class="tgm-field">
            <label class="tgm-label" for="tgm-ref">${esc(c.labels?.ref || c.t('ref'))}</label>
            <div class="tgm-input-wrap">
              ${svg(IC.ref)}
              <input type="text" class="tgm-input code" id="tgm-ref" name="ref" placeholder="${esc(c.labels?.refPlaceholder || c.t('refPlaceholder'))}" autocomplete="off" value="${valRef}" required>
            </div>
          </div>
          <button type="submit" class="tgm-cta" data-tgm-submit>${esc(c.labels?.submit || c.t('submit'))}${svg(IC.arrow)}</button>
          <div class="tgm-trust">${svg(IC.shield)}${esc(c.labels?.trust || c.t('trust'))}</div>
          ${errMsg}
        </form>
      </div>
    `;
  }

  function renderFormHorizontal(c, state, isCompact, prefill) {
    const errMsg = state && state.error
      ? '<div class="tgm-error-msg" role="alert" style="margin-top:16px; background:rgba(255,255,255,.08); border-color:rgba(239,68,68,.4); color:#fca5a5;">' + svg(IC.info) + esc(state.error) + '</div>'
      : '';
    const valEmail = prefill?.email ? esc(prefill.email) : '';
    const valDate  = prefill?.date  ? esc(prefill.date)  : '';
    const valRef   = prefill?.ref   ? esc(prefill.ref)   : '';
    return `
      <div class="tgm-hform${isCompact ? ' compact' : ''}">
        <div class="tgm-hform-top">
          <div class="tgm-hform-heading">
            <div class="tgm-hform-icon">${svg(IC.booking)}</div>
            <div>
              <h2 class="tgm-hform-title">${esc(c.title || c.t('title'))}</h2>
              <p class="tgm-hform-sub">${esc(c.subtitleShort || c.t('subtitleShort'))}</p>
            </div>
          </div>
          ${!isCompact ? `<span class="tgm-hform-trust">${svg(IC.shield)}${esc(c.labels?.trustShort || c.t('trustShort'))}</span>` : ''}
        </div>
        <form class="tgm-hform-row" data-tgm-form>
          <div class="tgm-hform-field">
            <label>${esc(c.labels?.email || c.t('email'))}</label>
            <div class="tgm-hform-iw">${svg(IC.mail)}
              <input type="email" class="tgm-hform-input" name="email" placeholder="you@example.com" autocomplete="email" value="${valEmail}" required>
            </div>
          </div>
          <div class="tgm-hform-field">
            <label>${esc(c.labels?.date || c.t('date'))}</label>
            <div class="tgm-hform-iw">${svg(IC.cal)}
              <input type="date" class="tgm-hform-input" name="date" value="${valDate}" required>
            </div>
          </div>
          <div class="tgm-hform-field">
            <label>${esc(c.labels?.refShort || c.t('refShort'))}</label>
            <div class="tgm-hform-iw">${svg(IC.ref)}
              <input type="text" class="tgm-hform-input" name="ref" placeholder="${esc(c.labels?.refPlaceholder || c.t('refPlaceholder'))}" style="letter-spacing:.04em; font-variant-numeric:tabular-nums;" autocomplete="off" value="${valRef}" required>
            </div>
          </div>
          <button type="submit" class="tgm-hform-cta" data-tgm-submit>${esc(c.labels?.submitShort || c.t('submitShort'))}${svg(IC.arrow, 2.5)}</button>
        </form>
        ${errMsg}
      </div>
    `;
  }

  function renderLoading(c) {
    return `
      <div class="tgm-loading" role="status" aria-live="polite">
        <div class="tgm-spinner" aria-hidden="true"></div>
        <h2>${esc(c.labels?.loadingTitle || c.t('loadingTitle'))}</h2>
        <p>${esc(c.labels?.loadingSub || c.t('loadingSub'))}</p>
      </div>
    `;
  }

  function renderNotFound(c) {
    return `
      <div class="tgm-nf">
        <div class="tgm-nf-icon">${svg(IC.search)}</div>
        <h2>${esc(c.labels?.nfTitle || c.t('nfTitle'))}</h2>
        <p>${esc(c.labels?.nfBody || c.t('nfBody'))}</p>
        <div class="tgm-nf-actions">
          <button type="button" class="tgm-btn-2" data-tgm-tryagain>${svg(IC.refresh)}${esc(c.labels?.nfRetry || c.t('nfRetry'))}</button>
          ${c.support?.email ? `<a class="tgm-btn-1" href="mailto:${esc(c.support.email)}">${svg(IC.mail)}${esc(c.labels?.nfContact || c.t('nfContact'))}</a>` : ''}
        </div>
      </div>
    `;
  }

  function renderFlightCard(item, c) {
    const f = item.flights;
    if (!f || !Array.isArray(f.routes) || f.routes.length === 0) return '';

    const carrierNames = new Set();
    for (const r of f.routes) {
      for (const s of r.segments || []) {
        if (s.marketingCarrier?.name) carrierNames.add(s.marketingCarrier.name);
      }
    }
    const carrierSummary = Array.from(carrierNames).slice(0, 3).join(', ');

    const fareInfo = Array.isArray(f.fareInformation) ? f.fareInformation : [];
    // Cancellation terms arriving as flight fare information must not leak
    // into "Fare conditions" when either the "Cancellation policy" toggle
    // (showCancellation — the dedicated info toggle) or the "Online
    // cancellation" toggle (showCancel — hiding the action hides the info
    // too) is off.
    const hideCancel = c.display?.showCancellation === false || c.display?.showCancel === false;
    const meaningfulFareInfo = fareInfo.filter(fi => {
      if (!fi.title || !fi.text) return false;
      if ((fi.type || '').toLowerCase() === 'farebasis') return false;
      if (/fare\s*basis/i.test(fi.title)) return false;
      if (hideCancel && (/cancel/i.test(fi.title) || /cancel/i.test(fi.type || ''))) return false;
      return true;
    });

    return `
      <div class="tgm-flight-card">
        <h3>${svg(IC.plane)}${esc(c.labels?.flights || c.t('flights'))}${
          carrierSummary
            ? `<span class="tgm-flight-meta">${esc(carrierSummary)}</span>`
            : ''
        }</h3>
        ${f.routes.map(route => renderFlightLeg(route, c)).join('')}
        ${meaningfulFareInfo.length ? `
          <div class="tgm-collapse" style="margin-top:16px; margin-bottom:0;">
            <button class="tgm-collapse-trig" type="button" aria-expanded="false">
              <div class="tgm-collapse-left">${svg(IC.info)}${esc(c.labels?.fareConditions || c.t('fareConditions'))}</div>
              ${svg(IC.chev)}
            </button>
            <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
              <dl class="tgm-kv">
                ${meaningfulFareInfo.map(fi => `
                  <dt>${esc(fi.title)}</dt>
                  <dd>${esc(fi.text)}</dd>
                `).join('')}
              </dl>
            </div></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderFlightLeg(route, c) {
    const t = (k, v) => (c && c.t ? c.t(k, v) : k);
    const segs = route.segments || [];
    if (segs.length === 0) return '';

    const first = segs[0];
    const last = segs[segs.length - 1];
    const stops = segs.length - 1;

    // Baggage can sit on any segment, not only the first.
    const bagSeg = segs.find(s => s.baggage && (s.baggage.allowance || s.baggage.weight));
    const baggage = bagSeg ? (bagSeg.baggage.allowance || bagSeg.baggage.weight) : '';
    const cabin = first.cabinClass || '';
    const fareName = first.fareName || '';

    // Flight number(s), e.g. "BA2629". Skip values that already carry a letter
    // prefix (avoid "BABA2629"); de-duplicate across segments.
    const flightNos = [];
    for (const s of segs) {
      const no = (s.flightNo || '').toString().trim();
      if (!no) continue;
      const code = (s.marketingCarrier?.code || '').toString().trim();
      const label = /[A-Za-z]/.test(no) ? no : (code ? code + no : no);
      if (label && !flightNos.includes(label)) flightNos.push(label);
    }
    const flightNoLabel = flightNos.join(' · ');

    const flightMins = segs.reduce((acc, s) => acc + (typeof s.duration === 'number' ? s.duration : 0), 0);

    // Leg date + overnight offset (arrival on a later calendar day → "+1").
    const legDate = first.depart ? fmtDate(first.depart) : '';
    let dayOffset = 0;
    const d0 = first.depart ? new Date(first.depart) : null;
    const d1 = last.arrive ? new Date(last.arrive) : null;
    if (d0 && d1 && !isNaN(d0.getTime()) && !isNaN(d1.getTime())) {
      const diff = Math.round((Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate())
        - Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate())) / 86400000);
      if (diff > 0) dayOffset = diff;
    }

    return `
      <div class="tgm-leg">
        <div class="tgm-leg-head">
          <span class="tgm-leg-dir">${esc(route.direction || t('flight'))}</span>
          ${legDate ? `<span class="tgm-leg-date">${esc(legDate)}</span>` : ''}
        </div>
        <div class="tgm-leg-route">
          <div class="tgm-leg-end">
            <div class="tgm-leg-time">${esc(fmtTime(first.depart))}</div>
            <div class="tgm-leg-iata">${esc(first.origin?.iataCode || '')}${first.origin?.terminal ? ` · T${esc(first.origin.terminal)}` : ''}</div>
            <div class="tgm-leg-airport" title="${esc(first.origin?.name || '')}">${esc(first.origin?.name || '')}</div>
          </div>
          <div class="tgm-leg-line">
            <div class="tgm-leg-line-dur">${esc(fmtDuration(flightMins))}</div>
            <div class="tgm-leg-line-bar"><span class="tgm-leg-line-icon">${svg(IC.plane, 2, 14)}</span></div>
            <div class="tgm-leg-stops">${stops === 0 ? esc(t('direct')) : `${stops} ${esc(stops === 1 ? t('stop') : t('stops'))}`}</div>
          </div>
          <div class="tgm-leg-end dest">
            <div class="tgm-leg-time">${esc(fmtTime(last.arrive))}${dayOffset > 0 ? `<sup class="tgm-leg-plus">+${dayOffset}</sup>` : ''}</div>
            <div class="tgm-leg-iata">${esc(last.destination?.iataCode || '')}${last.destination?.terminal ? ` · T${esc(last.destination.terminal)}` : ''}</div>
            <div class="tgm-leg-airport" title="${esc(last.destination?.name || '')}">${esc(last.destination?.name || '')}</div>
          </div>
        </div>
        <div class="tgm-leg-meta">
          ${flightNoLabel ? `<span class="tgm-leg-meta-item">${svg(IC.plane, 2, 14)}<span>${esc(flightNoLabel)}</span></span>` : ''}
          ${cabin ? `<span class="tgm-leg-meta-item">${svg(IC.user, 2, 14)}<span><strong>${esc(cabin)}</strong>${fareName ? ` · ${esc(fareName)}` : ''}</span></span>` : ''}
          ${baggage ? `<span class="tgm-leg-meta-item">${svg(IC.bag, 2, 14)}<span>${esc(baggage)}</span></span>` : ''}
        </div>
        ${stops > 0 ? renderSegmentDetail(segs, c) : ''}
      </div>
    `;
  }

  function renderSegmentDetail(segs, c) {
    const t = (k, v) => (c && c.t ? c.t(k, v) : k);
    let html = '<div class="tgm-segs">';
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      html += `
        <div class="tgm-seg">
          <div>
            <div class="tgm-seg-time">${esc(fmtTime(s.depart))}</div>
            <div class="tgm-seg-iata">${esc(s.origin?.iataCode || '')}</div>
          </div>
          <div class="tgm-seg-route">
            <strong>${esc(s.marketingCarrier?.code || '')}${esc(s.flightNo || '')}</strong>
            ${s.marketingCarrier?.name ? ` · ${esc(s.marketingCarrier.name)}` : ''}
            <div class="tgm-seg-flight">${esc(fmtDuration(s.duration))}${s.aircraft ? ` · ${esc(t('aircraft'))} ${esc(s.aircraft)}` : ''}</div>
          </div>
          <div style="text-align:right">
            <div class="tgm-seg-time">${esc(fmtTime(s.arrive))}</div>
            <div class="tgm-seg-iata">${esc(s.destination?.iataCode || '')}</div>
          </div>
        </div>
      `;
      if (i < segs.length - 1) {
        const nextDep = Date.parse(segs[i + 1].depart || '');
        const thisArr = Date.parse(s.arrive || '');
        const gapMin = (Number.isFinite(nextDep) && Number.isFinite(thisArr))
          ? Math.round((nextDep - thisArr) / 60000)
          : 0;
        html += `
          <div class="tgm-stop-marker">
            ${gapMin > 0 ? esc(t('stopoverInTimed', { dur: fmtDuration(gapMin), iata: s.destination?.iataCode || '' })) : esc(t('stopoverIn', { iata: s.destination?.iataCode || '' }))}
          </div>
        `;
      }
    }
    html += '</div>';
    return html;
  }

  function renderExtraCard(item, c) {
    const e = item.airportExtras;
    if (!e) return '';

    // Travelify exposes a finite set of airport-extra types. The label here
    // is the visible "kind" pill above the extra's name. A hotel sold as an
    // airport extra (e.g. pre-flight overnight) must NOT just say "Hotel" —
    // that's visually identical to a main Accommodation card and confuses
    // customers about which booking they're looking at.
    const kindLabel = e.type === 'Lounge'    ? 'Airport lounge'
      : e.type === 'Transfer'                ? 'Airport transfer'
      : e.type === 'Parking'                 ? 'Airport parking'
      : e.type === 'Hotel'                   ? 'Airport hotel'
      : e.type === 'FastTrack'               ? 'Fast track'
      : e.type === 'Wifi'                    ? 'Airport Wi-Fi'
      : e.type === 'CarHire'                 ? 'Car hire'
      : (e.type || 'Airport extra');

    // Icon also keys off the type — bag is the catch-all but hotel deserves
    // a bed icon and car hire its own glyph if we ever add one.
    const icon = e.type === 'Lounge'   ? IC.lounge
      : e.type === 'Transfer'          ? IC.plane
      : e.type === 'Hotel'             ? IC.bed
      : IC.bag;

    const airport = e.location?.iataCode || '';
    const terminal = e.location?.terminal ? `T${e.location.terminal}` : '';
    const startTime = fmtTime(e.startDateTime);
    const endTime = fmtTime(e.endDateTime);
    const dateLabel = e.startDateTime ? fmtDate(e.startDateTime, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

    const descByType = (type) => (e.descriptions || []).find(d => d.type === type);
    const descByTitle = (title) => (e.descriptions || []).find(d => d.title === title);
    const fullDesc = descByType('Generic')?.text || descByTitle('Description')?.text || '';
    const openingTimes = descByType('OpeningTimes')?.text || descByTitle('Opening times')?.text || '';
    const dressCode = descByType('DressCode')?.text || descByTitle('Dress code')?.text || '';
    const drinks = (e.descriptions || []).find(d => /drinks?/i.test(d.title || ''))?.text || '';
    const food = (e.descriptions || []).find(d => /food|dining|cuisine/i.test(d.title || ''))?.text || '';
    const announcements = (e.descriptions || []).find(d => /announcement/i.test(d.title || ''))?.text || '';

    // Map known Travelify feature codes to friendly labels. The dictionary
    // grows as we encounter new codes — anything unmapped falls through to
    // splitPascalCase() below so we never display 'ParkAndRide' raw.
    const featureLabels = {
      // Lounges
      FreeDrinks: 'Drinks included',
      FreeFood: 'Food included',
      WiFi: 'Wi-fi',
      TV: 'TV',
      ChildrenAllowed: 'Children welcome',
      Newspapers: 'Newspapers',
      Showers: 'Showers',
      QuietZone: 'Quiet zone',
      Workspace: 'Workspace',
      // Parking
      ParkAndRide: 'Park and ride',
      ValetParking: 'Valet parking',
      MeetAndGreet: 'Meet and greet',
      OnAirport: 'On-airport',
      OffAirport: 'Off-airport',
      Shuttle: 'Shuttle included',
      DisabledAccess: 'Disabled access',
      ElectricCharging: 'Electric charging',
      CCTV: 'CCTV',
      Secured: 'Secured',
      // Transfer / hotel / shared
      CovidSecure: 'Covid-secure',
      AirConditioning: 'Air conditioning',
      Breakfast: 'Breakfast included',
      FreeCancellation: 'Free cancellation',
      FastTrack: 'Fast track',
      PriorityBoarding: 'Priority boarding',
      LuggageStorage: 'Luggage storage',
    };
    // Fallback for unmapped codes: split PascalCase / camelCase into words.
    // 'ParkAndRide' -> 'Park And Ride', 'fastTrack' -> 'Fast Track'. Final
    // 'And'/'Or' get lowercased to read naturally.
    const splitPascalCase = (s) => {
      if (!s || typeof s !== 'string') return s;
      const words = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_+/g, ' ').trim().split(/\s+/);
      return words.map((w, i) => {
        if (i > 0 && /^(and|or|of|the|to|in|on|at|by|for)$/i.test(w)) return w.toLowerCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(' ');
    };
    const features = (e.features || []).map(f => featureLabels[f] || splitPascalCase(f));

    const hasDetails = fullDesc || openingTimes || dressCode || drinks || food || announcements || features.length;

    return `
      <div class="tgm-extra-card">
        <div class="tgm-extra-head">
          <div class="tgm-extra-icon">${svg(icon, 2, 22)}</div>
          <div class="tgm-extra-info">
            <div class="tgm-extra-kind">${esc(kindLabel)}</div>
            <div class="tgm-extra-name">${esc(e.name || 'Airport extra')}</div>
            ${e.subTitle ? `<div class="tgm-extra-sub">${esc(e.subTitle)}</div>` : ''}
          </div>
        </div>
        <div class="tgm-extra-meta">
          ${airport ? `<span class="tgm-extra-meta-item">${svg(IC.pin, 2, 14)}<span><strong>${esc(airport)}</strong>${terminal ? ` · ${esc(terminal)}` : ''}</span></span>` : ''}
          ${dateLabel ? `<span class="tgm-extra-meta-item">${svg(IC.cal, 2, 14)}<span>${esc(dateLabel)}</span></span>` : ''}
          ${startTime ? `<span class="tgm-extra-meta-item">${svg(IC.clock, 2, 14)}<span>${esc(startTime)}${endTime ? ` – ${esc(endTime)}` : ''}</span></span>` : ''}
        </div>
        ${hasDetails ? `
          <div class="tgm-collapse" style="margin-top:16px; margin-bottom:0;">
            <button class="tgm-collapse-trig" type="button" aria-expanded="false">
              <div class="tgm-collapse-left">${svg(IC.info)}${esc(c.labels?.whatToExpect || c.t('whatToExpect'))}</div>
              ${svg(IC.chev)}
            </button>
            <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
              ${fullDesc ? `<p>${esc(fullDesc.slice(0, 800))}${fullDesc.length > 800 ? '…' : ''}</p>` : ''}

              ${(openingTimes || dressCode) ? `
                <div class="tgm-subhead">${esc(c.labels?.atAGlance || c.t('atAGlance'))}</div>
                <dl class="tgm-kv">
                  ${openingTimes ? `<dt>${esc(c.labels?.openingTimes || c.t('openingTimes'))}</dt><dd>${esc(openingTimes)}</dd>` : ''}
                  ${dressCode ? `<dt>${esc(c.labels?.dressCode || c.t('dressCode'))}</dt><dd>${esc(dressCode)}</dd>` : ''}
                </dl>
              ` : ''}

              ${(drinks || food) ? `
                <div class="tgm-subhead">${esc(c.labels?.included || c.t('included'))}</div>
                ${drinks ? `<p><strong>${esc(c.labels?.drinks || c.t('drinks'))}:</strong> ${esc(drinks)}</p>` : ''}
                ${food ? `<p><strong>${esc(c.labels?.food || c.t('food'))}:</strong> ${esc(food)}</p>` : ''}
              ` : ''}

              ${announcements ? `
                <div class="tgm-subhead">${esc(c.labels?.flightAnnouncements || c.t('flightAnnouncements'))}</div>
                <p>${esc(announcements)}</p>
              ` : ''}

              ${features.length ? `
                <div class="tgm-subhead">${esc(c.labels?.features || c.t('features'))}</div>
                <div class="tgm-chips">${features.map(f => `<span class="tgm-chip">${svg(IC.check)}${esc(f)}</span>`).join('')}</div>
              ` : ''}
            </div></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Format a duration in minutes ("360" → "6h", "90" → "1h 30m", "45" → "45m")
  function fmtDurationMinutes(mins) {
    if (typeof mins !== 'number' || !Number.isFinite(mins) || mins <= 0) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  // Format a location point's name (with airport IATA code in brackets if relevant)
  // — used for transfers and car hire pickup/dropoff labels.
  function fmtLocationLabel(p) {
    if (!p) return '';
    if (p.iataCode && p.onAirport) {
      // 'Paris, France (ORY-Orly)' already contains the code; don't double it.
      return p.name && p.name.toUpperCase().includes(p.iataCode.toUpperCase())
        ? p.name
        : `${p.name || ''} (${p.iataCode})`.trim();
    }
    return p.name || p.address1 || '';
  }

  // -------- Transfers --------
  // Renders a transfer product card (Hoppa, Holiday Taxis, etc).
  // Shows route, vehicle, journey time, and an expandable details section
  // for important info / cancellation policy.
  function renderTransferCard(item, c) {
    const t = item.transfers;
    if (!t) return '';

    const outDate = fmtDate(t.outPickup?.dateTime, { day: 'numeric', month: 'short', year: 'numeric' });
    const outTime = fmtTime(t.outPickup?.dateTime);
    const returnDate = t.returnPickup?.dateTime
      ? fmtDate(t.returnPickup.dateTime, { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    const returnTime = t.returnPickup?.dateTime ? fmtTime(t.returnPickup.dateTime) : '';

    const fromLabel = fmtLocationLabel(t.outPickup);
    const toLabel = fmtLocationLabel(t.outDropoff);

    const importantInfo = (t.information || []).find(i => i.type === 'Generic' || /important/i.test(i.title || ''));
    const cancelInfo = (t.information || []).find(i => i.type === 'CancelAndAmendments' || /cancel/i.test(i.title || ''));
    const hasDetails = !!(importantInfo?.text || cancelInfo?.text);

    // Occupancy / bag summary chips
    const chips = [];
    if (t.maxOccupancy) chips.push(`${t.maxOccupancy} ${t.maxOccupancy === 1 ? 'passenger' : 'passengers'}`);
    if (t.bigBagAllowance) chips.push(`${t.bigBagAllowance} large ${t.bigBagAllowance === 1 ? 'bag' : 'bags'}`);
    if (t.smallBagAllowance) chips.push(`${t.smallBagAllowance} small ${t.smallBagAllowance === 1 ? 'bag' : 'bags'}`);

    return `
      <div class="tgm-extra-card">
        <div class="tgm-extra-head">
          <div class="tgm-extra-icon">${svg(IC.van, 2, 22)}</div>
          <div class="tgm-extra-info">
            <div class="tgm-extra-kind">${esc(c.labels?.transfer || c.t('transfer'))}${t.type ? ' · ' + esc(t.type) : ''}</div>
            <div class="tgm-extra-name">${esc([fromLabel, toLabel].filter(Boolean).join(' → ') || t.vehicle || 'Transfer')}</div>
            ${t.vehicle ? `<div class="tgm-extra-sub">${esc(t.vehicle)}${t.company ? ' · ' + esc(t.company) : ''}</div>` : ''}
          </div>
        </div>
        <div class="tgm-extra-meta">
          ${outDate ? `<span class="tgm-extra-meta-item">${svg(IC.cal, 2, 14)}<span><strong>${esc(c.labels?.outbound || c.t('outbound'))}:</strong> ${esc(outDate)}${outTime ? ` · ${esc(outTime)}` : ''}</span></span>` : ''}
          ${returnDate ? `<span class="tgm-extra-meta-item">${svg(IC.cal, 2, 14)}<span><strong>${esc(c.labels?.return || c.t('return'))}:</strong> ${esc(returnDate)}${returnTime ? ` · ${esc(returnTime)}` : ''}</span></span>` : ''}
          ${t.journeyDuration ? `<span class="tgm-extra-meta-item">${svg(IC.clock, 2, 14)}<span>${esc(t.journeyDuration)}${t.journeyDistance ? ` · ${esc(t.journeyDistance)}` : ''}</span></span>` : ''}
        </div>
        ${chips.length ? `<div class="tgm-chips" style="margin-top:8px;">${chips.map(c => `<span class="tgm-chip">${svg(IC.check)}${esc(c)}</span>`).join('')}</div>` : ''}
        ${hasDetails ? `
          <div class="tgm-collapse" style="margin-top:16px; margin-bottom:0;">
            <button class="tgm-collapse-trig" type="button" aria-expanded="false">
              <div class="tgm-collapse-left">${svg(IC.info)}${esc(c.labels?.transferInfo || c.t('transferInfo'))}</div>
              ${svg(IC.chev)}
            </button>
            <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
              ${importantInfo?.text ? `<p>${esc(importantInfo.text)}</p>` : ''}
              ${cancelInfo?.text ? `
                <div class="tgm-subhead">${esc(c.labels?.cancellation || c.t('cancellation'))}</div>
                <p>${esc(cancelInfo.text)}</p>
              ` : ''}
            </div></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // -------- Car Rental --------
  // Renders a car rental card. Shows vehicle, pickup/dropoff, spec chips
  // (transmission/seats/doors/luggage), inclusions and a collapsible info
  // section for fuel/mileage/deposit/driver policies.
  function renderCarRentalCard(item, c) {
    const cr = item.carRental;
    if (!cr) return '';

    const pickupDate = fmtDate(cr.pickup?.dateTime, { day: 'numeric', month: 'short', year: 'numeric' });
    const pickupTime = fmtTime(cr.pickup?.dateTime);
    const dropoffDate = fmtDate(cr.dropoff?.dateTime, { day: 'numeric', month: 'short', year: 'numeric' });
    const dropoffTime = fmtTime(cr.dropoff?.dateTime);
    const pickupLabel = fmtLocationLabel(cr.pickup);
    const dropoffLabel = fmtLocationLabel(cr.dropoff);
    const sameLocation = cr.pickup?.name && cr.dropoff?.name && cr.pickup.name === cr.dropoff.name;

    // Spec chips — transmission / seats / doors / luggage etc.
    const specs = [];
    if (cr.transmission) specs.push(cr.transmission);
    if (cr.seats) specs.push(`${cr.seats} seats`);
    if (cr.doors) specs.push(`${cr.doors} doors`);
    if (cr.luggageLarge) specs.push(`${cr.luggageLarge} large ${cr.luggageLarge === 1 ? 'bag' : 'bags'}`);
    if (cr.fuelType && cr.fuelType !== 'Unknown') specs.push(cr.fuelType);

    // Inclusion codes — split PascalCase for human display. Same fallback
    // logic as renderExtraCard. Kept inline to avoid hoisting issues.
    const inclusionLabels = {
      FreeCancellation: 'Free cancellation',
      RoadsideAssistance: 'Roadside assistance',
      LiabilityInsurance: 'Liability insurance',
      TheftProtection: 'Theft protection',
      UnlimitedMileage: 'Unlimited mileage',
      CollisionDamageWaiver: 'Collision damage waiver',
      AdditionalDriver: 'Additional driver',
      WinterTyres: 'Winter tyres',
      AirConditioning: 'Air conditioning',
    };
    const splitPascal = (s) => {
      if (!s || typeof s !== 'string') return s;
      const words = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_+/g, ' ').trim().split(/\s+/);
      return words.map((w, i) => {
        if (i > 0 && /^(and|or|of|the|to|in|on|at|by|for)$/i.test(w)) return w.toLowerCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(' ');
    };
    const inclusions = (cr.inclusions || []).map(i => inclusionLabels[i] || splitPascal(i));

    // Group info entries by title — Travelify sometimes duplicates entries
    // (the sample had two 'Pickup Information' blocks). De-dupe before render.
    const seenInfoTitles = new Set();
    const infoEntries = (cr.information || []).filter(info => {
      const k = (info.title || '').toLowerCase();
      if (seenInfoTitles.has(k)) return false;
      seenInfoTitles.add(k);
      return true;
    });

    const cancelDesc = (cr.descriptions || []).find(d => /cancel/i.test(d.title || '') || d.type === 'CancelAndAmendments');
    const hasDetails = infoEntries.length > 0 || !!cancelDesc?.text;

    // Pay-at-location lines (booster seats etc) — shown using the same
    // "Also payable on arrival" treatment as accommodation in-resort fees.
    const validPayAt = (cr.payAtLocation || []).filter(p => p.name || p.description);

    return `
      <div class="tgm-extra-card">
        <div class="tgm-extra-head">
          <div class="tgm-extra-icon">${svg(IC.car, 2, 22)}</div>
          <div class="tgm-extra-info">
            <div class="tgm-extra-kind">${esc(c.labels?.carHire || c.t('carHire'))}${cr.className ? ' · ' + esc(cr.className) : ''}</div>
            <div class="tgm-extra-name">${esc(cr.name || 'Hire car')}</div>
            ${cr.rentalOperator?.name ? `<div class="tgm-extra-sub">${esc(c.labels?.suppliedBy || c.t('suppliedBy'))} ${esc(cr.rentalOperator.name)}</div>` : ''}
          </div>
        </div>
        <div class="tgm-extra-meta">
          ${pickupDate ? `<span class="tgm-extra-meta-item">${svg(IC.cal, 2, 14)}<span><strong>${esc(c.labels?.pickup || c.t('pickup'))}:</strong> ${esc(pickupDate)}${pickupTime ? ` · ${esc(pickupTime)}` : ''}</span></span>` : ''}
          ${dropoffDate ? `<span class="tgm-extra-meta-item">${svg(IC.cal, 2, 14)}<span><strong>${esc(c.labels?.dropoff || c.t('dropoff'))}:</strong> ${esc(dropoffDate)}${dropoffTime ? ` · ${esc(dropoffTime)}` : ''}</span></span>` : ''}
          ${pickupLabel ? `<span class="tgm-extra-meta-item">${svg(IC.pin, 2, 14)}<span>${esc(pickupLabel)}${(!sameLocation && dropoffLabel) ? ` → ${esc(dropoffLabel)}` : ''}</span></span>` : ''}
        </div>
        ${specs.length ? `<div class="tgm-chips" style="margin-top:8px;">${specs.map(s => `<span class="tgm-chip">${svg(IC.check)}${esc(s)}</span>`).join('')}</div>` : ''}
        ${inclusions.length ? `
          <div class="tgm-subhead" style="margin-top:12px;">${esc(c.labels?.included || c.t('included'))}</div>
          <div class="tgm-chips">${inclusions.map(i => `<span class="tgm-chip">${svg(IC.check)}${esc(i)}</span>`).join('')}</div>
        ` : ''}
        ${validPayAt.length ? `
          <div class="tgm-pay-onarrival" style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--tgm-border-light);">
            <div class="tgm-pay-onarrival-title">${svg(IC.alert)}${esc(c.labels?.payAtPickup || c.t('payAtPickup'))}</div>
            ${validPayAt.map(line => {
              const label = line.name || line.description;
              const hasPrice = typeof line.unitPrice === 'number';
              const amount = hasPrice ? (line.unitPrice || 0) * (line.qty || 1) : null;
              const currency = cr.pricing?.currency || item.currency || 'GBP';
              return `
                <div class="tgm-pay-onarrival-line">
                  <span class="name">
                    ${esc(label)}
                    ${line.description && line.description !== line.name ? `<small>${esc(line.description)}</small>` : ''}
                  </span>
                  <span class="val">${amount != null ? esc(fmtMoney(amount, currency)) : '—'}</span>
                </div>
              `;
            }).join('')}
            <div class="tgm-pay-onarrival-note">${esc(c.labels?.payAtPickupNote || c.t('payAtPickupNote'))}</div>
          </div>
        ` : ''}
        ${hasDetails ? `
          <div class="tgm-collapse" style="margin-top:16px; margin-bottom:0;">
            <button class="tgm-collapse-trig" type="button" aria-expanded="false">
              <div class="tgm-collapse-left">${svg(IC.info)}${esc(c.labels?.carHireInfo || c.t('carHireInfo'))}</div>
              ${svg(IC.chev)}
            </button>
            <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
              ${infoEntries.map(info => `
                ${info.title ? `<div class="tgm-subhead">${esc(info.title)}</div>` : ''}
                <p>${esc(info.text)}</p>
              `).join('')}
              ${cancelDesc?.text ? `
                <div class="tgm-subhead">${esc(c.labels?.cancellation || c.t('cancellation'))}</div>
                <p>${esc(cancelDesc.text)}</p>
              ` : ''}
            </div></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // -------- Tickets & Attractions --------
  // Renders a ticket / attraction / tour card. Shows event name, scheduled
  // date+time, location, duration, and collapsible details (description,
  // highlights, meeting point, etc).
  function renderTicketsCard(item, c) {
    const t = item.ticketsAttractions;
    if (!t) return '';

    const opt = t.selectedOption;
    const scheduledDate = opt?.scheduledDateTime
      ? fmtDate(opt.scheduledDateTime, { day: 'numeric', month: 'short', year: 'numeric' })
      : (item.startDate ? fmtDate(item.startDate, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
    const scheduledTime = opt?.scheduledDateTime ? fmtTime(opt.scheduledDateTime) : '';
    const durationLabel = fmtDurationMinutes(t.minDuration === t.maxDuration ? t.minDuration : (t.maxDuration || t.minDuration));

    const locationLabel = t.location?.city
      ? [t.location.city, t.location.country].filter(Boolean).join(', ')
      : '';

    // Pick the most useful descriptions to show. Travelify sends many — we
    // prioritise short useful ones over the long marketing blurb.
    const descByTitle = (title) => (t.descriptions || []).find(d => (d.title || '').toLowerCase() === title.toLowerCase());
    const descByPattern = (re) => (t.descriptions || []).find(d => re.test(d.title || ''));
    const overview = descByTitle('Description')?.text || descByTitle('About')?.text || '';
    const highlights = descByTitle('Highlights')?.text || '';
    const included = descByTitle('Included')?.text || '';
    const notIncluded = descByTitle('Not Included')?.text || descByTitle('Not included')?.text || '';
    const meetingPoint = descByPattern(/meeting\s*point/i)?.text || '';
    const cancelPolicy = descByPattern(/cancel/i)?.text || '';
    const languages = descByPattern(/language/i)?.text || '';

    const hasDetails = overview || highlights || included || notIncluded || meetingPoint || cancelPolicy || languages;

    // Feature labels — same dictionary pattern as accommodation extras.
    const featureLabels = {
      SmartphoneTickets: 'Smartphone ticket',
      InstantTicket: 'Instant confirmation',
      CovidSecure: 'Covid-secure',
      SkipTheLine: 'Skip the line',
      MobileVoucher: 'Mobile voucher',
      InstantConfirmation: 'Instant confirmation',
      PrintAtHome: 'Print at home',
    };
    const splitPascal = (s) => {
      if (!s || typeof s !== 'string') return s;
      const words = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_+/g, ' ').trim().split(/\s+/);
      return words.map((w, i) => {
        if (i > 0 && /^(and|or|of|the|to|in|on|at|by|for)$/i.test(w)) return w.toLowerCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(' ');
    };
    const features = (t.features || []).map(f => featureLabels[f] || splitPascal(f));

    return `
      <div class="tgm-extra-card">
        <div class="tgm-extra-head">
          <div class="tgm-extra-icon">${svg(IC.ticket, 2, 22)}</div>
          <div class="tgm-extra-info">
            <div class="tgm-extra-kind">${esc(t.ticketType || c.labels?.ticket || c.t('ticket'))}${opt?.subOption?.name ? ' · ' + esc(opt.subOption.name) : ''}</div>
            <div class="tgm-extra-name">${esc(t.name || 'Booking')}</div>
            ${locationLabel ? `<div class="tgm-extra-sub">${esc(locationLabel)}</div>` : ''}
          </div>
        </div>
        <div class="tgm-extra-meta">
          ${scheduledDate ? `<span class="tgm-extra-meta-item">${svg(IC.cal, 2, 14)}<span>${esc(scheduledDate)}${scheduledTime ? ` · ${esc(scheduledTime)}` : ''}</span></span>` : ''}
          ${durationLabel ? `<span class="tgm-extra-meta-item">${svg(IC.clock, 2, 14)}<span>${esc(durationLabel)}</span></span>` : ''}
          ${(t.guests && t.guests.length) ? `<span class="tgm-extra-meta-item">${svg(IC.users, 2, 14)}<span>${esc(t.guests.length)} ${t.guests.length === 1 ? 'guest' : 'guests'}</span></span>` : ''}
        </div>
        ${features.length ? `<div class="tgm-chips" style="margin-top:8px;">${features.map(f => `<span class="tgm-chip">${svg(IC.check)}${esc(f)}</span>`).join('')}</div>` : ''}
        ${hasDetails ? `
          <div class="tgm-collapse" style="margin-top:16px; margin-bottom:0;">
            <button class="tgm-collapse-trig" type="button" aria-expanded="false">
              <div class="tgm-collapse-left">${svg(IC.info)}${esc(c.labels?.ticketDetails || c.t('ticketDetails'))}</div>
              ${svg(IC.chev)}
            </button>
            <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
              ${overview ? `<p>${esc(overview.slice(0, 800))}${overview.length > 800 ? '…' : ''}</p>` : ''}
              ${highlights ? `
                <div class="tgm-subhead">${esc(c.labels?.highlights || c.t('highlights'))}</div>
                <p>${esc(highlights.replace(/<br\s*\/?>/gi, '\n').slice(0, 600))}</p>
              ` : ''}
              ${included ? `
                <div class="tgm-subhead">${esc(c.labels?.included || c.t('included'))}</div>
                <p>${esc(included.replace(/<br\s*\/?>/gi, '\n').slice(0, 600))}</p>
              ` : ''}
              ${notIncluded ? `
                <div class="tgm-subhead">${esc(c.labels?.notIncluded || c.t('notIncluded'))}</div>
                <p>${esc(notIncluded.replace(/<br\s*\/?>/gi, '\n').slice(0, 600))}</p>
              ` : ''}
              ${meetingPoint ? `
                <div class="tgm-subhead">${esc(c.labels?.meetingPoint || c.t('meetingPoint'))}</div>
                <p>${esc(meetingPoint.slice(0, 600))}</p>
              ` : ''}
              ${languages ? `
                <div class="tgm-subhead">${esc(c.labels?.languages || c.t('languages'))}</div>
                <p>${esc(languages.slice(0, 300))}</p>
              ` : ''}
              ${cancelPolicy ? `
                <div class="tgm-subhead">${esc(c.labels?.cancellation || c.t('cancellation'))}</div>
                <p>${esc(cancelPolicy.slice(0, 600))}</p>
              ` : ''}
            </div></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Display label + icon for a product type, used by the cancel section.
  // -------- Extras (post-booking add-ons) --------
  // Renders the Travelify "Extras" product ("Add Extra Group / Add Extra" in
  // the agent system, typically added to a booking after it was made). Its
  // data is a list of groups, each holding one or more bookable extras with
  // their own participants, so we render one card per extra with the group as
  // context. Price is intentionally omitted here (it shows in the payment
  // breakdown) to match the transfer / airport-extra cards.
  function renderExtrasItemCard(item) {
    const ex = item?.extras;
    if (!ex || !Array.isArray(ex.groups)) return '';
    const cards = [];
    for (const g of ex.groups) {
      for (const e of (g.extras || [])) {
        const kind = [g.type, g.name].filter(Boolean).join(' · ');
        const icon = /transport|transfer|taxi|car|van|shuttle/i.test(`${g.type || ''} ${e.type || ''}`) ? IC.van : IC.bag;
        const names = (e.participants || [])
          .map(p => [p.title, p.firstname, p.surname].filter(Boolean).join(' ').trim())
          .filter(Boolean);
        const metaBits = [];
        if (names.length) metaBits.push(`<span class="tgm-extra-meta-item">${svg(IC.user, 2, 14)}<span>${esc(names.join(', '))}</span></span>`);
        if (typeof e.qty === 'number' && e.qty > 1) metaBits.push(`<span class="tgm-extra-meta-item">${svg(IC.check, 2, 14)}<span>${esc('×' + e.qty)}</span></span>`);
        cards.push(`
          <div class="tgm-extra-card">
            <div class="tgm-extra-head">
              <div class="tgm-extra-icon">${svg(icon, 2, 22)}</div>
              <div class="tgm-extra-info">
                ${kind ? `<div class="tgm-extra-kind">${esc(kind)}</div>` : ''}
                <div class="tgm-extra-name">${esc(e.name || g.name || 'Extra')}</div>
                ${e.description ? `<div class="tgm-extra-sub">${esc(e.description)}</div>` : ''}
              </div>
            </div>
            ${metaBits.length ? `<div class="tgm-extra-meta">${metaBits.join('')}</div>` : ''}
          </div>`);
      }
    }
    return cards.join('');
  }

  function productMeta(item) {
    switch (item?.product) {
      case 'Accommodation':      return { icon: IC.bed,    label: 'Accommodation' };
      case 'Packages':           return { icon: IC.bag,    label: 'Package' };
      case 'Flights':            return { icon: IC.plane,  label: 'Flights' };
      case 'Transfers':          return { icon: IC.van,    label: 'Transfer' };
      case 'CarRental':          return { icon: IC.car,    label: 'Car hire' };
      case 'TicketsAttractions': return { icon: IC.ticket, label: 'Tickets & attractions' };
      case 'AirportExtras':      return { icon: IC.bag,    label: 'Airport extras' };
      case 'Extras':             return { icon: IC.bag,    label: 'Extras' };
      default:                   return { icon: IC.booking, label: item?.product || 'Booked item' };
    }
  }

  // "Cancel a product" section. Lists each item in the order with its own
  // Cancel button (cancellation is per-product in the Travelify API — each has
  // its own policy to accept, and any one call can fail independently). The
  // policy fetch + confirm flow runs in a modal mounted at data-tgm-cancel-mount.
  function renderCancelSection(order, c) {
    if (c.display?.showCancel === false) return '';
    const items = Array.isArray(order?.items) ? order.items : [];
    const rows = items
      .filter(it => it && it.id != null)
      .map(it => {
        const meta = productMeta(it);
        const isCancelled = String(it.status || '').toLowerCase() === 'cancelled';
        const subBits = [];
        if (it.bookingReference) subBits.push(esc(it.bookingReference));
        if (it.startDate) subBits.push(esc(fmtDate(it.startDate, { day: 'numeric', month: 'short', year: 'numeric' })));
        const sub = subBits.join(' · ');
        return `
          <div class="tgm-cancel-row${isCancelled ? ' is-cancelled' : ''}">
            <div class="tgm-cancel-row-icon">${svg(meta.icon)}</div>
            <div class="tgm-cancel-row-text">
              <div class="tgm-cancel-row-title">${esc(meta.label)}</div>
              ${sub ? `<div class="tgm-cancel-row-sub">${sub}</div>` : ''}
            </div>
            ${isCancelled
              ? `<span class="tgm-cancel-pill">${esc(c.labels?.cancelledPill || c.t('cancelledPill'))}</span>`
              : `<button type="button" class="tgm-cancel-btn" data-tgm-cancel-item data-item-id="${esc(String(it.id))}">${svg(IC.x)}${esc(c.labels?.cancelBtn || c.t('cancelBtn'))}</button>`}
          </div>`;
      })
      .join('');

    if (!rows) return '';

    return `
      <div class="tgm-cancel-sec">
        <div class="tgm-cancel-sec-head">
          <h3>${svg(IC.shield)}${esc(c.labels?.cancelSecTitle || c.t('cancelSecTitle'))}</h3>
          <p>${esc(c.labels?.cancelSecSub || c.t('cancelSecSub'))}</p>
        </div>
        ${rows}
      </div>
      <div data-tgm-cancel-mount></div>`;
  }

  // Amendment request section. Sends the travel company a free-text request to
  // change the booking — it does NOT change anything itself, so the copy is
  // careful to say so. Whole-order (no per-product id), one step.
  function renderAmendSection(order, c) {
    if (c.display?.showAmend === false) return '';
    const title = c.labels?.amendSecTitle || c.t('amendSecTitle');
    const sub = c.labels?.amendSecSub || c.t('amendSecSub');
    const openLabel = c.labels?.amendOpen || c.t('amendOpen');
    const fieldLabel = c.labels?.amendFieldLabel || c.t('amendFieldLabel');
    const placeholder = c.labels?.amendPlaceholder || c.t('amendPlaceholder');
    const note = c.labels?.amendNote || c.t('amendNote');
    const submitLabel = c.labels?.amendSubmit || c.t('amendSubmit');
    return `
      <div class="tgm-amend-sec" data-tgm-amend>
        <div class="tgm-amend-head">
          <h3>${svg(IC.edit)}${esc(title)}</h3>
          <p>${esc(sub)}</p>
        </div>
        <div class="tgm-amend-body">
          <button type="button" class="tgm-amend-open" data-tgm-amend-open>${svg(IC.edit)}<span>${esc(openLabel)}</span></button>
          <div class="tgm-amend-form" data-tgm-amend-form hidden>
            <label class="tgm-amend-field">
              <span class="tgm-amend-label">${esc(fieldLabel)}</span>
              <textarea class="tgm-amend-input" data-tgm-amend-input rows="4" maxlength="${AMEND_MAX}" placeholder="${esc(placeholder)}" aria-label="${esc(fieldLabel)}"></textarea>
            </label>
            <div class="tgm-amend-foot"><span class="tgm-amend-count" data-tgm-amend-count>0 / ${AMEND_MAX}</span></div>
            <div class="tgm-amend-note">${esc(note)}</div>
            <div class="tgm-amend-actions">
              <button type="button" class="tgm-amend-cancel" data-tgm-amend-cancel>${esc(c.labels?.amendCancel || c.t('amendCancel'))}</button>
              <button type="button" class="tgm-amend-submit" data-tgm-amend-submit disabled>${svg(IC.send)}<span>${esc(submitLabel)}</span></button>
            </div>
            <div data-tgm-amend-error></div>
          </div>
          <div data-tgm-amend-result></div>
        </div>
      </div>`;
  }

  // The PLANNED payment schedule (all scheduled instalments, earliest first)
  // from the order-level depositOption.breakdown. NOTE: Travelify leaves this
  // breakdown in place unchanged after payments are taken — it is the original
  // plan, NOT what is still owed. Never render it directly; use
  // reconcileSchedule() for the genuinely remaining payments.
  function computeSchedule(order) {
    const dep = order && order.depositOption;
    const bd = dep && Array.isArray(dep.breakdown) ? dep.breakdown : [];
    return bd
      .map(b => ({ amount: Number(b.amount), dueDate: b.dueDate || '', due: Date.parse(b.dueDate) }))
      .filter(e => Number.isFinite(e.amount) && e.amount > 0)
      .sort((a, b) => (Number.isFinite(a.due) ? a.due : Infinity) - (Number.isFinite(b.due) ? b.due : Infinity));
  }

  // The REMAINING payment schedule: the planned breakdown reconciled against
  // the authoritative outstanding balance (total − paidToDate). Payments
  // settle the earliest scheduled entries first (whether taken online or
  // added manually in Travelify), so the genuinely remaining schedule is the
  // TAIL of the plan that sums to the outstanding — walking from the last
  // entry backwards, capping the boundary entry if a payment part-covered it.
  // Guarantees the displayed schedule always sums to "Balance remaining".
  function reconcileSchedule(order) {
    const all = computeSchedule(order);
    if (!all.length) return [];
    const { outstanding } = computeOutstanding(order);
    if (!(outstanding > 0)) return [];
    let need = Math.round(outstanding * 100) / 100;
    const left = [];
    for (let i = all.length - 1; i >= 0 && need > 0.004; i--) {
      const take = Math.min(all[i].amount, need);
      left.unshift({ amount: Math.round(take * 100) / 100, dueDate: all[i].dueDate, due: all[i].due });
      need = Math.round((need - take) * 100) / 100;
    }
    return left;
  }

  // Work out the next payment to collect — the earliest entry of the
  // RECONCILED schedule (so an instalment already settled by a manual or
  // online payment is never offered again). Mirrors decideCharge() in
  // /api/pay-balance so the displayed amount matches what the basket charges.
  function computeNextDue(order) {
    const entries = reconcileSchedule(order);
    if (!entries.length) return null;
    const next = entries[0];
    const rest = entries.slice(1);
    return {
      amount: next.amount,
      dueDate: next.dueDate,
      remaining: rest.length,
      remainingAmount: Math.round(rest.reduce((s, e) => s + e.amount, 0) * 100) / 100,
      isInstalment: entries.length > 1,
    };
  }

  // Authoritative "what's still owed" = total holiday cost − payments taken.
  // The depositOption.breakdown is only a SCHEDULE (Travelify leaves it in
  // place after a payment), so we never treat its sum as the balance — we use
  // it only for the next due date. Mirrors decideCharge() in /api/pay-balance.
  function computeOutstanding(order) {
    const items = order.items || [];
    const summary = order.summary || {};
    const accItem = items.find(i => i.product === 'Accommodation' || i.product === 'Packages') || null;
    const pricing = accItem?.accommodation?.pricing;
    const total = (typeof summary.totalPrice === 'number' && summary.totalPrice > 0)
      ? summary.totalPrice
      : (pricing?.memberPrice ?? pricing?.price ?? accItem?.price ?? 0);
    // Order-level voucher/promo discount (signed, negative). It's not in the
    // item prices, so net it off the total the balance is measured against.
    const voucher = (order.voucher && typeof order.voucher.value === 'number') ? order.voucher.value : 0;
    const netTotal = Math.round((total + voucher) * 100) / 100;
    const paid = typeof order.paidToDate === 'number' ? order.paidToDate : 0;
    const outstanding = Math.max(0, Math.round((netTotal - paid) * 100) / 100);
    return { total, voucher, netTotal, paid, outstanding };
  }

  // The "Pay balance / Pay next payment" CTA inside the Payment section.
  // Clicking it reveals an editable amount field, prefilled with the correct
  // figure, so a customer can pay in full (one tap) or overtype a part amount.
  function renderPayBalance(order, currency, c) {
    const { outstanding } = computeOutstanding(order);
    if (!(outstanding > 0)) return ''; // nothing owed → no CTA (e.g. fully paid)
    const next = computeNextDue(order);
    const isInstalment = !!(next && next.isInstalment) && next.amount < outstanding;
    const defaultAmount = isInstalment ? Math.min(next.amount, outstanding) : outstanding;
    if (!(defaultAmount > 0)) return '';

    const MIN_PART = 1; // smallest part payment; full settlement always allowed
    const min = outstanding <= MIN_PART ? outstanding : MIN_PART;
    const openLabel = isInstalment
      ? (c.labels?.payNextBtn || c.t('payNextBtn'))
      : (c.labels?.payBalanceBtn || c.t('payBalanceBtn'));
    const payVerb = c.labels?.payConfirm || c.t('payConfirm');
    const amountLabel = c.labels?.payAmountLabel || c.t('payAmountLabel');
    // Currency symbol for the input prefix (e.g. "£") derived from the formatter.
    const sym = (fmtMoney(0, currency).match(/^[^\d\s]+/) || [''])[0];
    const hint = isInstalment
      ? c.t('payHintInstalment', { next: fmtMoney(defaultAmount, currency), max: fmtMoney(outstanding, currency) })
      : c.t('payHintFull', { max: fmtMoney(outstanding, currency) });

    return `
      <div class="tgm-pay-action" data-tgm-pay-max="${esc(outstanding.toFixed(2))}" data-tgm-pay-min="${esc(min.toFixed(2))}" data-tgm-pay-cur="${esc(currency)}">
        <button type="button" class="tgm-pay-cta" data-tgm-pay-open>
          ${svg(IC.card)}<span>${esc(openLabel)} · ${esc(fmtMoney(defaultAmount, currency))}</span>
        </button>
        <div class="tgm-pay-form" data-tgm-pay-form hidden>
          <label class="tgm-pay-field">
            <span class="tgm-pay-field-label">${esc(amountLabel)}</span>
            <span class="tgm-pay-input-wrap">
              <span class="tgm-pay-cur" aria-hidden="true">${esc(sym)}</span>
              <input type="text" inputmode="decimal" class="tgm-pay-input" data-tgm-pay-input
                     value="${esc(defaultAmount.toFixed(2))}" autocomplete="off" spellcheck="false"
                     aria-label="${esc(amountLabel)}">
            </span>
          </label>
          <div class="tgm-pay-hint" data-tgm-pay-hint data-default="${esc(hint)}">${esc(hint)}</div>
          <div class="tgm-pay-form-row">
            <button type="button" class="tgm-pay-cancel" data-tgm-pay-cancel>${esc(c.labels?.payCancel || c.t('payCancel'))}</button>
            <button type="button" class="tgm-pay-cta tgm-pay-confirm" data-tgm-pay-confirm>
              ${svg(IC.card)}<span data-tgm-pay-label>${esc(payVerb)} · ${esc(fmtMoney(defaultAmount, currency))}</span>
            </button>
          </div>
          <div data-tgm-pay-error></div>
        </div>
      </div>`;
  }

  function renderFound(order, c, lookup) {
    const items = order.items || [];
    const summary = order.summary || {};

    const accItem = items.find(i => i.product === 'Accommodation' || i.product === 'Packages') || null;
    const flightItems = items.filter(i => i.product === 'Flights' || i.product === 'Packages');
    const extraItems = items.filter(i => i.product === 'AirportExtras');
    const transferItems = items.filter(i => i.product === 'Transfers');
    const carRentalItems = items.filter(i => i.product === 'CarRental');
    const ticketsItems = items.filter(i => i.product === 'TicketsAttractions');
    const extrasProdItems = items.filter(i => i.product === 'Extras');
    // Package metadata (ATOL flag, operator name) for the badge render.
    // Null when this isn't a package booking.
    const packageItem = items.find(i => i.product === 'Packages') || null;
    const packageInfo = packageItem?.package || null;

    const acc = accItem?.accommodation;
    const checkin = accItem?.startDate;
    const nights = accItem?.duration || 0;
    const checkoutMs = checkin ? new Date(checkin).getTime() + nights * 86400000 : null;
    const checkout = checkoutMs ? new Date(checkoutMs).toISOString() : null;

    const tripStart = summary.earliestStart || checkin;
    const days = daysUntil(tripStart);

    const heroUrl = acc?.media?.[0]?.url
      || extraItems[0]?.airportExtras?.media?.[0]?.url
      || ticketsItems[0]?.ticketsAttractions?.media?.find(m => m.type === 'GenericImage')?.url
      || transferItems[0]?.transfers?.media?.find(m => m.type === 'GenericImage')?.url
      || carRentalItems[0]?.carRental?.media?.find(m => m.type === 'GenericImage')?.url
      || '';
    const thumbs = (acc?.media || []).slice(0, 4);

    // Booking reference policy: display verbatim from Travelify, falling back to
    // the reference the customer typed to find this booking. NEVER concatenate a
    // 'TG' prefix or substitute the internal numeric order.id — those are
    // fabrications that mismatch what the agent/customer sees in their
    // confirmation email and in Travelify, and cause real-world support and
    // reputational damage. If no reference is available anywhere, hide the chip
    // entirely rather than invent one.
    const refValue =
      accItem?.bookingReference
      || flightItems[0]?.bookingReference
      || extraItems[0]?.bookingReference
      || transferItems[0]?.bookingReference
      || carRentalItems[0]?.bookingReference
      || ticketsItems[0]?.bookingReference
      || (lookup?.ref ? String(lookup.ref).toUpperCase() : null);

    const starHtml = acc?.rating ? Array.from({ length: Math.round(acc.rating) }, () => star()).join('') : '';

    const travellers = (summary.travellers && summary.travellers.length)
      ? summary.travellers
      : (acc?.guests || []);

    const pricing = acc?.pricing;
    const currency = pricing?.currency || order.currency || 'GBP';
    const totalPrice = (typeof summary.totalPrice === 'number' && summary.totalPrice > 0)
      ? summary.totalPrice
      : (pricing?.memberPrice ?? pricing?.price ?? accItem?.price ?? 0);
    const inResort = pricing?.inResortFees;

    const depositOpts = pricing?.depositOptions || [];
    const installPlan = depositOpts.find(d => d.installments && d.installmentsAmount) || null;
    const standardDep = depositOpts.find(d => !d.installments) || depositOpts[0] || null;

    const rate = acc?.units?.[0]?.rates?.[0];
    const cancelDescs = (rate?.descriptions || []).filter(d => d.type === 'CancelAndAmendments');

    const hotelDesc = (acc?.descriptions || []).find(d => d.title === 'Description' || d.type === 'Generic');

    const facilitiesList = (acc?.descriptions || []).find(d => d.title === 'Facilities');
    const facilities = facilitiesList?.text ? facilitiesList.text.split(/[,•]/).map(s => s.trim()).filter(Boolean).slice(0, 12) : [];

    const descByTitle = (title) => (acc?.descriptions || []).find(d => d.title === title);

    const paymentMethodsDesc = descByTitle('Methods of payment');
    const paymentMethods = paymentMethodsDesc?.text
      ? paymentMethodsDesc.text.split(/[,•]/).map(s => s.trim()).filter(Boolean).slice(0, 8)
      : [];

    const yearBuiltText = descByTitle('Year of construction')?.text
      || descByTitle('Year built')?.text
      || '';
    const yearBuiltMatch = yearBuiltText.match(/\b(19|20)\d{2}\b/);
    const yearBuilt = yearBuiltMatch ? yearBuiltMatch[0] : '';

    const totalRoomsText = descByTitle('Total number of rooms')?.text || '';
    const totalRoomsMatch = totalRoomsText.match(/\d+/);
    const totalRooms = totalRoomsMatch ? totalRoomsMatch[0] : '';

    const roomMix = [
      ['Twin', descByTitle('Twin rooms')?.text],
      ['Double', descByTitle('Double rooms')?.text],
      ['Superior', descByTitle('Superior rooms')?.text],
      ['Family', descByTitle('Family rooms')?.text],
      ['Suite', descByTitle('Suites')?.text],
    ]
      .map(([label, text]) => {
        const m = (text || '').match(/\d+/);
        return m ? { label, count: m[0] } : null;
      })
      .filter(Boolean);

    const allImportantInfo = (acc?.descriptions || []).filter(d => d.type === 'ImportantInfo');
    let checkinTime = '';
    let checkoutTime = '';
    const importantInfoBullets = [];
    for (const info of allImportantInfo) {
      const t = info.text || '';
      const ciMatch = t.match(/Check[\s-]?in\s+(?:hour|time)?\s*[:\-]?\s*(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)/i);
      const coMatch = t.match(/Check[\s-]?out\s+(?:hour|time)?\s*[:\-]?\s*(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)/i);
      if (ciMatch && !checkinTime) checkinTime = ciMatch[1];
      if (coMatch && !checkoutTime) checkoutTime = coMatch[1];
      const isJustTimes = /^check[\s-]?(in|out)/i.test(t.trim()) && t.length < 80;
      if (!isJustTimes) importantInfoBullets.push(info);
    }
    const importantInfo = importantInfoBullets;

    const priceBreakdown = pricing?.breakdown || [];
    const payAtLocation = pricing?.payAtLocation || [];

    const docs = order.documents || [];
    const showDocs = c.display?.showDocuments !== false && docs.length > 0;

    // "Things to know" groups three optional accordions. The heading must only
    // appear when at least one of them has content (otherwise a flight-only
    // booking shows an orphaned heading). The Cancellation policy accordion is
    // gated by the dedicated "Cancellation policy" toggle (showCancellation)
    // AND follows the "Online cancellation" toggle (showCancel) — turning
    // either off hides the policy text here.
    const showCancelInfo = c.display?.showCancellation !== false && c.display?.showCancel !== false;
    const ttkAboutHotel = !!(hotelDesc?.text || acc?.location?.address1 || paymentMethods.length || yearBuilt || totalRooms || roomMix.length || facilities.length);
    const ttkCancelPolicy = showCancelInfo && cancelDescs.length > 0;
    const ttkAtHotel = !!(importantInfo.length || checkinTime || checkoutTime);
    const showThingsToKnow = ttkAboutHotel || ttkCancelPolicy || ttkAtHotel;

    const firstName = order.customerFirstname || 'there';
    const destCity = acc?.location?.city || '';

    return `
      <div class="tgm-found">
        ${heroUrl ? `
        <div class="tgm-hero">
          <div class="tgm-hero-img${c.display?.showFullImage ? ' tgm-hero-img--full' : ''}" data-tgm-hero-img style="background-image:url('${esc(heroUrl)}')"></div>
          <div class="tgm-hero-overlay"></div>
          <div class="tgm-hero-content">
            <div class="tgm-hero-top">
              <span class="tgm-confirmed">${svg(IC.check, 3)}${esc(c.labels?.confirmed || c.t('confirmed'))}</span>
              ${(packageInfo?.atolProtected || packageInfo?.operator?.name) ? `
                <span class="tgm-atol">
                  ${packageInfo?.atolProtected ? `${svg(IC.shield, 2.5)}<span>${esc(c.labels?.atolProtected || c.t('atolProtected'))}</span>` : `${svg(IC.shield, 2.5)}<span>${esc(c.labels?.packagedHoliday || c.t('packagedHoliday'))}</span>`}
                  ${packageInfo?.operator?.name ? `<span class="tgm-atol-op">${esc(c.labels?.operatedBy || c.t('operatedBy'))} ${esc(packageInfo.operator.name)}</span>` : ''}
                </span>
              ` : ''}
              ${refValue ? `<span class="tgm-ref">${esc(c.labels?.ref || c.t('ref'))}<strong>${esc(refValue)}</strong></span>` : ''}
            </div>
            <div>
              ${(starHtml || acc?.review?.rating) ? `
                <div class="tgm-hero-rating">
                  ${starHtml}
                  ${acc?.review?.rating ? `<span class="tgm-review-chip"><strong>${acc.review.rating}</strong>/5${acc.review.reviews ? ` · ${esc(acc.review.reviews.toLocaleString('en-GB'))} ${esc(c.t('reviews'))}` : ''}${acc.review.platform ? ` · ${esc(acc.review.platform)}` : ''}</span>` : ''}
                </div>
              ` : ''}
              <h1 class="tgm-hero-name">${esc(acc?.name || c.t('yourBooking'))}</h1>
              ${acc?.location?.city ? `<p class="tgm-hero-loc">${svg(IC.pin)}${esc(acc.location.city)}${acc.location.country ? ', ' + esc(acc.location.country) : ''}</p>` : ''}
            </div>
          </div>
          ${thumbs.length > 1 ? `<div class="tgm-hero-thumbs">${thumbs.map((m, i) => `<button class="${i === 0 ? 'active' : ''}" data-tgm-thumb data-img="${esc(m.url)}" style="background-image:url('${esc(m.url)}')" aria-label="${esc(c.t('ariaViewImage', { n: i + 1 }))}"></button>`).join('')}</div>` : ''}
        </div>
        ` : ''}

        <div class="tgm-greeting">
          <div class="tgm-greeting-text">${esc((c.labels?.greetingPrefix || c.t('greetingPrefix')))}, <strong>${esc(firstName)}</strong>${destCity ? ` — ${esc(c.t('greetingSuffix', { city: destCity }))}` : '.'}</div>
          ${(() => {
            // Countdown copy must match what the customer is actually doing.
            // "until you fly" is wrong on an accommodation-only or extras-only
            // booking — and "wrong" here means "lies to a paying customer
            // about their own trip". Pick the verb based on what the booking
            // contains. Honour the legacy `countdown` config label if a
            // client has explicitly customised it; otherwise pick a sensible
            // default per booking shape.
            if (days == null || days <= 0) return '';
            let countdownLabel;
            if (c.labels?.countdown) {
              // Legacy / explicit override — don't overrule a client config.
              countdownLabel = c.labels.countdown;
            } else if (summary.hasFlights) {
              countdownLabel = c.labels?.countdownFly || c.t('countdownFly');
            } else if (summary.hasAccommodation) {
              countdownLabel = c.labels?.countdownCheckIn || c.t('countdownCheckIn');
            } else {
              // AirportExtras-only or other future product mix — generic verb.
              countdownLabel = c.labels?.countdownTravel || c.t('countdownTravel');
            }
            return `<div class="tgm-countdown">${svg(IC.clock)}<span><strong class="tgm-num">${days} ${esc(days === 1 ? c.t('day') : c.t('days'))}</strong> ${esc(countdownLabel)}</span></div>`;
          })()}
        </div>

        ${(c.display?.showActions !== false) ? `
        <div class="tgm-newlookup-row">
          <button type="button" class="tgm-newlookup" data-tgm-newlookup>
            ${svg(IC.refresh)}<span>${esc(c.labels?.newLookup || c.t('newLookup'))}</span>
          </button>
        </div>
        <div class="tgm-action-row">
          <button type="button" class="tgm-action" data-tgm-pdf-preview>
            <div class="tgm-action-icon">${svg(IC.eye)}</div>
            <div class="tgm-action-text">
              <div class="tgm-action-title">${esc(c.labels?.actionPreview || c.t('actionPreview'))}</div>
              <div class="tgm-action-sub">${esc(c.labels?.actionPreviewSub || c.t('actionPreviewSub'))}</div>
            </div>
            <div class="tgm-action-loader" aria-hidden="true"></div>
            ${svg(IC.arrow)}
          </button>
          <button type="button" class="tgm-action" data-tgm-pdf-email>
            <div class="tgm-action-icon">${svg(IC.mail)}</div>
            <div class="tgm-action-text">
              <div class="tgm-action-title">${esc(c.labels?.actionEmail || c.t('actionEmail'))}</div>
              <div class="tgm-action-sub">${esc(c.labels?.actionEmailSub || c.t('actionEmailSub'))}</div>
            </div>
            <div class="tgm-action-loader" aria-hidden="true"></div>
            ${svg(IC.arrow)}
          </button>
          <button type="button" class="tgm-action" data-tgm-pdf-download>
            <div class="tgm-action-icon">${svg(IC.dl)}</div>
            <div class="tgm-action-text">
              <div class="tgm-action-title">${esc(c.labels?.actionDownload || c.t('actionDownload'))}</div>
              <div class="tgm-action-sub">${esc(c.labels?.actionDownloadSub || c.t('actionDownloadSub'))}</div>
            </div>
            <div class="tgm-action-loader" aria-hidden="true"></div>
            ${svg(IC.arrow)}
          </button>
          <button type="button" class="tgm-action" data-tgm-pdf-print>
            <div class="tgm-action-icon">${svg(IC.print)}</div>
            <div class="tgm-action-text">
              <div class="tgm-action-title">${esc(c.labels?.actionPrint || c.t('actionPrint'))}</div>
              <div class="tgm-action-sub">${esc(c.labels?.actionPrintSub || c.t('actionPrintSub'))}</div>
            </div>
            <div class="tgm-action-loader" aria-hidden="true"></div>
            ${svg(IC.arrow)}
          </button>
        </div>
        <div data-tgm-pdf-viewer-mount></div>
        <div data-tgm-modal-mount></div>
        ` : ''}

        ${(checkin || checkout || nights || acc?.units?.[0]) ? `
        <div class="tgm-stay">
          <h3>${svg(IC.bed)}${esc(c.labels?.accommodation || c.t('accommodation'))}${
            acc?.name ? `<span class="tgm-stay-meta">${esc(acc.name)}</span>` : ''
          }</h3>
          <div class="tgm-stay-grid">
            ${checkin ? `
            <div class="tgm-stay-cell">
              <div class="tgm-stay-label">${svg(IC.cal)}${esc(c.labels?.checkin || c.t('checkin'))}</div>
              <div class="tgm-stay-value">${esc(fmtDayMonth(checkin))}</div>
              <div class="tgm-stay-sub">${esc(fmtWeekday(checkin))} · ${esc(fmtYear(checkin))}</div>
            </div>` : ''}
            ${checkout ? `
            <div class="tgm-stay-cell">
              <div class="tgm-stay-label">${svg(IC.cal)}${esc(c.labels?.checkout || c.t('checkout'))}</div>
              <div class="tgm-stay-value">${esc(fmtDayMonth(checkout))}</div>
              <div class="tgm-stay-sub">${esc(fmtWeekday(checkout))} · ${esc(fmtYear(checkout))}</div>
            </div>` : ''}
            ${nights ? `
            <div class="tgm-stay-cell">
              <div class="tgm-stay-label">${svg(IC.moon)}${esc(c.labels?.nights || c.t('nights'))}</div>
              <div class="tgm-stay-value">${nights}</div>
              <div class="tgm-stay-sub">${esc(nights === 1 ? ('1 ' + c.t('night')) : (nights === 7 ? c.t('week') : (nights + ' ' + c.t('nightsPlural'))))}</div>
            </div>` : ''}
            ${acc?.units?.[0] ? (() => {
              // Room display policy: prefer the supplier's full room name
              // (e.g. "8 BED MIXED DORM (for 1 people)") which Travelify
              // returns in units[].name. Fall back to roomType ONLY if it is
              // a real value — Travelify returns the literal string "Unknown"
              // when the supplier hasn't categorised the room. NEVER invent a
              // default (no "Deluxe", no "Standard"). If we have nothing real
              // to show, hide the cell entirely.
              const u = acc.units[0];
              const roomLabel =
                u?.name
                || (u?.roomType && u.roomType.toLowerCase() !== 'unknown' ? u.roomType : null);
              if (!roomLabel) return '';
              const boardLabel = fmtBoard(rate?.board);
              const guestsBit = (u?.sleepsAdults != null)
                ? `${u.sleepsAdults} ${esc(u.sleepsAdults === 1 ? c.t('guest') : c.t('guests'))}`
                : '';
              const subParts = [boardLabel, guestsBit].filter(Boolean);
              return `
                <div class="tgm-stay-cell">
                  <div class="tgm-stay-label">${svg(IC.user)}${esc(c.labels?.room || c.t('room'))}</div>
                  <div class="tgm-stay-value">${esc(roomLabel)}</div>
                  ${subParts.length ? `<div class="tgm-stay-sub">${esc(subParts.join(' · '))}</div>` : ''}
                </div>
              `;
            })() : ''}
          </div>
        </div>
        ` : ''}

        ${flightItems.map(fItem => renderFlightCard(fItem, c)).join('')}

        ${extraItems.map(eItem => renderExtraCard(eItem, c)).join('')}
        ${transferItems.map(tItem => renderTransferCard(tItem, c)).join('')}
        ${carRentalItems.map(crItem => renderCarRentalCard(crItem, c)).join('')}
        ${ticketsItems.map(tkItem => renderTicketsCard(tkItem, c)).join('')}
        ${extrasProdItems.map(xItem => renderExtrasItemCard(xItem)).join('')}

        <div class="tgm-two">
          <div class="tgm-section">
            <h3>${svg(IC.card)}${esc(c.labels?.payment || c.t('payment'))}</h3>
            <div class="tgm-pay-total">
              <span class="tgm-pay-label">${esc(resolveTotalLabel(items, c))}</span>
              <span class="tgm-pay-total-amt">${esc(fmtMoney(totalPrice, currency))}</span>
            </div>
            ${(() => {
              // Breakdown lines. Packages must be a single "Holiday package"
              // line — listing it under Hotel AND Flights doubles its price
              // visually (both rows would show the full bundled amount).
              // Filter to "pure" types for the breakdown.
              const packagesItems = items.filter(i => i.product === 'Packages');
              const pureFlightItems = flightItems.filter(i => i.product === 'Flights');
              const isPackage = accItem?.product === 'Packages';
              // Count distinct lines for the "show breakdown only if 2+ lines"
              // rule. Packages count as one line regardless of the hasAccom/
              // hasFlights flags we set elsewhere to drive other rendering.
              const productCount =
                  (packagesItems.length > 0 ? 1 : 0)
                + ((accItem && !isPackage) ? 1 : 0)
                + (pureFlightItems.length > 0 ? 1 : 0)
                + (summary.hasAirportExtras ? 1 : 0)
                + (summary.hasTransfers ? 1 : 0)
                + (summary.hasCarRental ? 1 : 0)
                + (summary.hasTicketsAttractions ? 1 : 0)
                + (summary.hasExtras ? 1 : 0);
              if (productCount < 2) return '';
              const lines = [];
              // Hotel line — only when accommodation is a separate product,
              // NOT when it came from a Packages split.
              if (accItem && !isPackage && typeof accItem.price === 'number') {
                lines.push({ label: c.labels?.hotelLine || c.t('hotelLine'), val: accItem.price });
              }
              // Holiday package — single combined line.
              const packagesTotal = packagesItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0);
              if (packagesTotal > 0) {
                lines.push({ label: c.labels?.packageLine || c.t('packageLine'), val: packagesTotal });
              }
              const flightTotal = pureFlightItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0);
              if (flightTotal > 0) lines.push({ label: c.labels?.flightsLine || c.t('flightsLine'), val: flightTotal });
              const extrasTotal = extraItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0);
              if (extrasTotal > 0) lines.push({ label: c.labels?.extrasLine || c.t('extrasLine'), val: extrasTotal });
              const transferTotal = transferItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0);
              if (transferTotal > 0) lines.push({ label: c.labels?.transfersLine || c.t('transfersLine'), val: transferTotal });
              const carRentalTotal = carRentalItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0);
              if (carRentalTotal > 0) lines.push({ label: c.labels?.carHireLine || c.t('carHireLine'), val: carRentalTotal });
              const ticketsTotal = ticketsItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0);
              if (ticketsTotal > 0) lines.push({ label: c.labels?.ticketsLine || c.t('ticketsLine'), val: ticketsTotal });
              const extrasProdTotal = extrasProdItems.reduce((a, i) => a + (typeof i.price === 'number' ? i.price : 0), 0);
              if (extrasProdTotal > 0) lines.push({ label: c.labels?.extrasProductLine || 'Extras', val: extrasProdTotal });
              if (lines.length < 2) return '';
              return `
                <div class="tgm-pay-breakdown">
                  ${lines.map(l => `
                    <div class="tgm-fee-line">
                      <span class="name">${esc(l.label)}</span>
                      <span class="val">${esc(fmtMoney(l.val, currency))}</span>
                    </div>
                  `).join('')}
                </div>
              `;
            })()}
            ${(() => {
              // Order-level payment state — paid so far + the REAL outstanding
              // balance (total − payments taken), not the raw deposit schedule
              // (which Travelify leaves in place after a payment is made).
              const { paid, outstanding } = computeOutstanding(order);
              if (!(paid > 0) && !(outstanding > 0)) return '';
              let rows = '';
              // Voucher/promo discount, shown as a deduction between the total
              // and the paid/balance rows so the figures read as a running sum.
              if (order.voucher && typeof order.voucher.value === 'number' && order.voucher.value < 0) {
                const vLabel = order.voucher.name || order.voucher.code || 'Voucher';
                rows += `<div class="tgm-pay-row"><span class="tgm-pay-label">${esc(vLabel)}</span><span class="v paid">${esc(fmtMoney(order.voucher.value, currency))}</span></div>`;
              }
              if (paid > 0) {
                rows += `<div class="tgm-pay-row"><span class="tgm-pay-label">${esc(c.labels?.paidSoFar || c.t('paidSoFar'))}</span><span class="v paid">${esc(fmtMoney(paid, currency))}</span></div>`;
              }
              if (outstanding > 0) {
                rows += `<div class="tgm-pay-row"><span class="tgm-pay-label">${esc(c.labels?.balanceRemaining || c.t('balanceRemaining'))}</span><span class="v due">${esc(fmtMoney(outstanding, currency))}</span></div>`;
                const next = computeNextDue(order);
                const sched = reconcileSchedule(order);
                // Instalment plan: show the whole schedule (unless the
                // accommodation pricing already provided an installPlan block
                // below, to avoid showing it twice). Otherwise just the next due.
                if (next && next.isInstalment && !installPlan && sched.length > 1) {
                  rows += `<div class="tgm-pay-sched">
                    <div class="tgm-pay-sched-title">${esc(c.labels?.paymentSchedule || c.t('paymentSchedule'))} · ${sched.length} ${esc(c.labels?.payments || c.t('payments'))}</div>
                    ${sched.map((b, i) => `
                      <div class="tgm-inst${i === 0 ? ' is-next' : ''}">
                        <span class="date">${esc(fmtDate(b.dueDate))}${i === 0 ? `<span class="tgm-inst-tag">${esc(c.labels?.next || c.t('next'))}</span>` : ''}</span>
                        <span class="amt">${esc(fmtMoney(b.amount, currency))}</span>
                      </div>
                    `).join('')}
                  </div>`;
                } else if (next && next.dueDate) {
                  rows += `<div class="tgm-pay-row"><span class="tgm-pay-label">${esc(c.labels?.nextDueDate || c.t('nextDueDate'))}</span><span class="v">${esc(fmtDate(next.dueDate))}</span></div>`;
                }
              } else if (paid > 0) {
                rows += `<div class="tgm-pay-row"><span class="tgm-pay-label">${esc(c.labels?.balanceRemaining || c.t('balanceRemaining'))}</span><span class="v paid">${esc(c.labels?.paidInFull || c.t('paidInFull'))}</span></div>`;
              }
              return rows;
            })()}
            ${standardDep ? `
              <div class="tgm-pay-row">
                <span class="tgm-pay-label">${esc(c.labels?.depositPaid || c.t('depositPaid'))}</span>
                <span class="v paid">${esc(fmtMoney(standardDep.amount, currency))}</span>
              </div>
              ${standardDep.breakdown?.[0] ? `
              <div class="tgm-pay-row">
                <span class="tgm-pay-label">${esc(c.labels?.balanceDue || c.t('balanceDue'))}</span>
                <span class="v due">${esc(fmtMoney(standardDep.breakdown[0].amount, currency))}</span>
              </div>
              <div class="tgm-pay-row">
                <span class="tgm-pay-label">${esc(c.labels?.dueDate || c.t('dueDate'))}</span>
                <span class="v">${esc(fmtDate(standardDep.breakdown[0].dueDate))}</span>
              </div>
              ` : ''}
            ` : ''}
            ${installPlan ? `
              <div class="tgm-pay-sched">
                <div class="tgm-pay-sched-title">${esc(c.labels?.instalmentPlan || c.t('instalmentPlan'))} · ${installPlan.installments} ${esc(c.labels?.payments || c.t('payments'))}</div>
                ${(installPlan.breakdown || []).map(b => `
                  <div class="tgm-inst">
                    <span class="date">${esc(fmtDate(b.dueDate))}</span>
                    <span class="amt">${esc(fmtMoney(b.amount, currency))}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}

            ${(() => {
              // "Also payable on arrival" — surfaces in-resort fees here
              // (next to total/deposit/balance) so customers can't miss
              // them. Mirrors the data in the "At the hotel" accordion,
              // which still exists for the times/important-info content.
              //
              // We render either:
              //   - The itemised payAtLocation list when available, OR
              //   - A single inResort total as fallback
              //
              // Same filter rule as the accordion: never fabricate a fee
              // description. Skip lines with no name AND no description —
              // we won't tell a customer they owe money for a charge we
              // can't identify.
              const validLines = (payAtLocation || []).filter(line => line.name || line.description);
              if (validLines.length === 0 && !inResort) return '';
              if (validLines.length > 0) {
                return `
                  <div class="tgm-pay-onarrival">
                    <div class="tgm-pay-onarrival-title">${svg(IC.alert)}${esc(c.labels?.payOnArrival || c.t('payOnArrival'))}</div>
                    ${validLines.map(line => {
                      const label = line.name || line.description;
                      const hasPrice = typeof line.unitPrice === 'number';
                      const amount = hasPrice ? (line.unitPrice || 0) * (line.qty || 1) : null;
                      return `
                        <div class="tgm-pay-onarrival-line">
                          <span class="name">
                            ${esc(label)}
                            ${line.description && line.description !== line.name ? `<small>${esc(line.description)}</small>` : ''}
                          </span>
                          <span class="val">${amount != null ? esc(fmtMoney(amount, currency)) : '—'}</span>
                        </div>
                      `;
                    }).join('')}
                    <div class="tgm-pay-onarrival-note">${esc(c.labels?.payOnArrivalNote || c.t('payOnArrivalNote'))}</div>
                  </div>
                `;
              }
              // Fallback: single inResort total with no itemised breakdown
              return `
                <div class="tgm-pay-onarrival">
                  <div class="tgm-pay-onarrival-title">${svg(IC.alert)}${esc(c.labels?.payOnArrival || c.t('payOnArrival'))}</div>
                  <div class="tgm-pay-onarrival-line">
                    <span class="name">${esc(c.labels?.resortFee || c.t('resortFee'))}</span>
                    <span class="val">${esc(fmtMoney(inResort, currency))}</span>
                  </div>
                  <div class="tgm-pay-onarrival-note">${esc(c.labels?.payOnArrivalNote || c.t('payOnArrivalNote'))}</div>
                </div>
              `;
            })()}
            ${(c.display?.showPayBalance !== false) ? renderPayBalance(order, currency, c) : ''}
          </div>

          <div class="tgm-section">
            <h3>${svg(IC.users)}${esc(c.labels?.travelling || c.t('travelling'))}</h3>
            ${travellers.length === 0 ? `
              <div class="tgm-guest">
                <div class="tgm-guest-av">${esc(initials(order.customerFirstname, order.customerSurname))}</div>
                <div class="tgm-guest-info">
                  <div class="tgm-guest-name">${esc((order.customerTitle ? order.customerTitle + ' ' : '') + (order.customerFirstname || '') + ' ' + (order.customerSurname || ''))}</div>
                  <div class="tgm-guest-meta">${esc(c.labels?.leadGuest || c.t('leadGuest'))}</div>
                </div>
              </div>
            ` : travellers.map((g, i) => `
              <div class="tgm-guest">
                <div class="tgm-guest-av">${esc(initials(g.firstname, g.surname))}</div>
                <div class="tgm-guest-info">
                  <div class="tgm-guest-name">${esc((g.title ? g.title + ' ' : '') + (g.firstname || '') + ' ' + (g.surname || ''))}</div>
                  <div class="tgm-guest-meta">${esc(i === 0 ? (c.labels?.leadGuest || c.t('leadGuest')) : (g.type || c.t('adult')))}</div>
                </div>
              </div>
            `).join('')}
            ${order.specialRequests ? `
              <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--tgm-border-light);">
                <div class="tgm-pay-sched-title">${esc(c.labels?.specialRequests || c.t('specialRequests'))}</div>
                <p style="font-size:13px; color:var(--tgm-text-2); margin:8px 0 0; font-style:italic;">"${esc(order.specialRequests)}"</p>
              </div>
            ` : ''}
          </div>
        </div>

        ${showDocs ? `
        <div class="tgm-section">
          <h3>${svg(IC.file)}${esc(c.labels?.documents || c.t('documents'))}</h3>
          <div class="tgm-docs">
            ${docs.map(d => `
              <a class="tgm-doc" href="${esc(d.url)}" target="_blank" rel="noopener">
                <div class="tgm-doc-icon">${fileIconForExt(d.ext)}</div>
                <div class="tgm-doc-info">
                  <div class="tgm-doc-name">${esc(d.name)}</div>
                  <div class="tgm-doc-meta">${esc((d.ext || 'FILE').toUpperCase())}${d.size ? ' · ' + esc(fmtFileSize(d.size)) : ''}</div>
                </div>
                ${svg(IC.dl)}
              </a>
            `).join('')}
          </div>
        </div>
        ` : ''}

        ${showThingsToKnow ? `<h3 class="tgm-h-eyebrow">${esc(c.labels?.thingsToKnow || c.t('thingsToKnow'))}</h3>` : ''}

        ${ttkAboutHotel ? `
        <div class="tgm-collapse">
          <button class="tgm-collapse-trig" type="button" aria-expanded="false">
            <div class="tgm-collapse-left">${svg(IC.bed)}${esc(c.labels?.aboutHotel || c.t('aboutHotel'))}</div>
            ${svg(IC.chev)}
          </button>
          <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
            ${hotelDesc?.text ? `<p>${esc(hotelDesc.text.slice(0, 800))}${hotelDesc.text.length > 800 ? '…' : ''}</p>` : ''}

            ${(acc?.location?.address1 || acc?.location?.city || acc?.location?.postalCode) ? `
              <div class="tgm-subhead">${esc(c.labels?.address || c.t('address'))}</div>
              <p>
                ${[
                  acc?.location?.address1,
                  acc?.location?.city,
                  acc?.location?.state,
                  acc?.location?.postalCode,
                  acc?.location?.country,
                ].filter(Boolean).map(s => esc(s)).join(', ')}
                ${(acc?.location?.latitude && acc?.location?.longitude)
                  ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(acc.location.latitude + ',' + acc.location.longitude)}" target="_blank" rel="noopener">${esc(c.labels?.viewMap || c.t('viewMap'))}</a>`
                  : ''}
              </p>
            ` : ''}

            ${(yearBuilt || totalRooms || roomMix.length) ? `
              <div class="tgm-subhead">${esc(c.labels?.propertyDetails || c.t('propertyDetails'))}</div>
              <dl class="tgm-kv">
                ${yearBuilt ? `<dt>${esc(c.labels?.yearBuilt || c.t('yearBuilt'))}</dt><dd>${esc(yearBuilt)}</dd>` : ''}
                ${totalRooms ? `<dt>${esc(c.labels?.totalRooms || c.t('totalRooms'))}</dt><dd>${esc(totalRooms)}</dd>` : ''}
                ${roomMix.length ? `<dt>${esc(c.labels?.roomMix || c.t('roomMix'))}</dt><dd>${roomMix.map(r => `${esc(r.count)} ${esc(r.label.toLowerCase())}`).join(', ')}</dd>` : ''}
              </dl>
            ` : ''}

            ${facilities.length ? `
              <div class="tgm-subhead">${esc(c.labels?.facilities || c.t('facilities'))}</div>
              <div class="tgm-facilities">${facilities.map(f => `<span class="tgm-fac">${svg(IC.check)}${esc(f)}</span>`).join('')}</div>
            ` : ''}

            ${paymentMethods.length ? `
              <div class="tgm-subhead">${esc(c.labels?.paymentMethods || c.t('paymentMethods'))}</div>
              <div class="tgm-chips">${paymentMethods.map(p => `<span class="tgm-chip">${svg(IC.card)}${esc(p)}</span>`).join('')}</div>
            ` : ''}
          </div></div>
        </div>` : ''}

        ${ttkCancelPolicy ? `
        <div class="tgm-collapse">
          <button class="tgm-collapse-trig" type="button" aria-expanded="false">
            <div class="tgm-collapse-left">${svg(IC.info)}${esc(c.labels?.cancellation || c.t('cancellation'))}</div>
            ${svg(IC.chev)}
          </button>
          <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
            ${cancelDescs.map(d => `<p>${esc(d.text)}</p>`).join('')}
          </div></div>
        </div>` : ''}

        ${ttkAtHotel ? `
        <div class="tgm-collapse">
          <button class="tgm-collapse-trig" type="button" aria-expanded="false">
            <div class="tgm-collapse-left">${svg(IC.coin)}${esc(c.labels?.localFees || c.t('localFees'))}</div>
            ${svg(IC.chev)}
          </button>
          <div class="tgm-collapse-body"><div class="tgm-collapse-inner">
            ${(checkinTime || checkoutTime) ? `
              <div class="tgm-subhead">${esc(c.labels?.checkInOutTimes || c.t('checkInOutTimes'))}</div>
              <dl class="tgm-kv">
                ${checkinTime ? `<dt>${esc(c.labels?.checkin || c.t('checkin'))}</dt><dd>${esc(checkinTime)}</dd>` : ''}
                ${checkoutTime ? `<dt>${esc(c.labels?.checkout || c.t('checkout'))}</dt><dd>${esc(checkoutTime)}</dd>` : ''}
              </dl>
            ` : ''}

            ${/* Payable-at-hotel fees moved to the Payment section so customers
                see them next to total/deposit/balance. The accordion keeps
                check-in/out times and Good-to-know notes since those are
                informational, not financial. */ ''}

            ${importantInfo.length ? `
              <div class="tgm-subhead">${esc(c.labels?.goodToKnow || c.t('goodToKnow'))}</div>
              ${importantInfo.map(d => `<p>${esc(d.text)}</p>`).join('')}
            ` : ''}
          </div></div>
        </div>` : ''}

        ${(c.display?.showPayBalance !== false) ? renderPayBalance(order, currency, c) : ''}

        ${renderCancelSection(order, c)}

        ${renderAmendSection(order, c)}

        ${(c.support?.email || c.support?.phone) ? `
        <div class="tgm-help">
          <div>
            <h3>${esc(c.labels?.helpTitle || c.t('helpTitle'))}</h3>
            <p>${esc(c.labels?.helpBody || c.t('helpBody'))}</p>
          </div>
          <div class="tgm-help-actions">
            ${c.support?.email ? `<a class="tgm-help-btn" href="mailto:${esc(c.support.email)}">${svg(IC.mail)}${esc(c.labels?.emailUs || c.t('emailUs'))}</a>` : ''}
            ${c.support?.phone ? `<a class="tgm-help-btn" href="tel:${esc(c.support.phone.replace(/[^+0-9]/g, ''))}">${svg(IC.phone)}${esc(c.labels?.callUs || c.t('callUs'))}</a>` : ''}
          </div>
        </div>` : ''}

        <div class="tgm-toast-stack" data-tgm-toast-stack></div>
      </div>
    `;
  }

  // Width below which the booking summary stacks instead of side-by-side.
  // 440px chosen because:
  //   - The Luna chat bubble is ~340px on desktop and ~300px on mobile — both well under.
  //   - Standalone My Booking demo at default sizing is ~700px+ — well over.
  //   - Mobile devices already hit the existing @media (max-width: 480px) rule first,
  //     and most of those rules already match what tgm-narrow does, so layout stays consistent.
  const NARROW_THRESHOLD_PX = 440;
  // Hysteresis to stop flicker when the container width sits right on the threshold.
  const NARROW_HYSTERESIS_PX = 16;

  // ----- Widget class -----

  class TGMyBookingWidget {
    constructor(container, config) {
      this.el = container;
      this.c = this._defaults(config);
      ensureFont(safeFontStackM(this.c.fontFamily, '')); // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.c);   // resolve viewer language + UI strings
      this.c.t = this.t;        // carry the translator into the module-level render fns (they receive c, not this)
      this.shadow = container.attachShadow({ mode: 'open' });
      this.state = { stage: 'form', order: null, error: null };
      this.lookup = null;
      this._lastAttempt = null;            // pre-fills form on retry / try-again
      this._cancel = null;                 // active per-product cancellation flow state
      this._toastTimers = new Map();
      this._pdfBlob = null;          // cached blob, shared by preview & download
      this._pdfPreviewUrl = null;    // object URL for the inline iframe
      this._pdfViewerOpen = false;
      this._emailModalOpen = false;  // tracks email composer modal visibility
      this._emailEscHandler = null;  // document-level Esc listener for modal
      this._narrow = false;          // container-width-driven narrow layout flag
      this._resizeObserver = null;
      this._initNarrowObserver();    // sets _narrow before first render so no flash
      this._render();
    }

    _initNarrowObserver() {
      // Compute the initial value synchronously so _render gets it right
      // first time. ResizeObserver only delivers the first callback async,
      // which would otherwise cause a one-frame flash of the wide layout.
      try {
        const w = this.el.getBoundingClientRect().width;
        if (w > 0) this._narrow = w < NARROW_THRESHOLD_PX;
      } catch (_) { /* element not yet in DOM — observer will catch it */ }

      if (typeof ResizeObserver === 'undefined') return;
      try {
        this._resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const w = entry.contentRect ? entry.contentRect.width : 0;
            if (w <= 0) continue;
            // Hysteresis: switching to narrow is at < threshold,
            // switching back to wide requires width >= threshold + hysteresis.
            const nextNarrow = this._narrow
              ? w < (NARROW_THRESHOLD_PX + NARROW_HYSTERESIS_PX)
              : w < NARROW_THRESHOLD_PX;
            if (nextNarrow !== this._narrow) {
              this._narrow = nextNarrow;
              this._applyNarrow();
            }
          }
        });
        this._resizeObserver.observe(this.el);
      } catch (_) { /* obscure browser failure — fall back to initial-only sizing */ }
    }

    _applyNarrow() {
      // Toggle the class on the already-rendered .tgm-root without doing a
      // full re-render — the inner HTML doesn't change, only its layout does.
      const root = this.shadow && this.shadow.querySelector('.tgm-root');
      if (!root) return;
      if (this._narrow) root.classList.add('tgm-narrow');
      else root.classList.remove('tgm-narrow');
    }

    _defaults(c) {
      const merged = Object.assign({
        layout: 'vertical',
        theme: 'light',
        // Localised-default pattern: empty here, falls back to the translated
        // default at render time via c.t(); an author-set value still wins.
        title: '',
        subtitle: '',
        subtitleShort: '',
        eyebrow: '',
        labels: {},
        brand: { name: '' },
        colors: {},
        radius: 12,
        fontFamily: '',
        support: {},
        display: { showActions: true, showDocuments: true, showFacilities: true, showHotelDescription: true, showCancellation: true, showLocalFees: true },
        widgetId: c?.widgetId || null,
      }, c || {});
      merged.colors = Object.assign({
        primary: '#1B2B5B',
        accent:  '#00B4D8',
        success: '#10B981',
        warning: '#F59E0B',
        text:    '#0F172A',
      }, merged.colors || {});
      if (typeof merged.radius !== 'number') merged.radius = 12;
      return merged;
    }

    _buildOverrides() {
      const c = this.c.colors || {};
      const lighten = (hex, amt) => this._shiftHex(hex, amt);
      const primary = safeColorM(c.primary, '#1B2B5B');
      const accent = safeColorM(c.accent, '#00B4D8');
      const parsed = parseInt(this.c.radius, 10);
      const radius = Math.max(0, Math.min(28, Number.isFinite(parsed) ? parsed : 12));
      const overrides = {
        '--tgm-primary': primary,
        '--tgm-primary-light': lighten(primary, 18),
        '--tgm-primary-dark': lighten(primary, -18),
        '--tgm-accent': accent,
        '--tgm-accent-light': lighten(accent, 16),
        '--tgm-accent-dark': lighten(accent, -16),
        '--tgm-success': safeColorM(c.success, '#10B981'),
        '--tgm-warning': safeColorM(c.warning, '#F59E0B'),
        '--tgm-text': safeColorM(c.text, '#0F172A'),
        '--tgm-radius-sm': Math.round(radius * 0.5) + 'px',
        '--tgm-radius-md': Math.round(radius * 0.66) + 'px',
        '--tgm-radius-lg': radius + 'px',
        '--tgm-radius-xl': Math.round(radius * 1.33) + 'px',
        '--tgm-radius-2xl': Math.round(radius * 1.66) + 'px',
      };
      // When fontFamily is set, override the host's hardcoded Inter stack.
      // .tgm-root inherits from the shadow host; setting font-family on the root
      // (with !important to defeat the :host rule) propagates everywhere via
      // the font-family: inherit on inputs/buttons/etc.
      const ff = safeFontStackM(this.c.fontFamily, '');
      if (ff) {
        overrides['font-family'] = "'" + ff.replace(/'/g, '') + "', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
      }
      return Object.entries(overrides)
        .map(([k, v]) => k + ':' + v + ';')
        .join('');
    }

    _shiftHex(hex, percent) {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      const adjust = (c) => {
        const target = percent >= 0 ? 255 : 0;
        const ratio = Math.abs(percent) / 100;
        return Math.round(c + (target - c) * ratio);
      };
      const out = (adjust(r) << 16) | (adjust(g) << 8) | adjust(b);
      return '#' + out.toString(16).padStart(6, '0');
    }

    _render() {
      const themeAttr = this.c.theme === 'dark' ? ' data-theme="dark"' : '';
      const overrides = this._buildOverrides();
      let inner;
      if (this.state.stage === 'loading') inner = renderLoading(this.c);
      else if (this.state.stage === 'found') inner = renderFound(this.state.order, this.c, this.lookup);
      else if (this.state.stage === 'notfound') inner = renderNotFound(this.c);
      else inner = renderForm(this.c, this.state, this._lastAttempt);

      // When we re-render the found view, the previously injected iframe
      // is gone. Reset the open flag so the next Preview click rebuilds it.
      // Same for the email modal — if we navigate away, the modal DOM is
      // torn down with the rest of the shadow root.
      if (this.state.stage !== 'found') {
        this._pdfViewerOpen = false;
        if (this._emailModalOpen) {
          // Re-render replaces the shadow tree, so the modal DOM is already
          // gone. We just need to detach the document-level Esc listener.
          if (this._emailEscHandler) {
            document.removeEventListener('keydown', this._emailEscHandler);
            this._emailEscHandler = null;
          }
          this._emailModalOpen = false;
        }
      }

      const narrowAttr = this._narrow ? ' tgm-narrow' : '';
      this.shadow.innerHTML = '<style>' + STYLES + '</style><div class="tgm-root' + narrowAttr + '"' + themeAttr + ' style="' + esc(overrides) + '">' + inner + '</div>';
      this._bind();
    }

    _bind() {
      const root = this.shadow.querySelector('.tgm-root');
      if (!root) return;

      const form = root.querySelector('[data-tgm-form]');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          this._submit(form);
        });
      }

      const tryAgain = root.querySelector('[data-tgm-tryagain]');
      if (tryAgain) tryAgain.addEventListener('click', () => {
        this.state = { stage: 'form', order: null, error: null };
        this._render();
      });

      const heroImg = root.querySelector('[data-tgm-hero-img]');
      root.querySelectorAll('[data-tgm-thumb]').forEach(btn => {
        btn.addEventListener('click', () => {
          root.querySelectorAll('[data-tgm-thumb]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (heroImg) heroImg.style.backgroundImage = "url('" + btn.dataset.img + "')";
        });
      });

      root.querySelectorAll('.tgm-collapse-trig').forEach(t => {
        t.addEventListener('click', () => {
          const wrap = t.parentElement;
          const isOpen = wrap.classList.toggle('open');
          t.setAttribute('aria-expanded', isOpen);
        });
      });

      // PDF buttons: Preview opens inline viewer, Download triggers a file save.
      // Both share a single fetch — the blob is cached on the instance after
      // the first call so the second action reuses it.
      const previewBtn = root.querySelector('[data-tgm-pdf-preview]');
      if (previewBtn) previewBtn.addEventListener('click', () => this._handlePdfPreview(previewBtn));
      const downloadBtn = root.querySelector('[data-tgm-pdf-download]');
      if (downloadBtn) downloadBtn.addEventListener('click', () => this._handlePdfDownload(downloadBtn));
      const emailBtn = root.querySelector('[data-tgm-pdf-email]');
      if (emailBtn) emailBtn.addEventListener('click', () => this._handleEmailOpen(emailBtn));
      const printBtn = root.querySelector('[data-tgm-pdf-print]');
      if (printBtn) printBtn.addEventListener('click', () => this._handlePdfPrint(printBtn));

      // Per-product cancel buttons. Each opens the policy → confirm modal for
      // that single item id.
      root.querySelectorAll('[data-tgm-cancel-item]').forEach(btn => {
        btn.addEventListener('click', () => this._openCancel(btn.getAttribute('data-item-id')));
      });

      // Amendment request — reveal the box, count characters, submit.
      const amendOpen = root.querySelector('[data-tgm-amend-open]');
      if (amendOpen) amendOpen.addEventListener('click', () => {
        const sec = amendOpen.closest('[data-tgm-amend]');
        const form = sec && sec.querySelector('[data-tgm-amend-form]');
        if (!form) return;
        amendOpen.hidden = true;
        form.hidden = false;
        const ta = form.querySelector('[data-tgm-amend-input]');
        if (ta) { ta.focus(); }
        this._validateAmend(sec);
      });
      const amendInput = root.querySelector('[data-tgm-amend-input]');
      if (amendInput) amendInput.addEventListener('input', () => this._validateAmend(amendInput.closest('[data-tgm-amend]')));
      const amendCancelBtn = root.querySelector('[data-tgm-amend-cancel]');
      if (amendCancelBtn) amendCancelBtn.addEventListener('click', () => {
        const sec = amendCancelBtn.closest('[data-tgm-amend]');
        if (!sec) return;
        const form = sec.querySelector('[data-tgm-amend-form]');
        const open = sec.querySelector('[data-tgm-amend-open]');
        const err = sec.querySelector('[data-tgm-amend-error]');
        if (form) form.hidden = true;
        if (open) open.hidden = false;
        if (err) err.innerHTML = '';
      });
      const amendSubmit = root.querySelector('[data-tgm-amend-submit]');
      if (amendSubmit) amendSubmit.addEventListener('click', () => this._submitAmend(amendSubmit.closest('[data-tgm-amend]')));
      // If a cancellation flow was mid-way when the view re-rendered, paint it.
      if (this._cancel && this._cancel.open) this._renderCancelModal();

      // Pay balance — open the amount editor, validate, confirm. The CTA can
      // appear in more than one place; each is scoped to its own action box.
      root.querySelectorAll('[data-tgm-pay-open]').forEach(openBtn => {
        openBtn.addEventListener('click', () => {
          const action = openBtn.closest('.tgm-pay-action');
          const form = action && action.querySelector('[data-tgm-pay-form]');
          if (!form) return;
          openBtn.hidden = true;
          form.hidden = false;
          this._validatePay(action);
          const input = form.querySelector('[data-tgm-pay-input]');
          if (input) { input.focus(); try { input.select(); } catch (_) {} }
        });
      });
      root.querySelectorAll('[data-tgm-pay-input]').forEach(input => {
        input.addEventListener('input', () => this._validatePay(input.closest('.tgm-pay-action')));
      });
      root.querySelectorAll('[data-tgm-pay-cancel]').forEach(cancelBtn => {
        cancelBtn.addEventListener('click', () => {
          const action = cancelBtn.closest('.tgm-pay-action');
          if (!action) return;
          const form = action.querySelector('[data-tgm-pay-form]');
          const openBtn = action.querySelector('[data-tgm-pay-open]');
          const err = action.querySelector('[data-tgm-pay-error]');
          if (form) form.hidden = true;
          if (openBtn) openBtn.hidden = false;
          if (err) err.innerHTML = '';
        });
      });
      root.querySelectorAll('[data-tgm-pay-confirm]').forEach(confirmBtn => {
        confirmBtn.addEventListener('click', () => {
          const action = confirmBtn.closest('.tgm-pay-action');
          const v = this._validatePay(action);
          if (!v.valid) return;
          this._payBalance(action, v.amount);
        });
      });

      // Issue 4: "Look up another booking" returns to the lookup form. We
      // clear the cached booking, PDF blob and lookup details so the next
      // search starts clean. _lastAttempt is also nulled so the form renders
      // blank — having a different customer's details pre-filled would be
      // both unhelpful and a privacy footgun on shared devices.
      const newLookupBtn = root.querySelector('[data-tgm-newlookup]');
      if (newLookupBtn) newLookupBtn.addEventListener('click', () => {
        this._discardPdfCache();
        this.lookup = null;
        this._lastAttempt = null;
        this.state = { stage: 'form', order: null, error: null };
        this._render();
      });
    }

    async _submit(form) {
      const data = new FormData(form);
      const email = (data.get('email') || '').toString().trim();
      const date = (data.get('date') || '').toString().trim();
      const ref = (data.get('ref') || '').toString().trim();

      if (!email || !date || !ref) {
        this.state.error = this.t('fillAllFields');
        this._render();
        return;
      }
      if (!this.c.widgetId) {
        this.state.error = this.t('notConfigured');
        this._render();
        return;
      }

      // Cache the attempted values so that:
      //   - A failed lookup can pre-fill the form on retry (so the customer
      //     doesn't have to retype everything to fix one typo).
      //   - The not-found screen's "Try again" returns the customer to a
      //     pre-filled form, not a blank one.
      // Cleared on successful lookup since this.lookup then holds the
      // canonical values.
      this._lastAttempt = { email, date, ref };

      this.state = { stage: 'loading', order: null, error: null };
      this._render();

      try {
        const res = await fetch(API_RETRIEVE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: this.c.widgetId,
            emailAddress: email,
            departDate: date,
            orderRef: ref,
          }),
        });

        if (res.status === 429) {
          this.state = { stage: 'form', order: null, error: this.t('tooManyAttempts') };
          this._render();
          return;
        }
        if (res.status === 404) {
          this.state = { stage: 'notfound', order: null, error: null };
          this._render();
          return;
        }
        if (!res.ok) {
          this.state = { stage: 'notfound', order: null, error: null };
          this._render();
          return;
        }

        const data = await res.json();
        if (!data.order) {
          this.state = { stage: 'notfound', order: null, error: null };
          this._render();
          return;
        }

        this.lookup = { email, date, ref };
        this._lastAttempt = null;

        // New booking → previously cached PDF is now stale. Discard.
        this._discardPdfCache();

        this.state = { stage: 'found', order: data.order, error: null };
        this._render();
        this._fireEvent('booking-loaded', { order: data.order });
      } catch (err) {
        this.state = { stage: 'form', order: null, error: this.t('genericError') };
        this._render();
      }
    }

    // Filename derived from the booking ref, shared between preview + download.
    // Mirrors the on-screen ref resolution: real Travelify bookingReference,
    // then the reference the customer typed to look up the booking. Never
    // fabricate a 'TG' prefix on the internal numeric order.id.
    _pdfFilename() {
      const items = this.state.order?.items || [];
      const accItem = items.find(i => i.product === 'Accommodation' || i.product === 'Packages');
      const flightItem = items.find(i => i.product === 'Flights');
      const extraItem = items.find(i => i.product === 'AirportExtras');
      const transferItem = items.find(i => i.product === 'Transfers');
      const carRentalItem = items.find(i => i.product === 'CarRental');
      const ticketsItem = items.find(i => i.product === 'TicketsAttractions');
      const refValue =
        accItem?.bookingReference
        || flightItem?.bookingReference
        || extraItem?.bookingReference
        || transferItem?.bookingReference
        || carRentalItem?.bookingReference
        || ticketsItem?.bookingReference
        || (this.lookup?.ref ? String(this.lookup.ref).toUpperCase() : 'booking');
      return 'booking-' + String(refValue).replace(/[^A-Z0-9_\-]/gi, '') + '.pdf';
    }

    // Single source of truth for the PDF blob. Returns the cached blob if one
    // exists, otherwise fetches once. All errors surface as toasts.
    async _ensurePdfBlob() {
      if (this._pdfBlob) return this._pdfBlob;

      if (!this.lookup || !this.c.widgetId) {
        this._showToast('error', this.t('pdfCannotTitle'), this.t('pdfLookupAgain'));
        return null;
      }

      const loadingToastId = this._showToast('loading', this.t('pdfGeneratingTitle'), this.t('pdfGeneratingSub'));

      try {
        const res = await fetch(API_PDF, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: this.c.widgetId,
            emailAddress: this.lookup.email,
            departDate: this.lookup.date,
            orderRef: this.lookup.ref,
          }),
        });

        if (!res.ok) {
          this._dismissToast(loadingToastId);
          if (res.status === 429) {
            this._showToast('error', this.t('pdfTooManyTitle'), this.t('pdfTooManySub'), 6000);
          } else if (res.status === 404) {
            this._showToast('error', this.t('pdfCouldntTitle'), this.t('pdfLookupAgain'), 6000);
          } else {
            this._showToast('error', this.t('pdfWrongTitle'), this.t('pdfTryAgainSoon'), 6000);
          }
          return null;
        }

        const blob = await res.blob();
        this._pdfBlob = blob;
        this._dismissToast(loadingToastId);
        return blob;
      } catch (err) {
        this._dismissToast(loadingToastId);
        this._showToast('error', this.t('pdfFailedTitle'), this.t('pdfCheckConnection'), 6000);
        return null;
      }
    }

    _discardPdfCache() {
      if (this._pdfPreviewUrl) {
        try { URL.revokeObjectURL(this._pdfPreviewUrl); } catch {}
        this._pdfPreviewUrl = null;
      }
      this._pdfBlob = null;
      this._pdfViewerOpen = false;
    }

    // Preview button — toggles the inline viewer. If already open, closes it.
    async _handlePdfPreview(btn) {
      if (btn.disabled) return;

      const root = this.shadow.querySelector('.tgm-root');
      const mount = root?.querySelector('[data-tgm-pdf-viewer-mount]');
      if (!mount) return;

      if (this._pdfViewerOpen) {
        this._closePdfViewer();
        return;
      }

      btn.disabled = true;
      btn.classList.add('is-loading');

      try {
        const blob = await this._ensurePdfBlob();
        if (!blob) return;

        if (!this._pdfPreviewUrl) {
          this._pdfPreviewUrl = URL.createObjectURL(blob);
        }

        // iOS Safari can't render <iframe src="blob:..."> for PDFs. Detect
        // and offer a download-only fallback so users aren't left with an
        // empty grey box and no recourse.
        const ua = navigator.userAgent || '';
        const isIosSafari = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;

        const filename = this._pdfFilename();
        if (isIosSafari) {
          mount.innerHTML = `
            <div class="tgm-pdf-viewer">
              <div class="tgm-pdf-viewer-head">
                <span class="tgm-pdf-viewer-title">${svg(IC.file)}${esc(filename)}</span>
                <div class="tgm-pdf-viewer-actions">
                  <button type="button" class="tgm-pdf-viewer-btn" data-tgm-pdf-viewer-close>${svg(IC.x)}Close</button>
                </div>
              </div>
              <div class="tgm-pdf-viewer-fallback">
                <p>Inline preview isn't supported on this browser. Tap below to open the PDF in a new tab, or use the Download button to save it.</p>
                <a class="tgm-btn-1" href="${this._pdfPreviewUrl}" target="_blank" rel="noopener">${svg(IC.arrow)}Open PDF</a>
              </div>
            </div>
          `;
        } else {
          // The #toolbar=0 hash is a hint to most desktop PDF viewers to hide
          // their built-in toolbar — keeps the chrome consistent.
          mount.innerHTML = `
            <div class="tgm-pdf-viewer">
              <div class="tgm-pdf-viewer-head">
                <span class="tgm-pdf-viewer-title">${svg(IC.file)}${esc(filename)}</span>
                <div class="tgm-pdf-viewer-actions">
                  <button type="button" class="tgm-pdf-viewer-btn" data-tgm-pdf-viewer-close>${svg(IC.x)}Close</button>
                </div>
              </div>
              <iframe class="tgm-pdf-viewer-frame" src="${this._pdfPreviewUrl}#toolbar=0" title="Booking confirmation PDF preview"></iframe>
            </div>
          `;
        }

        const closeBtn = mount.querySelector('[data-tgm-pdf-viewer-close]');
        if (closeBtn) closeBtn.addEventListener('click', () => this._closePdfViewer());

        this._pdfViewerOpen = true;
        btn.classList.add('is-active');
        this._fireEvent('pdf-previewed', { filename });

        // Smooth-scroll the viewer into view so the user sees what just happened.
        const viewer = mount.querySelector('.tgm-pdf-viewer');
        if (viewer && typeof viewer.scrollIntoView === 'function') {
          requestAnimationFrame(() => {
            viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        }
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }

    _closePdfViewer() {
      const root = this.shadow.querySelector('.tgm-root');
      const mount = root?.querySelector('[data-tgm-pdf-viewer-mount]');
      if (mount) mount.innerHTML = '';
      const previewBtn = root?.querySelector('[data-tgm-pdf-preview]');
      if (previewBtn) previewBtn.classList.remove('is-active');
      this._pdfViewerOpen = false;
    }

    // Download button — uses the same fetch/blob as preview. If user clicks
    // Download first (without previewing), this fetches; if they previewed
    // first, this reuses the cached blob.
    async _handlePdfDownload(btn) {
      if (btn.disabled) return;

      btn.disabled = true;
      btn.classList.add('is-loading');

      try {
        const blob = await this._ensurePdfBlob();
        if (!blob) return;

        const filename = this._pdfFilename();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        this._showToast('success', this.t('pdfDownloadedTitle'), filename, 4000);
        this._fireEvent('pdf-downloaded', { filename });
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }

    // Print — reuses the same booking-pack PDF. Opens it in a new tab and asks
    // the browser to print. If pop-ups are blocked we tell the customer rather
    // than failing silently. (window.open here is inside a click handler, so
    // it counts as a user gesture and is normally allowed.)
    async _handlePdfPrint(btn) {
      if (btn.disabled) return;

      btn.disabled = true;
      btn.classList.add('is-loading');

      try {
        const blob = await this._ensurePdfBlob();
        if (!blob) return;

        const url = URL.createObjectURL(blob);
        const win = window.open(url, '_blank');

        if (!win) {
          this._showToast('info', this.t('pdfPopupTitle'), this.t('pdfPopupSub'), 6000);
          setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1000);
          return;
        }

        // Best-effort: open the print dialog once the PDF has loaded. The load
        // event is unreliable for PDF documents, so we also try on a timer. If
        // neither fires the customer still has the PDF open to print manually.
        const triggerPrint = () => { try { win.focus(); win.print(); } catch {} };
        try { win.addEventListener('load', triggerPrint); } catch {}
        setTimeout(triggerPrint, 1200);

        setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 60000);
        this._fireEvent('pdf-print', {});
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    }

    // ----- Amendment request -----
    // Char counter + enable/disable submit. Native maxlength caps the length;
    // this just mirrors it in the UI and blocks an empty submit.
    _validateAmend(sec) {
      if (!sec) return;
      const ta = sec.querySelector('[data-tgm-amend-input]');
      const submit = sec.querySelector('[data-tgm-amend-submit]');
      const count = sec.querySelector('[data-tgm-amend-count]');
      if (!ta) return;
      const len = (ta.value || '').length;
      const trimmed = (ta.value || '').trim().length;
      if (count) {
        count.textContent = `${len} / ${AMEND_MAX}`;
        count.classList.toggle('tgm-near', len >= AMEND_MAX - 50);
      }
      if (submit) submit.disabled = trimmed === 0;
    }

    // Send the amendment request. On success the form is replaced with a clear
    // "request sent, nothing changed yet" confirmation. This never modifies the
    // booking — it only forwards the customer's text to the travel company.
    async _submitAmend(sec) {
      if (!sec || !this.lookup || !this.c.widgetId) return;
      const ta = sec.querySelector('[data-tgm-amend-input]');
      const submit = sec.querySelector('[data-tgm-amend-submit]');
      const errMount = sec.querySelector('[data-tgm-amend-error]');
      const details = ((ta && ta.value) || '').trim();
      if (!details) return;
      if (errMount) errMount.innerHTML = '';

      const label = submit && submit.querySelector('span');
      const prev = label ? label.textContent : '';
      const showErr = (msg) => {
        if (errMount) errMount.innerHTML = `<div class="tgm-pay-error">${svg(IC.alert)}<span>${esc(msg)}</span></div>`;
        if (submit) submit.disabled = false;
        if (label) label.textContent = prev;
      };

      if (submit) submit.disabled = true;
      if (label) label.textContent = this.c.labels?.amendSending || this.t('amendSending');

      try {
        const res = await fetch(API_AMEND, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: this.c.widgetId,
            emailAddress: this.lookup.email,
            departDate: this.lookup.date,
            orderRef: this.lookup.ref,
            amendmentDetails: details,
          }),
        });

        if (res.status === 429) {
          showErr(this.c.labels?.amendRateLimited || this.t('amendRateLimited'));
          return;
        }

        const data = await res.json().catch(() => null);

        if (data && data.success === true) {
          const form = sec.querySelector('[data-tgm-amend-form]');
          const open = sec.querySelector('[data-tgm-amend-open]');
          const result = sec.querySelector('[data-tgm-amend-result]');
          if (form) form.hidden = true;
          if (open) open.hidden = true;
          if (result) {
            result.innerHTML = `
              <div class="tgm-amend-done">
                <div class="tgm-amend-done-icon">${svg(IC.check)}</div>
                <div class="tgm-amend-done-text"><strong>${esc(this.c.labels?.amendDoneTitle || this.t('amendDoneTitle'))}</strong>${esc(this.c.labels?.amendDoneBody || this.t('amendDoneBody'))}</div>
              </div>`;
          }
          this._fireEvent('amend-sent', {});
          return;
        }

        // Server-side validation / Travelify error — show its message.
        if (data && data.error) { showErr(data.error); return; }

        showErr(this.c.labels?.amendFailed || this.t('amendFailed'));
      } catch (_) {
        showErr(this.c.labels?.amendFailed || this.t('amendFailed'));
      }
    }

    // ===== Email modal =====
    //
    // Three-stage flow:
    //   1. _handleEmailOpen → renders modal, focuses To field, listens for keys
    //   2. _sendEmail → validates inputs, POSTs to /api/booking-email
    //   3. _closeEmailModal → tears down DOM + key listener
    //
    // The modal is mounted inside the widget shadow root so it inherits theme
    // tokens. We use position: fixed on the backdrop so it overlays the host
    // page viewport, not just the widget's box.

    // ----- Pay balance / next payment -----
    // Creates a basket server-side and redirects the customer to it. The
    // amount is decided by the server from the order's schedule; the widget
    // only triggers the flow.
    // Sanitise + validate the typed amount against the booking's outstanding
    // figure (carried in data- attributes). Returns { valid, amount } and
    // updates the confirm button label, hint, and disabled state live. The
    // server re-validates independently — this is just for UX.
    _validatePay(action) {
      if (!action) return { valid: false, amount: null };
      const input = action.querySelector('[data-tgm-pay-input]');
      const confirm = action.querySelector('[data-tgm-pay-confirm]');
      const label = confirm && confirm.querySelector('[data-tgm-pay-label]');
      const hint = action.querySelector('[data-tgm-pay-hint]');
      const cur = action.dataset.tgmPayCur || 'GBP';
      const max = parseFloat(action.dataset.tgmPayMax);
      const min = parseFloat(action.dataset.tgmPayMin);
      if (!input) return { valid: false, amount: null };

      // Keep only digits and a single decimal point, max 2 dp.
      let raw = String(input.value || '').replace(/[^0-9.]/g, '');
      const dot = raw.indexOf('.');
      if (dot !== -1) raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, '').slice(0, 2);
      if (raw !== input.value) input.value = raw;

      const amt = parseFloat(raw);
      let valid = false;
      let msg = null;
      if (!raw || isNaN(amt) || amt <= 0) {
        valid = false;
      } else if (amt > max + 0.001) {
        msg = this.t('payTooMuch', { amount: fmtMoney(max, cur) });
      } else if (amt < min - 0.001 && Math.abs(amt - max) > 0.005) {
        msg = this.t('payTooSmall', { amount: fmtMoney(min, cur) });
      } else {
        valid = true;
      }

      if (confirm) confirm.disabled = !valid;
      if (label) {
        const shown = valid ? amt : (isNaN(amt) || amt <= 0 ? max : Math.min(amt, max));
        label.textContent = `${this.c.labels?.payConfirm || this.t('payConfirm')} · ${fmtMoney(shown, cur)}`;
      }
      if (hint) {
        if (msg) { hint.textContent = msg; hint.classList.add('tgm-err'); }
        else { hint.textContent = hint.dataset.default || ''; hint.classList.remove('tgm-err'); }
      }
      return { valid, amount: valid ? Math.round(amt * 100) / 100 : null };
    }

    async _payBalance(action, amount) {
      if (!action || !this.lookup || !this.c.widgetId) return;

      const confirm = action.querySelector('[data-tgm-pay-confirm]');
      const label = confirm && confirm.querySelector('[data-tgm-pay-label]');
      const errMount = action.querySelector('[data-tgm-pay-error]');
      const prevLabel = label ? label.textContent : '';
      if (errMount) errMount.innerHTML = '';

      const reset = () => { if (confirm) confirm.disabled = false; if (label) label.textContent = prevLabel; };
      const showErr = (msg) => {
        if (errMount) errMount.innerHTML = `<div class="tgm-pay-error">${svg(IC.alert)}<span>${esc(msg)}</span></div>`;
        reset();
      };

      if (confirm) confirm.disabled = true;
      if (label) label.textContent = this.c.labels?.payRedirecting || this.t('payRedirecting');

      try {
        const res = await fetch(API_PAY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: this.c.widgetId,
            emailAddress: this.lookup.email,
            departDate: this.lookup.date,
            orderRef: this.lookup.ref,
            amount,
          }),
        });

        if (res.status === 429) {
          showErr(this.c.labels?.payRateLimited || this.t('payRateLimited'));
          return;
        }

        const data = await res.json().catch(() => null);

        if (data && data.success === true && typeof data.url === 'string' && /^https:\/\//i.test(data.url)) {
          this._fireEvent('pay-redirect', { url: data.url, amount });
          // Send the customer to the basket. The widget is embedded on the
          // client's own site and the basket lives there too, so navigate the
          // top window; fall back to the widget's own window if blocked.
          try { (window.top || window).location.href = data.url; }
          catch { window.location.href = data.url; }
          return;
        }

        // Server rejected the amount (too big/small/invalid) — show its message.
        if (data && data.error) {
          showErr(data.error);
          return;
        }

        if (data && data.noBalance) {
          showErr(this.c.labels?.payNoBalance || this.t('payNoBalance'));
          return;
        }

        showErr(this.c.labels?.payFailed || this.t('payFailed'));
      } catch (_) {
        showErr(this.c.labels?.payFailed || this.t('payFailed'));
      }
    }

    // ----- Per-product cancellation flow -----
    // Two steps against /api/cancel-product (which proxies Travelify):
    //   1. fetch this product's cancellation policy + charges, show them
    //   2. customer accepts → collect a reason (<=250) → confirm
    // The order key never touches the browser — the proxy resolves it server-side.

    _findCancelItem(itemId) {
      const items = this.state.order?.items || [];
      return items.find(it => it && String(it.id) === String(itemId)) || null;
    }

    _openCancel(itemId) {
      const item = this._findCancelItem(itemId);
      if (!item) return;
      if (!this.lookup || !this.c.widgetId) return; // can't cancel without a resolved booking
      // If another flow is open, tear it down first.
      if (this._cancel && this._cancel.open) this._closeCancel({ silent: true });

      this._cancel = {
        open: true,
        stage: 'loading',
        itemId: String(itemId),
        item,
        meta: productMeta(item),
        data: null,
        error: null,
        reference: null,
      };
      this._renderCancelModal();
      this._cancelFetchPolicies();
      this._fireEvent('cancel-opened', { itemId: String(itemId) });
    }

    async _cancelFetchPolicies() {
      try {
        const res = await fetch(API_CANCEL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: this.c.widgetId,
            emailAddress: this.lookup.email,
            departDate: this.lookup.date,
            orderRef: this.lookup.ref,
            productId: this._cancel.itemId,
          }),
        });
        if (res.status === 429) {
          this._cancel.stage = 'error';
          this._cancel.error = this.t('tooManyAttempts');
          this._renderCancelModal();
          return;
        }
        const data = await res.json().catch(() => null);
        if (data && data.success === true) {
          this._cancel.stage = 'policies';
          this._cancel.data = data.data || {};
        } else {
          this._cancel.stage = 'error';
          this._cancel.error = (data && data.error) || "This product can't be cancelled online. Please contact us for help.";
        }
      } catch (_) {
        this._cancel.stage = 'error';
        this._cancel.error = "We couldn't load the cancellation details. Please try again.";
      }
      if (this._cancel && this._cancel.open) this._renderCancelModal();
    }

    async _cancelConfirm(reason) {
      if (!this._cancel || !this._cancel.open) return;
      this._cancel.stage = 'working';
      this._renderCancelModal();
      try {
        const res = await fetch(API_CANCEL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: this.c.widgetId,
            emailAddress: this.lookup.email,
            departDate: this.lookup.date,
            orderRef: this.lookup.ref,
            productId: this._cancel.itemId,
            confirm: true,
            cancellationReason: (reason || '').slice(0, 250),
          }),
        });
        if (res.status === 429) {
          this._cancel.stage = 'error';
          this._cancel.error = this.t('tooManyAttempts');
          this._renderCancelModal();
          return;
        }
        const data = await res.json().catch(() => null);
        if (data && data.success === true) {
          this._cancel.stage = 'done';
          this._cancel.reference = (data.data && data.data.cancellationReference) || '';
          this._fireEvent('cancel-confirmed', { itemId: this._cancel.itemId, reference: this._cancel.reference });
        } else {
          this._cancel.stage = 'error';
          this._cancel.error = (data && data.error) || "The cancellation couldn't be completed. Please contact us and we'll sort it out.";
        }
      } catch (_) {
        this._cancel.stage = 'error';
        this._cancel.error = "Something went wrong completing the cancellation. Please try again.";
      }
      if (this._cancel && this._cancel.open) this._renderCancelModal();
    }

    // Apply a successful cancellation to the in-memory order, then close and
    // re-render so the item shows as cancelled without another lookup.
    _finishCancel() {
      const item = this._cancel && this._findCancelItem(this._cancel.itemId);
      if (item) item.status = 'Cancelled';
      this._closeCancel({ silent: true });
      this._render();
    }

    _closeCancel(opts) {
      const root = this.shadow.querySelector('.tgm-root');
      const mount = root?.querySelector('[data-tgm-cancel-mount]');
      if (mount) mount.innerHTML = '';
      if (this._cancelEscHandler) {
        document.removeEventListener('keydown', this._cancelEscHandler);
        this._cancelEscHandler = null;
      }
      this._cancel = null;
      if (!opts || !opts.silent) this._fireEvent('cancel-closed');
    }

    _renderCancelModal() {
      const root = this.shadow.querySelector('.tgm-root');
      const mount = root?.querySelector('[data-tgm-cancel-mount]');
      if (!mount || !this._cancel) return;
      const c = this.c;
      const st = this._cancel;
      const title = st.meta?.label || c.t('thisProduct');

      let headIcon = IC.shield, headTitle, headSub, body, foot;

      if (st.stage === 'loading') {
        headTitle = c.labels?.cancelModalTitle || (c.t('cancelPrefix') + ' ' + title);
        headSub = c.labels?.cancelLoadingSub || c.t('cancelLoadingSub');
        body = `<div class="tgm-cancel-spin"><div class="tgm-spinner"></div><span>${esc(c.labels?.cancelLoading || c.t('cancelLoading'))}</span></div>`;
        foot = '';
      } else if (st.stage === 'policies') {
        const d = st.data || {};
        const policies = Array.isArray(d.policies) ? d.policies : [];
        headTitle = c.labels?.cancelModalTitle || (c.t('cancelPrefix') + ' ' + title);
        headSub = d.bookingReference
          ? `${esc(c.labels?.cancelRef || c.t('cancelRef'))}: ${esc(d.bookingReference)}`
          : (c.labels?.cancelPoliciesSub || c.t('cancelPoliciesSub'));
        body = `
          <div class="tgm-modal-field">
            <label>${esc(c.labels?.cancelPoliciesLabel || c.t('cancelPoliciesLabel'))}</label>
            ${policies.length
              ? `<div class="tgm-policies">${policies.map(p => `<div class="tgm-policy">${svg(IC.info)}<span>${esc(p)}</span></div>`).join('')}</div>`
              : `<div class="tgm-policy">${svg(IC.info)}<span>${esc(c.labels?.cancelNoPolicy || c.t('cancelNoPolicy'))}</span></div>`}
          </div>
          <div class="tgm-cancel-warn">${svg(IC.alert)}<span>${esc(c.labels?.cancelWarn || c.t('cancelWarn'))}</span></div>`;
        foot = `
          <button type="button" class="tgm-btn-2" data-tgm-cancel-keep>${esc(c.labels?.cancelKeep || c.t('cancelKeep'))}</button>
          <button type="button" class="tgm-btn-1" data-tgm-cancel-continue>${esc(c.labels?.cancelContinue || c.t('cancelContinue'))}${svg(IC.arrow)}</button>`;
      } else if (st.stage === 'reason') {
        headTitle = c.labels?.cancelReasonTitle || c.t('cancelReasonTitle');
        headSub = c.labels?.cancelReasonSub || c.t('cancelReasonSub');
        body = `
          <div class="tgm-modal-field">
            <label for="tgm-cancel-reason">${esc(c.labels?.cancelReasonLabel || c.t('cancelReasonLabel'))}</label>
            <textarea id="tgm-cancel-reason" class="tgm-modal-textarea" data-tgm-cancel-reason rows="3" maxlength="250"
              placeholder="${esc(c.labels?.cancelReasonPlaceholder || c.t('cancelReasonPlaceholder'))}"></textarea>
            <div class="tgm-reason-count"><span data-tgm-reason-count>0</span>/250</div>
          </div>
          <div class="tgm-cancel-warn">${svg(IC.alert)}<span>${esc(c.labels?.cancelFinalWarn || c.t('cancelFinalWarn'))}</span></div>
          <div data-tgm-cancel-error-mount></div>`;
        foot = `
          <button type="button" class="tgm-btn-2" data-tgm-cancel-back>${esc(c.labels?.cancelBack || c.t('cancelBack'))}</button>
          <button type="button" class="tgm-btn-danger" data-tgm-cancel-confirm>${svg(IC.x)}<span data-tgm-cancel-confirm-label>${esc(c.labels?.cancelConfirm || c.t('cancelConfirm'))}</span></button>`;
      } else if (st.stage === 'working') {
        headTitle = c.labels?.cancelWorkingTitle || c.t('cancelWorkingTitle');
        headSub = c.labels?.cancelWorkingSub || c.t('cancelWorkingSub');
        body = `<div class="tgm-cancel-spin"><div class="tgm-spinner"></div><span>${esc(c.labels?.cancelWorking || c.t('cancelWorking'))}</span></div>`;
        foot = '';
      } else if (st.stage === 'done') {
        headIcon = IC.check;
        headTitle = c.labels?.cancelDoneTitle || c.t('cancelDoneTitle');
        headSub = '';
        body = `
          <div class="tgm-cancel-done">
            <div class="tgm-cancel-done-icon">${svg(IC.check)}</div>
            <h2>${esc(c.labels?.cancelDoneHead || c.t('cancelDoneHead'))}</h2>
            <p>${esc(c.labels?.cancelDoneBody || c.t('cancelDoneBodyTmpl', { label: (st.meta?.label || c.t('product')).toLowerCase() }))}</p>
            ${st.reference ? `<div class="tgm-cancel-ref">${esc(c.labels?.cancelRefLabel || c.t('cancelRefLabel'))}: ${esc(st.reference)}</div>` : ''}
          </div>`;
        foot = `<button type="button" class="tgm-btn-1" data-tgm-cancel-done>${esc(c.labels?.cancelDoneBtn || c.t('cancelDoneBtn'))}</button>`;
      } else { // 'error'
        headIcon = IC.alert;
        headTitle = c.labels?.cancelErrorTitle || c.t('cancelErrorTitle');
        headSub = '';
        body = `<div class="tgm-modal-error">${svg(IC.alert)}<span>${esc(st.error || c.t('somethingWrong'))}</span></div>`;
        foot = `<button type="button" class="tgm-btn-2" data-tgm-cancel-keep>${esc(c.labels?.cancelClose || c.t('cancelClose'))}</button>`;
      }

      mount.innerHTML = `
        <div class="tgm-modal-backdrop" data-tgm-cancel-backdrop role="dialog" aria-modal="true" aria-labelledby="tgm-cancel-title">
          <div class="tgm-modal" role="document">
            <div class="tgm-modal-head">
              <div class="tgm-modal-head-icon">${svg(headIcon)}</div>
              <div class="tgm-modal-head-text">
                <h2 class="tgm-modal-head-title" id="tgm-cancel-title">${esc(headTitle)}</h2>
                ${headSub ? `<p class="tgm-modal-head-sub">${esc(headSub)}</p>` : ''}
              </div>
              <button type="button" class="tgm-modal-close" data-tgm-cancel-close aria-label="${esc(c.t('ariaClose'))}">${svg(IC.x)}</button>
            </div>
            <div class="tgm-modal-body">${body}</div>
            ${foot ? `<div class="tgm-modal-foot">${foot}</div>` : ''}
          </div>
        </div>`;

      this._bindCancelModal(mount);
    }

    _bindCancelModal(mount) {
      const close = () => this._closeCancel();

      const backdrop = mount.querySelector('[data-tgm-cancel-backdrop]');
      const closeBtn = mount.querySelector('[data-tgm-cancel-close]');
      if (closeBtn) closeBtn.addEventListener('click', close);
      if (backdrop) {
        let downOnBackdrop = false;
        backdrop.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === backdrop; });
        backdrop.addEventListener('mouseup', (e) => {
          if (downOnBackdrop && e.target === backdrop) close();
          downOnBackdrop = false;
        });
      }

      // Esc to close (bound once per open flow).
      if (!this._cancelEscHandler) {
        this._cancelEscHandler = (e) => { if (e.key === 'Escape') this._closeCancel(); };
        document.addEventListener('keydown', this._cancelEscHandler);
      }

      const keepBtn = mount.querySelector('[data-tgm-cancel-keep]');
      if (keepBtn) keepBtn.addEventListener('click', close);

      const continueBtn = mount.querySelector('[data-tgm-cancel-continue]');
      if (continueBtn) continueBtn.addEventListener('click', () => {
        this._cancel.stage = 'reason';
        this._renderCancelModal();
      });

      const backBtn = mount.querySelector('[data-tgm-cancel-back]');
      if (backBtn) backBtn.addEventListener('click', () => {
        this._cancel.stage = 'policies';
        this._renderCancelModal();
      });

      const reason = mount.querySelector('[data-tgm-cancel-reason]');
      const counter = mount.querySelector('[data-tgm-reason-count]');
      if (reason) {
        reason.addEventListener('input', () => { if (counter) counter.textContent = String(reason.value.length); });
        requestAnimationFrame(() => reason.focus());
      }

      const confirmBtn = mount.querySelector('[data-tgm-cancel-confirm]');
      if (confirmBtn) confirmBtn.addEventListener('click', () => {
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;
        const label = mount.querySelector('[data-tgm-cancel-confirm-label]');
        if (label) label.textContent = this.c.labels?.cancelConfirming || this.t('cancelConfirming');
        this._cancelConfirm(reason ? reason.value : '');
      });

      const doneBtn = mount.querySelector('[data-tgm-cancel-done]');
      if (doneBtn) doneBtn.addEventListener('click', () => this._finishCancel());
    }

    _handleEmailOpen(btn) {
      // The Email button doesn't trigger any fetch itself — the PDF is
      // generated server-side as part of the email send. So we open the
      // modal immediately and don't show the button spinner unless something
      // long-running starts.
      const root = this.shadow.querySelector('.tgm-root');
      const mount = root?.querySelector('[data-tgm-modal-mount]');
      if (!mount) return;

      // If a modal is already open (defensive — shouldn't happen) close it
      // before opening another.
      if (this._emailModalOpen) this._closeEmailModal();

      const order = this.state.order;
      const customerEmail = (order?.customerEmail || this.lookup?.email || '').trim();
      const customerFirstName = (order?.customerFirstname || '').trim();

      // The customer's email is the canonical "to" — pre-fill it. They can
      // edit it but the server will reject the send if their booking email
      // isn't somewhere in the recipient list (anti-abuse).
      mount.innerHTML = this._renderEmailModal({
        customerEmail,
        customerFirstName,
        filename: this._pdfFilename(),
      });

      const backdrop = mount.querySelector('[data-tgm-modal-backdrop]');
      const modal = mount.querySelector('.tgm-modal');
      const closeBtn = mount.querySelector('[data-tgm-modal-close]');
      const cancelBtn = mount.querySelector('[data-tgm-modal-cancel]');
      const sendBtn = mount.querySelector('[data-tgm-modal-send]');
      const toInput = mount.querySelector('[data-tgm-modal-to]');

      // Click outside to close, but not when click started inside the modal
      // and ended on the backdrop (avoids closing during text selection drags).
      let downOnBackdrop = false;
      backdrop.addEventListener('mousedown', (e) => {
        downOnBackdrop = e.target === backdrop;
      });
      backdrop.addEventListener('mouseup', (e) => {
        if (downOnBackdrop && e.target === backdrop) this._closeEmailModal();
        downOnBackdrop = false;
      });

      if (closeBtn) closeBtn.addEventListener('click', () => this._closeEmailModal());
      if (cancelBtn) cancelBtn.addEventListener('click', () => this._closeEmailModal());
      if (sendBtn) sendBtn.addEventListener('click', () => this._sendEmail(sendBtn, mount));

      // Esc to close — bound at document level since focus may be inside
      // an input. Stored on instance so we can remove on close.
      this._emailEscHandler = (e) => {
        if (e.key === 'Escape') this._closeEmailModal();
      };
      document.addEventListener('keydown', this._emailEscHandler);

      // Auto-focus the To input. Defer to next frame so the modal animation
      // doesn't fight focus assignment.
      requestAnimationFrame(() => {
        if (toInput) toInput.focus();
      });

      this._emailModalOpen = true;
      this._fireEvent('email-modal-opened');
    }

    _renderEmailModal({ customerEmail, customerFirstName, filename }) {
      const c = this.c;
      const greeting = customerFirstName
        ? c.t('emailModalSubName', { name: customerFirstName })
        : c.t('emailModalSub');

      return `
        <div class="tgm-modal-backdrop" data-tgm-modal-backdrop role="dialog" aria-modal="true" aria-labelledby="tgm-modal-title">
          <div class="tgm-modal" role="document">
            <div class="tgm-modal-head">
              <div class="tgm-modal-head-icon">${svg(IC.mail)}</div>
              <div class="tgm-modal-head-text">
                <h2 class="tgm-modal-head-title" id="tgm-modal-title">${esc(c.labels?.emailModalTitle || c.t('emailModalTitle'))}</h2>
                <p class="tgm-modal-head-sub">${esc(c.labels?.emailModalSub || greeting)}</p>
              </div>
              <button type="button" class="tgm-modal-close" data-tgm-modal-close aria-label="${esc(c.t('ariaClose'))}">${svg(IC.x)}</button>
            </div>
            <div class="tgm-modal-body">
              <div class="tgm-modal-field">
                <label for="tgm-modal-to-input">${esc(c.labels?.emailTo || c.t('emailTo'))}</label>
                <input
                  id="tgm-modal-to-input"
                  type="email"
                  class="tgm-modal-input"
                  data-tgm-modal-to
                  value="${esc(customerEmail)}"
                  placeholder="you@example.com"
                  autocomplete="email"
                  spellcheck="false"
                />
                <div class="tgm-modal-help">${esc(c.labels?.emailToHelp || c.t('emailToHelp'))}</div>
              </div>
              <div class="tgm-modal-field">
                <label for="tgm-modal-cc-input">${esc(c.labels?.emailCc || c.t('emailCc'))}</label>
                <input
                  id="tgm-modal-cc-input"
                  type="text"
                  class="tgm-modal-input"
                  data-tgm-modal-cc
                  placeholder="someone@example.com, another@example.com"
                  spellcheck="false"
                />
                <div class="tgm-modal-help">${esc(c.labels?.emailCcHelp || c.t('emailCcHelp'))}</div>
              </div>
              <div class="tgm-modal-field">
                <label for="tgm-modal-message-input">${esc(c.labels?.emailMessage || c.t('emailMessage'))}</label>
                <textarea
                  id="tgm-modal-message-input"
                  class="tgm-modal-textarea"
                  data-tgm-modal-message
                  rows="3"
                  maxlength="1000"
                  placeholder="${esc(c.labels?.emailMessagePlaceholder || c.t('emailMessagePlaceholder'))}"
                ></textarea>
              </div>
              <div class="tgm-modal-field">
                <label>${esc(c.labels?.emailAttachment || c.t('emailAttachment'))}</label>
                <div class="tgm-modal-attach">
                  <div class="tgm-modal-attach-icon">${svg(IC.file)}</div>
                  <div class="tgm-modal-attach-text">
                    <div class="tgm-modal-attach-name">${esc(filename)}</div>
                    <div class="tgm-modal-attach-meta">${esc(c.labels?.emailAttachmentMeta || c.t('emailAttachmentMeta'))}</div>
                  </div>
                </div>
              </div>
              <div data-tgm-modal-error-mount></div>
            </div>
            <div class="tgm-modal-foot">
              <button type="button" class="tgm-btn-2" data-tgm-modal-cancel>${esc(c.labels?.emailCancel || c.t('emailCancel'))}</button>
              <button type="button" class="tgm-btn-1" data-tgm-modal-send>
                ${svg(IC.mail)}
                <span data-tgm-modal-send-label>${esc(c.labels?.emailSend || c.t('emailSend'))}</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    async _sendEmail(sendBtn, mount) {
      if (sendBtn.disabled) return;

      const toInput = mount.querySelector('[data-tgm-modal-to]');
      const ccInput = mount.querySelector('[data-tgm-modal-cc]');
      const messageInput = mount.querySelector('[data-tgm-modal-message]');
      const errorMount = mount.querySelector('[data-tgm-modal-error-mount]');
      const sendLabel = mount.querySelector('[data-tgm-modal-send-label]');

      const showError = (msg) => {
        if (errorMount) {
          errorMount.innerHTML = `<div class="tgm-modal-error">${svg(IC.alert)}<span>${esc(msg)}</span></div>`;
        }
      };
      const clearError = () => { if (errorMount) errorMount.innerHTML = ''; };

      clearError();

      const toEmail = (toInput?.value || '').trim().toLowerCase();
      const ccRaw = (ccInput?.value || '').trim();
      const message = (messageInput?.value || '').trim();

      // Same regex as server-side validator. Done client-side too so the user
      // gets instant feedback rather than waiting for a round-trip.
      const emailRe = /^[^\s@<>(),;:"\[\]\\]+@[^\s@<>(),;:"\[\]\\]+\.[^\s@<>(),;:"\[\]\\]+$/;

      if (!toEmail || !emailRe.test(toEmail)) {
        showError(this.t('emailInvalidTo'));
        toInput?.focus();
        return;
      }

      // CC parsing: comma/semicolon separated, max 3, no duplicates.
      const ccCandidates = ccRaw
        ? ccRaw.split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean)
        : [];
      const ccEmails = [];
      const seen = new Set([toEmail]);
      for (const c of ccCandidates) {
        if (!emailRe.test(c)) {
          showError(this.t('emailInvalidCc', { email: c }));
          ccInput?.focus();
          return;
        }
        if (seen.has(c)) continue;
        seen.add(c);
        ccEmails.push(c);
        if (ccEmails.length >= 3) break;
      }
      if (ccCandidates.length > 3) {
        showError(this.t('emailTooManyCc'));
        return;
      }

      // Server enforces this too — but giving the user the message client-side
      // means we don't fire a request we know will fail.
      //
      // Bypass: the demo widget (widgetId === 'DEMO_WIDGET_ID') skips this
      // check so Andy can test arbitrary recipients from /demo-mybooking.
      // Must match the server-side DEMO_WIDGET_SENTINEL bypass in
      // api/booking-email.js or the user gets a confusing experience:
      // server would accept it but client refuses to fire the request.
      const isDemoWidget = this.c.widgetId === 'DEMO_WIDGET_ID';
      const customerEmail = (this.state.order?.customerEmail || this.lookup?.email || '').trim().toLowerCase();
      if (!isDemoWidget && customerEmail) {
        const allRecipients = new Set([toEmail, ...ccEmails]);
        if (!allRecipients.has(customerEmail)) {
          showError(this.t('emailHolderReqd', { email: customerEmail }));
          return;
        }
      }

      // Loading state on the send button. Modal stays open so we can show
      // errors without losing the user's input.
      sendBtn.disabled = true;
      const previousLabel = sendLabel?.textContent || this.t('emailSend');
      if (sendLabel) sendLabel.textContent = this.t('emailSending');

      const loadingToastId = this._showToast('loading', this.t('emailToastSendTitle'), this.t('emailToastSendSub'));

      try {
        const res = await fetch(API_EMAIL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widgetId: this.c.widgetId,
            emailAddress: this.lookup.email,
            departDate: this.lookup.date,
            orderRef: this.lookup.ref,
            toEmail,
            ccEmails,
            message,
          }),
        });

        this._dismissToast(loadingToastId);

        if (!res.ok) {
          let serverErr = '';
          try { const j = await res.json(); serverErr = j?.error || ''; } catch {}
          if (res.status === 429) {
            showError(this.t('emailTooMany'));
          } else if (res.status === 400 && serverErr === 'recipient_mismatch') {
            showError(this.t('emailHolderReqdShort'));
          } else if (res.status === 400 && serverErr === 'invalid_recipients') {
            showError(this.t('emailInvalidRecipients'));
          } else if (res.status === 400 && serverErr === 'invalid_message') {
            showError(this.t('emailInvalidMessage'));
          } else if (res.status === 502 || serverErr === 'send_failed') {
            showError(this.t('emailSendFailed'));
          } else if (res.status === 404) {
            showError(this.t('emailNotFound'));
          } else {
            showError(this.t('genericError'));
          }
          return;
        }

        // Success — close modal and show toast.
        const data = await res.json().catch(() => ({}));
        const sentTo = data?.sentTo || toEmail;
        this._closeEmailModal();
        this._showToast('success', this.t('emailSentTitle'), this.t('emailSentSub', { email: sentTo }), 5000);
        this._fireEvent('email-sent', { sentTo, ccCount: ccEmails.length });

      } catch (err) {
        this._dismissToast(loadingToastId);
        showError(this.t('emailNetworkError'));
      } finally {
        sendBtn.disabled = false;
        if (sendLabel) sendLabel.textContent = previousLabel;
      }
    }

    _closeEmailModal() {
      const root = this.shadow.querySelector('.tgm-root');
      const mount = root?.querySelector('[data-tgm-modal-mount]');
      if (mount) mount.innerHTML = '';
      if (this._emailEscHandler) {
        document.removeEventListener('keydown', this._emailEscHandler);
        this._emailEscHandler = null;
      }
      this._emailModalOpen = false;
      this._fireEvent('email-modal-closed');
    }

    _showToast(type, title, sub, autoDismissMs) {
      const stack = this.shadow.querySelector('[data-tgm-toast-stack]');
      if (!stack) return null;

      const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const iconPath = type === 'success' ? IC.check : (type === 'error' ? IC.alert : '');
      const node = document.createElement('div');
      node.className = 'tgm-toast is-' + type;
      node.setAttribute('data-toast-id', id);
      node.setAttribute('role', type === 'error' ? 'alert' : 'status');
      node.innerHTML = `
        <div class="tgm-toast-icon">${iconPath ? svg(iconPath, 2.5) : ''}</div>
        <div class="tgm-toast-content">
          <div class="tgm-toast-title">${esc(title)}</div>
          ${sub ? `<div class="tgm-toast-sub">${esc(sub)}</div>` : ''}
        </div>
      `;
      stack.appendChild(node);

      if (autoDismissMs && autoDismissMs > 0) {
        const timer = setTimeout(() => this._dismissToast(id), autoDismissMs);
        this._toastTimers.set(id, timer);
      }

      return id;
    }

    _dismissToast(id) {
      if (!id) return;
      const timer = this._toastTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this._toastTimers.delete(id);
      }
      const stack = this.shadow.querySelector('[data-tgm-toast-stack]');
      if (!stack) return;
      const node = stack.querySelector('[data-toast-id="' + id + '"]');
      if (!node) return;
      node.classList.add('is-leaving');
      setTimeout(() => { try { node.remove(); } catch {} }, 250);
    }

    _fireEvent(name, detail) {
      try {
        this.el.dispatchEvent(new CustomEvent('tg-mybooking:' + name, { detail, bubbles: true }));
      } catch {}
    }

    /**
     * Returns a redacted, privacy-safe summary of the loaded booking suitable
     * for passing to AI as conversational context (e.g. so Luna chat can
     * answer follow-up questions without re-asking the visitor for facts
     * already on screen). Returns null until the booking is fully loaded.
     *
     * Deliberately strips:
     *   - All names (first, last, traveller titles)
     *   - Email addresses
     *   - Booking reference / order ID
     *   - Total price, deposit, balance, payment details
     *   - Special requests (free text — could contain anything)
     *   - Hotel review platform data
     *
     * Keeps only what's needed to give relevant trip-context advice:
     * destination, dates, hotel name, airports, airline, party shape.
     */
    getSafeContextSummary() {
      try {
        if (this.state?.stage !== 'found') return null;
        const order = this.state.order;
        if (!order) return null;

        const items = Array.isArray(order.items) ? order.items : [];
        const accItem = items.find(i => i.product === 'Accommodation' || i.product === 'Packages') || null;
        const flightItems = items.filter(i => i.product === 'Flights' || i.product === 'Packages');
        const acc = accItem?.accommodation;

        const startDate = accItem?.startDate || order.summary?.earliestStart || null;
        const nights = accItem?.duration || 0;
        const endDateMs = startDate ? new Date(startDate).getTime() + nights * 86400000 : null;
        const endDate = endDateMs ? new Date(endDateMs).toISOString().slice(0, 10) : null;

        // Aggregate flight info — outbound and inbound separately
        const outboundRoute = flightItems[0]?.flights?.routes?.find(r => /outbound/i.test(r.direction || '')) || flightItems[0]?.flights?.routes?.[0] || null;
        const inboundRoute = flightItems[0]?.flights?.routes?.find(r => /inbound|return/i.test(r.direction || '')) || flightItems[0]?.flights?.routes?.[1] || null;

        function legSummary(route) {
          if (!route || !Array.isArray(route.segments) || route.segments.length === 0) return null;
          const segs = route.segments;
          const first = segs[0];
          const last = segs[segs.length - 1];
          const carriers = new Set();
          for (const s of segs) {
            if (s.marketingCarrier?.name) carriers.add(s.marketingCarrier.name);
          }
          const stops = segs.length - 1;
          const stopAirports = stops > 0 ? segs.slice(0, -1).map(s => s.destination?.iataCode).filter(Boolean) : [];
          return {
            from: first.origin?.iataCode || null,
            to: last.destination?.iataCode || null,
            airline: Array.from(carriers).slice(0, 2).join(', ') || null,
            stops,
            stopAirports: stopAirports.length ? stopAirports : null,
            cabin: first.cabinClass || null,
          };
        }

        // Party shape — count types only, never names
        const travellersRaw = (order.summary?.travellers && order.summary.travellers.length)
          ? order.summary.travellers
          : (acc?.guests || []);
        let adults = 0, children = 0, infants = 0;
        for (const t of travellersRaw) {
          const type = String(t?.type || 'Adult').toLowerCase();
          if (type.includes('infant')) infants++;
          else if (type.includes('child')) children++;
          else adults++;
        }
        // Fallback if traveller list was empty but we have accommodation info
        if (adults + children + infants === 0) {
          adults = acc?.units?.[0]?.sleepsAdults || 0;
        }

        // Compute the trip-start countdown once. Field is named neutrally
        // ('daysUntilTripStart') so Luna's prompt doesn't see 'departure' on
        // an accommodation-only booking and start writing "you fly in 188
        // days" — same class of bug as the on-screen countdown. Legacy
        // 'daysUntilDeparture' kept as an alias so any existing Luna prompt
        // referencing it still resolves.
        const daysUntilStart = daysUntil(startDate);

        const summary = {
          destinationCity: acc?.location?.city || null,
          destinationCountry: acc?.location?.country || null,
          hotelName: acc?.name || null,
          startDate,            // ISO yyyy-mm-dd
          endDate,              // ISO yyyy-mm-dd
          nights: nights || null,
          daysUntilTripStart: daysUntilStart,
          daysUntilDeparture: daysUntilStart, // legacy alias — do not remove
          tripStartEvent: flightItems.length > 0
            ? 'flight'
            : (acc ? 'check-in' : 'travel'),
          // Translate Travelify's machine enum (e.g. 'BedAndBreakfast') to a
          // readable label so Luna can use it directly in conversation.
          // fmtBoard returns null for unknown / "Unknown" values.
          boardBasis: fmtBoard(acc?.units?.[0]?.rates?.[0]?.board),
          outboundFlight: legSummary(outboundRoute),
          inboundFlight: legSummary(inboundRoute),
          adults,
          children,
          infants,
        };

        // Strip null/empty values so the prompt context is compact
        const cleaned = {};
        for (const k of Object.keys(summary)) {
          const v = summary[k];
          if (v == null) continue;
          if (typeof v === 'number' && v === 0 && (k === 'children' || k === 'infants')) continue;
          if (typeof v === 'object' && v !== null && Object.keys(v).every(kk => v[kk] == null)) continue;
          cleaned[k] = v;
        }

        return cleaned;
      } catch (e) {
        // Defensive: never break the widget over context extraction
        return null;
      }
    }

    update(newConfig) {
      this.c = this._defaults(Object.assign({}, this.c, newConfig));
      ensureFont(safeFontStackM(this.c.fontFamily, '')); // load the client-chosen web font on the host site (house rule 2)
      this.t = makeT(this.c);
      this.c.t = this.t;
      this._render();
    }

    destroy() {
      try {
        for (const t of this._toastTimers.values()) clearTimeout(t);
        this._toastTimers.clear();
        this._discardPdfCache();
        if (this._emailEscHandler) {
          document.removeEventListener('keydown', this._emailEscHandler);
          this._emailEscHandler = null;
        }
        this._emailModalOpen = false;
        if (this._resizeObserver) {
          try { this._resizeObserver.disconnect(); } catch (_) {}
          this._resizeObserver = null;
        }
        this.shadow.innerHTML = '';
      } catch {}
    }
  }

  // ----- Auto init -----
  async function loadConfig(widgetId) {
    const url = API_CONFIG + '?id=' + encodeURIComponent(widgetId);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Config load failed');
    const data = await res.json();
    const config = data.config || {};
    config.widgetId = widgetId;
    return config;
  }

  async function init() {
    const containers = document.querySelectorAll('[data-tg-widget="mybooking"]');
    for (const el of containers) {
      if (el.__tgmInitialised) continue;
      el.__tgmInitialised = true;
      try {
        const inlineConfig = el.getAttribute('data-tg-config');
        const widgetId = el.getAttribute('data-tg-id');
        let config;
        if (inlineConfig) {
          try {
            config = JSON.parse(inlineConfig);
            if (widgetId && !config.widgetId) config.widgetId = widgetId;
          } catch {
            config = {};
          }
        } else if (widgetId) {
          config = await loadConfig(widgetId);
        } else {
          config = {};
        }
        new TGMyBookingWidget(el, config);
      } catch (err) {
        console.warn('[TG My Booking] init failed:', err.message);
      }
    }
  }

  window.TGMyBookingWidget = TGMyBookingWidget;
  window.__TG_MYBOOKING_VERSION__ = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
