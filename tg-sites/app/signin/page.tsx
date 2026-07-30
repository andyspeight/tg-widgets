import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import '../../components/sites/sites.css';
import { SignInForm } from '../../components/auth/SignInForm';
import { chooseProvider } from '../../lib/auth/identity';
import { currentUserId, sessionsAreConfigured } from '../../lib/auth/session';
import { safeReturnPath } from '../../lib/auth/return-path';
import { findCredentials } from '../../lib/db/users';

export const metadata: Metadata = {
  title: 'Sign in · Travelgenix Sites',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = safeReturnPath(next);

  // Already signed in. Nobody wants to be asked twice.
  if (await currentUserId()) redirect(destination);

  const provider = chooseProvider(findCredentials);

  return (
    <div className="sv-root" data-theme="light">
      <SignInForm
        configured={sessionsAreConfigured()}
        usesPasswordForm={provider.usesPasswordForm}
        next={destination}
      />
    </div>
  );
}
