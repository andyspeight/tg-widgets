import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

// Same import note as /members: the error paths render .sv- classes without
// mounting a screen, and an unstyled error explains a misconfiguration badly.
import '../../components/sites/sites.css';
import { markSubmissionReadAction } from '../actions/forms';
import { activeSite, currentUser } from '../../lib/auth/session';
import { listSubmissions, type FormSubmission } from '../../lib/db/forms';

export const metadata: Metadata = {
  title: 'Enquiries · Travelgenix Sites',
  robots: { index: false, follow: false },
};

/** Never cached: an enquiry that arrived a second ago is the whole point. */
export const dynamic = 'force-dynamic';

function Problem({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="sv-wrap">
      <div className="sv-error">
        <h1 className="sv-title">{heading}</h1>
        {children}
      </div>
    </main>
  );
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Submission({ submission }: { submission: FormSubmission }) {
  const unread = submission.readAt === null;
  return (
    <article className={unread ? 'enq enq--unread' : 'enq'}>
      <header className="enq__head">
        <h2 className="enq__title">
          {unread && <span className="enq__dot" aria-label="Unread" />}
          {submission.formName || 'Form'}
        </h2>
        <span className="enq__meta">
          {submission.meta.path || '/'} · {when(submission.createdAt)}
        </span>
        {unread && (
          <form action={markSubmissionReadAction}>
            <input type="hidden" name="id" value={submission.id} />
            <button className="sv-btn" type="submit">
              Mark read
            </button>
          </form>
        )}
      </header>
      <dl className="enq__answers">
        {Object.entries(submission.data).map(([key, value]) => (
          <div className="enq__answer" key={key}>
            <dt>{key}</dt>
            <dd>{value || '-'}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export default async function EnquiriesPage() {
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  let site: Awaited<ReturnType<typeof activeSite>> = null;
  let failure: string | null = null;

  try {
    user = await currentUser();
    if (user) site = await activeSite();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (failure) {
    return (
      <Problem heading="Cannot reach the database">
        <p>The database refused the connection, so there is nothing to list.</p>
        <pre>{failure}</pre>
      </Problem>
    );
  }

  if (!user) redirect('/signin?next=%2Fenquiries');
  if (!site) redirect('/sites');

  const submissions = await listSubmissions(site.tenantId);
  const unread = submissions.filter((s) => s.readAt === null).length;

  return (
    <main className="sv-wrap">
      <header className="enq-head">
        <div>
          <h1 className="sv-title">Enquiries</h1>
          <p className="enq-sub">
            {submissions.length === 0
              ? 'What visitors send through your forms lands here.'
              : unread === 0
                ? `${submissions.length} enquir${submissions.length === 1 ? 'y' : 'ies'}, all read.`
                : `${unread} unread of ${submissions.length}.`}
          </p>
        </div>
        <a className="sv-btn" href="/">
          Back to the site
        </a>
      </header>

      {submissions.length === 0 ? (
        <div className="enq-empty">
          <p>
            No enquiries yet. Add a <strong>Form</strong> element to any page and whatever a
            visitor sends arrives here, whether or not the form also emails you a copy.
          </p>
        </div>
      ) : (
        <div className="enq-list">
          {submissions.map((submission) => (
            <Submission key={submission.id} submission={submission} />
          ))}
        </div>
      )}
    </main>
  );
}
