<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Testimonials Widget Demo — Travelgenix</title>
<meta name="description" content="Live demonstration of the Travelgenix Testimonials Widget across 6 layouts.">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    --ink:#0F172A; --sub:#475569; --mut:#94A3B8;
    --bg:#F8FAFC; --card:#FFFFFF; --bd:#E2E8F0;
    --brand:#EC4899; --brand-dk:#BE185D; --accent:#8B5CF6;
    --radius:16px; --shadow:0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.05);
    --shadow-lg:0 20px 40px rgba(15,23,42,.08);
    --font:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:var(--font);color:var(--ink);background:var(--bg);line-height:1.55;-webkit-font-smoothing:antialiased}
  a{color:inherit}
  img,svg{display:block}

  /* ── Demo banner ─────────────────────────── */
  .demo-banner{
    background:linear-gradient(90deg,#1E293B,#0F172A);
    color:#fff;padding:10px 20px;text-align:center;
    font-size:12px;font-weight:500;letter-spacing:.02em;
  }
  .demo-banner strong{color:#F9A8D4}
  .demo-banner a{color:#F9A8D4;text-decoration:underline;text-underline-offset:2px}

  /* ── Nav ─────────────────────────────────── */
  .nav{
    max-width:1240px;margin:0 auto;padding:20px 32px;
    display:flex;align-items:center;gap:32px;
  }
  .nav-logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;letter-spacing:-.01em}
  .nav-logo-mark{
    width:36px;height:36px;border-radius:10px;
    background:linear-gradient(135deg,var(--brand),var(--accent));
    display:flex;align-items:center;justify-content:center;color:#fff;
  }
  .nav-links{display:flex;gap:28px;margin-left:auto;font-size:14px;font-weight:600;color:var(--sub)}
  .nav-links a{text-decoration:none;transition:color .15s}
  .nav-links a:hover{color:var(--brand)}
  .nav-cta{
    padding:10px 18px;border-radius:10px;background:var(--ink);color:#fff;
    font-size:13px;font-weight:700;text-decoration:none;transition:opacity .15s;
  }
  .nav-cta:hover{opacity:.9}
  @media (max-width:700px){ .nav-links{display:none} }

  /* ── Hero ────────────────────────────────── */
  .hero{
    max-width:1100px;margin:0 auto;padding:48px 32px 32px;text-align:center;
  }
  .hero-eyebrow{
    display:inline-flex;align-items:center;gap:8px;
    padding:6px 14px;border-radius:999px;
    background:color-mix(in srgb,var(--brand) 10%,transparent);
    color:var(--brand-dk);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  }
  @supports not (background:color-mix(in srgb,red 50%,blue)){
    .hero-eyebrow{background:#FCE7F3}
  }
  .hero-title{
    font-size:clamp(32px,5vw,52px);font-weight:900;line-height:1.08;letter-spacing:-.03em;
    margin:18px 0 14px;
  }
  .hero-title em{
    font-style:normal;
    background:linear-gradient(90deg,var(--brand),var(--accent));
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  .hero-sub{font-size:17px;color:var(--sub);max-width:620px;margin:0 auto}

  /* ── Layout switcher ─────────────────────── */
  .switcher{
    max-width:1100px;margin:36px auto 0;padding:0 32px;
    display:flex;justify-content:center;
  }
  .switcher-inner{
    display:flex;flex-wrap:wrap;gap:6px;padding:6px;
    background:var(--card);border:1px solid var(--bd);border-radius:14px;
    box-shadow:var(--shadow);
  }
  .sw-btn{
    padding:9px 16px;border-radius:9px;font:inherit;font-size:13px;font-weight:600;
    background:transparent;color:var(--sub);border:none;cursor:pointer;
    transition:background .15s,color .15s;
  }
  .sw-btn:hover{background:var(--bg);color:var(--ink)}
  .sw-btn[aria-pressed="true"]{
    background:var(--ink);color:#fff;box-shadow:0 1px 4px rgba(15,23,42,.15);
  }

  /* ── Widget mount area ───────────────────── */
  .demo-section{
    max-width:1200px;margin:0 auto;padding:48px 32px 80px;
  }
  #widget-mount{width:100%}

  /* ── Config hint ─────────────────────────── */
  .config-note{
    max-width:1100px;margin:0 auto 48px;padding:0 32px;
    display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;
    font-size:13px;color:var(--mut);
  }
  .config-note kbd{
    font-family:'SF Mono',ui-monospace,Menlo,monospace;
    background:var(--card);border:1px solid var(--bd);
    padding:3px 8px;border-radius:6px;font-size:12px;color:var(--sub);
  }

  /* ── Footer ──────────────────────────────── */
  .footer{
    max-width:1240px;margin:0 auto;padding:48px 32px 32px;
    border-top:1px solid var(--bd);
    display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:20px;
    font-size:13px;color:var(--mut);
  }
  .footer a{color:var(--sub);text-decoration:none;transition:color .15s}
  .footer a:hover{color:var(--brand)}

  @media (max-width:640px){
    .nav,.hero,.switcher,.demo-section,.config-note,.footer{padding-left:20px;padding-right:20px}
    .hero{padding-top:32px}
    .demo-section{padding-top:32px;padding-bottom:60px}
  }
</style>
</head>
<body>

<div class="demo-banner">
  <strong>DEMO PAGE</strong> · This is the Travelgenix Testimonials widget running live. <a href="https://tg-widgets.vercel.app">View all widgets</a>
</div>

<nav class="nav">
  <div class="nav-logo">
    <div class="nav-logo-mark">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
      </svg>
    </div>
    Wanderlust Travel
  </div>
  <div class="nav-links">
    <a href="#">Destinations</a>
    <a href="#">Tours</a>
    <a href="#">About</a>
    <a href="#">Blog</a>
  </div>
  <a href="#" class="nav-cta">Plan your trip</a>
</nav>

<section class="hero">
  <div class="hero-eyebrow">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .587l3.668 7.431 8.2 1.192-5.934 5.782 1.4 8.168L12 18.896l-7.334 3.868 1.4-8.168L.132 9.21l8.2-1.192z"/></svg>
    What our travellers say
  </div>
  <h1 class="hero-title">
    Real stories from<br><em>real travellers</em>
  </h1>
  <p class="hero-sub">
    Browse reviews from our community of happy customers. Switch between layouts below to see how each one looks — every layout uses the same testimonial data.
  </p>
</section>

<div class="switcher" role="group" aria-label="Choose layout">
  <div class="switcher-inner">
    <button class="sw-btn" data-layout="featured"  aria-pressed="false">Featured</button>
    <button class="sw-btn" data-layout="grid"      aria-pressed="true">Grid</button>
    <button class="sw-btn" data-layout="masonry"   aria-pressed="false">Masonry</button>
    <button class="sw-btn" data-layout="carousel"  aria-pressed="false">Carousel</button>
    <button class="sw-btn" data-layout="marquee"   aria-pressed="false">Marquee</button>
    <button class="sw-btn" data-layout="spotlight" aria-pressed="false">Spotlight</button>
  </div>
</div>

<p class="config-note">
  Currently showing: <kbd id="current-layout">grid</kbd>
</p>

<section class="demo-section">
  <div id="widget-mount"></div>
</section>

<footer class="footer">
  <div>© 2026 Travelgenix — Widget Suite</div>
  <div>
    <a href="/">All widgets</a> ·
    <a href="https://github.com/andyspeight/tg-widgets">GitHub</a> ·
    <a href="/">Dashboard</a>
  </div>
</footer>

<script src="/widget-testimonials.js"></script>
<script>
  // ── Sample testimonial data (shared across all layouts) ──
  const TESTIMONIALS = [
    {
      id: 't1',
      quote: "The most magical 10 days of our lives. Every detail was handled — from the overwater villa to the private dinner on the beach. We didn't lift a finger. Already planning our next trip with Wanderlust.",
      author: "Sarah Thompson",
      role: "Honeymoon couple",
      location: "Manchester, UK",
      rating: 5,
      destination: "Maldives",
      tripType: "Honeymoon",
      travelDate: "March 2024",
      source: "Google",
      verified: true,
      featured: true
    },
    {
      id: 't2',
      quote: "We've done family trips before but nothing compares to this. The guide knew every kid in our group by name by day two. Rainforest hikes, zip-lining, and a turtle hatching on our last night. The kids still talk about it.",
      author: "Raj Patel",
      role: "Family of four",
      location: "Birmingham, UK",
      rating: 5,
      destination: "Costa Rica",
      tripType: "Family",
      travelDate: "October 2024",
      source: "Direct"
    },
    {
      id: 't3',
      quote: "Two weeks navigating Japan solo felt ambitious. Wanderlust built an itinerary that was structured enough to feel safe and loose enough to wander. Ryokan in Hakone, sushi in Tsukiji, temples in Kyoto at sunrise. Flawless.",
      author: "Michael Chen",
      role: "Solo traveller",
      location: "London, UK",
      rating: 5,
      destination: "Japan",
      tripType: "Solo",
      travelDate: "April 2024",
      source: "TripAdvisor",
      verified: true
    },
    {
      id: 't4',
      quote: "Our 10-year anniversary and they absolutely nailed it. A clifftop room in Oia, a private catamaran for sunset, a chef cooking dinner just for us one night. We came home already planning the next big trip.",
      author: "Emma & David Wilson",
      role: "Anniversary trip",
      location: "Edinburgh, UK",
      rating: 5,
      destination: "Santorini",
      tripType: "Anniversary",
      travelDate: "June 2024",
      source: "Facebook",
      verified: true,
      featured: true
    },
    {
      id: 't5',
      quote: "Booked a 12-day Alaska cruise for our extended family — 11 of us ranging from 8 to 74. Not one hiccup. The cabin assignments were spot on, every excursion suited the right group, and the team kept everyone happy. Best family trip we've ever done.",
      author: "The Johnson Group",
      role: "Multi-generational family",
      location: "Leeds, UK",
      rating: 5,
      destination: "Alaska",
      tripType: "Group",
      travelDate: "August 2024",
      source: "Trustpilot",
      verified: true
    },
    {
      id: 't6',
      quote: "Iceland in winter — glaciers, black-sand beaches, and the Northern Lights on our third night. I'm still processing the photos. Whoever designed this itinerary understood exactly what makes this country special.",
      author: "Lisa Rodriguez",
      role: "Photographer",
      location: "Bristol, UK",
      rating: 5,
      destination: "Iceland",
      tripType: "Adventure",
      travelDate: "February 2025",
      source: "Google",
      verified: true
    },
    {
      id: 't7',
      quote: "My first safari and now I want to spend every holiday doing this. Stayed at Mara Plains, saw every Big Five except rhino (and they tried!). Sundowners over the Mara will stay with me forever.",
      author: "James Foster",
      role: "Business owner",
      location: "Oxford, UK",
      rating: 5,
      destination: "Kenya",
      tripType: "Luxury",
      travelDate: "September 2024",
      source: "Google",
      verified: true
    },
    {
      id: 't8',
      quote: "Slow, beautiful, romantic — everything a second honeymoon should be. Lake Como at this time of year is a dream. Villa Balbianello at golden hour. The best cacio e pepe of my life.",
      author: "Claire Morrison",
      role: "Couple",
      location: "Bath, UK",
      rating: 4,
      destination: "Italian Lakes",
      tripType: "Couples",
      travelDate: "May 2024",
      source: "Direct"
    }
  ];

  // ── Shared widget config ─────────────────────────
  const BASE_CONFIG = {
    header: {
      show: false   // demo page has its own hero, widget shouldn't repeat it
    },
    testimonials: TESTIMONIALS,
    showRating: true,
    showSource: true,
    showDestination: true,
    showTripType: true,
    showTravelDate: true,
    showVideo: true,
    showFilters: false,  // toggled on per-layout below
    gridCols: 3,
    carousel: { autoplay: false, interval: 6000, dots: true, arrows: true },
    marquee: { speed: 50, rows: 2 },
    theme: 'light',
    brandColor: '#EC4899',
    accentColor: '#8B5CF6',
    radius: 16
  };

  // Per-layout overrides
  const LAYOUT_CONFIG = {
    featured:  { showFilters: false },
    grid:      { showFilters: true,  gridCols: 3 },
    masonry:   { showFilters: true },
    carousel:  { showFilters: false },
    marquee:   { showFilters: false },
    spotlight: { showFilters: false }
  };

  // ── Mount helper ────────────────────────────────
  function mount(layout) {
    if (!LAYOUT_CONFIG[layout]) layout = 'grid';

    const mountEl = document.getElementById('widget-mount');
    mountEl.innerHTML = '';                                    // clear previous instance

    const host = document.createElement('div');
    host.setAttribute('data-tg-widget', 'testimonials');
    host.setAttribute('data-tg-config', JSON.stringify({
      ...BASE_CONFIG,
      ...LAYOUT_CONFIG[layout],
      layout
    }));
    mountEl.appendChild(host);

    // Explicit init (widget's auto-init already ran at page load, so we call directly)
    if (window.TGTestimonials && window.TGTestimonials.init) {
      window.TGTestimonials.init(host);
    }

    // Update switcher state
    document.querySelectorAll('.sw-btn').forEach(btn => {
      const active = btn.getAttribute('data-layout') === layout;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.getElementById('current-layout').textContent = layout;

    // Update URL hash so refreshing preserves the layout
    try { history.replaceState(null, '', '#' + layout); } catch (e) { /* noop */ }
  }

  // ── Wire up the switcher ────────────────────────
  document.querySelectorAll('.sw-btn').forEach(btn => {
    btn.addEventListener('click', () => mount(btn.getAttribute('data-layout')));
  });

  // ── Initial mount — honour #layout hash if present
  const initialLayout = (location.hash || '').replace('#', '') || 'grid';
  mount(initialLayout);
</script>

</body>
</html>
