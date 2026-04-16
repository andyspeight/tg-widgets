/**
 * Widget AI Generator
 * POST /api/widget-ai  { prompt: "..." }  → returns generated config JSON
 * 
 * Env vars required:
 *   ANTHROPIC_API_KEY — Claude API key
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ANTHROPIC_API_KEY } = process.env;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  const { prompt } = req.body || {};
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `You are a pricing table widget configuration generator. Based on this description, generate a complete JSON config. Return ONLY valid JSON with no markdown, no backticks, no explanation.

Description: "${prompt}"

Return JSON in this exact shape:
{
  "header": { "title": "string", "subtitle": "string" },
  "brandColor": "#hex",
  "accentColor": "#hex",
  "pageBg": "#F8FAFC",
  "cardBg": "#FFFFFF",
  "textColor": "#0F172A",
  "subtextColor": "#64748B",
  "borderRadius": 16,
  "showToggle": true,
  "showBadge": true,
  "showIcons": true,
  "showDescription": true,
  "showHints": true,
  "showTrustStrip": true,
  "trustText": "guarantee text",
  "savingsLabel": "Save {pct}%",
  "theme": "light",
  "plans": [
    {
      "id": "unique_id",
      "name": "Plan Name",
      "description": "Short description",
      "monthlyPrice": 29,
      "yearlyPrice": 290,
      "currency": "£",
      "icon": "Zap|Star|Crown|Shield|Sparkles|Award",
      "highlighted": false,
      "badge": "",
      "cta": "Get Started",
      "ctaUrl": "#",
      "features": [
        { "text": "Feature name", "included": true, "hint": "Optional tooltip" }
      ]
    }
  ]
}

Rules:
- Generate 2-4 plans, one must be highlighted with a badge
- Features must be realistic for the described business
- Use £ for UK businesses, $ for US, € for EU
- Include helpful tooltip hints on at least 3 features per plan
- CTAs should be action-oriented and varied per plan
- Prices must be realistic for the industry
- Choose complementary brand and accent colours
- Trust text should be relevant to the business type`
        }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Claude API error: ${resp.status} — ${err}`);
    }

    const data = await resp.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const config = JSON.parse(clean);

    return res.status(200).json(config);
  } catch (err) {
    console.error('[widget-ai]', err);
    return res.status(500).json({ error: 'AI generation failed: ' + err.message });
  }
}
