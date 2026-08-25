// Liveness plus a truthful statement about what is wired. Deliberately says
// whether Stripe and the database are configured WITHOUT leaking any value.
import { tripsDbConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    ok: true,
    service: 'travelgenix-trips',
    phase: 0,
    database: tripsDbConfigured() ? 'configured' : 'missing',
    stripe: process.env.STRIPE_SECRET_KEY ? 'configured' : 'missing',
    stripeWebhook: process.env.STRIPE_CONNECT_WEBHOOK_SECRET ? 'configured' : 'missing',
  });
}
