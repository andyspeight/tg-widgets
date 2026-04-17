/**
 * Widget AI Generator (Hardened)
 * POST /api/widget-ai  { prompt }  → AUTHENTICATED, returns generated config JSON
 * 
 * Security: requires valid session token (prevents credit abuse),
 * input length capped, response validated as JSON
 */
import { requireAuth, setCors } from './_auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Require authentication ────────────────────────────────
  const auth = requireAuth(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const { ANTHROPIC_API_KEY } = process.env;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI service not configured' });

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  // Cap prompt length to prevent abuse
  const safePrompt = prompt.trim().slice(0, 1000);
  if (safePrompt.length < 5) {
    return res.status(400).json({ error: 'Prompt too short — describe what you need' });
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
          content: `You are a widget configuration generator for a travel technology platform. Based on this description, generate a complete JSON config. Return ONLY valid JSON with no markdown, no backticks, no explanation.

Description: "${safePrompt}"

Return JSON matching the widget schema with header, plans/reviews, colours, and settings. Use realistic data for the described business.`
        }],
      }),
    });

    if (!resp.ok) throw new Error(`AI API error: ${resp.status}`);

    const data = await resp.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    
    // Validate it's actually JSON before returning
    const config = JSON.parse(clean);
    if (typeof config !== 'object' || config === null) {
      throw new Error('AI returned invalid structure');
    }

    return res.status(200).json(config);
  } catch (err) {
    console.error('[widget-ai]', err.message);
    return res.status(500).json({ error: 'AI generation failed. Please try a more specific description.' });
  }
}
