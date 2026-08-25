// =============================================================================
//  /console — the operator console
// =============================================================================
//  Phase 0 shell. It proves the two things phase 0 exists to prove: that SSO
//  against tg-widgets resolves a real session, and that the Trips database
//  answers. Phase 1 turns this into the real trips list with create and edit.
// =============================================================================

import { getSession, getOperatorId } from '@/lib/auth';
import { sbRequest, tripsDbConfigured } from '@/lib/supabase';
import type { Trip } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ConsolePage() {
  const session = await getSession();

  if (!session) {
    return (
      <main style={{ maxWidth: 640, margin: '80px auto', padding: '0 24px' }}>
        <h1>Sign in to continue</h1>
        <p style={{ color: 'var(--tg-ink-2)' }}>
          Trips uses your existing Travelgenix sign-in. There is no separate account here.
        </p>
        <p>
          <a href="https://id.travelify.io/signin">Sign in at id.travelify.io</a>
        </p>
      </main>
    );
  }

  const operatorId = await getOperatorId(session);

  let trips: Trip[] = [];
  let dbError: string | null = null;

  if (operatorId && tripsDbConfigured()) {
    try {
      trips =
        (await sbRequest<Trip[]>(
          `gt_trips?operator_id=eq.${operatorId}&select=*&order=created_at.desc`,
        )) ?? [];
    } catch (err) {
      dbError = err instanceof Error ? err.message : 'Could not read trips';
    }
  }

  return (
    <main style={{ maxWidth: 880, margin: '56px auto', padding: '0 24px' }}>
      <p style={{ color: 'var(--tg-muted)', fontSize: 13, margin: 0 }}>
        {session.clientName || session.email}
      </p>
      <h1 style={{ margin: '4px 0 24px' }}>Trips</h1>

      {!operatorId && (
        <Notice tone="warn">
          Your account is signed in but is not set up as an operator yet. Phase 1 adds the
          onboarding step that creates the operator record.
        </Notice>
      )}

      {!tripsDbConfigured() && (
        <Notice tone="warn">
          The Trips database is not configured. Set TRIPS_SUPABASE_URL and
          TRIPS_SUPABASE_SERVICE_ROLE_KEY.
        </Notice>
      )}

      {dbError && <Notice tone="error">{dbError}</Notice>}

      {operatorId && !dbError && trips.length === 0 && (
        <Notice tone="calm">No trips yet. Creating one arrives in phase 1.</Notice>
      )}

      {trips.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {trips.map((t) => (
            <li
              key={t.id}
              style={{ padding: '14px 0', borderBottom: '1px solid var(--tg-rule)' }}
            >
              <strong>{t.title}</strong>
              <span style={{ color: 'var(--tg-muted)', marginLeft: 10, fontSize: 13 }}>
                {t.status} · {t.kind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Notice({ tone, children }: { tone: 'calm' | 'warn' | 'error'; children: React.ReactNode }) {
  const colour = tone === 'error' ? 'var(--tg-danger)' : tone === 'warn' ? 'var(--tg-ink-2)' : 'var(--tg-muted)';
  return (
    <p
      style={{
        border: '1px solid var(--tg-rule)',
        borderLeft: `3px solid ${colour}`,
        padding: '14px 16px',
        color: colour,
        background: 'var(--tg-surface)',
        borderRadius: 'var(--tg-radius)',
      }}
    >
      {children}
    </p>
  );
}
