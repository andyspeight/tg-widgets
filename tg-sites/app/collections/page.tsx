import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

// Imported here as well as in the dashboard, for the same reason app/sites
// does it: the error paths below render .sv- classes without mounting the
// dashboard, and a bare unstyled error explains a misconfiguration badly.
import '../../components/sites/sites.css';
import { CollectionsDashboard } from '../../components/collections/CollectionsDashboard';
import { activeSite, currentUser } from '../../lib/auth/session';
import { listCollections, listItems } from '../../lib/db/collections';
import { getTenant, siteUrl } from '../../lib/db/tenants';

export const metadata: Metadata = {
  title: 'Collections · Travelgenix Sites',
  robots: { index: false, follow: false },
};

/**
 * Collections: the blog, and anything else that is a list.
 *
 * A SECOND SCREEN RATHER THAN A TAB ON /sites, because the two lists answer
 * different questions. /sites is "what pages does this site have", which is a
 * flat list somebody scans. This is "what have we written", which is a list
 * inside a list and has its own publish state per entry.
 *
 * WHICH COLLECTION IS OPEN LIVES IN THE URL, not in state. /collections?c=<id>
 * is a link an agent can bookmark, send to a colleague, or come back to after
 * editing an entry, and the back button does the obvious thing. It is also what
 * lets this stay a server render: the items are read here, so the first paint
 * is the real list rather than a spinner that becomes one.
 */
export const dynamic = 'force-dynamic';

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c: requested } = await searchParams;

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
        <p>
          The database refused the connection, so there is nothing to show yet.
          The walkthrough is in <code>tg-sites/db/SETUP.md</code>, and the message
          it gave is below.
        </p>
        <pre>{failure}</pre>
      </Problem>
    );
  }

  if (!user) redirect('/signin?next=%2Fcollections');

  if (!site) {
    return (
      <Problem heading="No sites yet">
        <p>
          You are signed in as <code>{user.email}</code>, but this account is not
          a member of any site.
        </p>
      </Problem>
    );
  }

  const [tenant, url, collections] = await Promise.all([
    getTenant(site.tenantId),
    siteUrl(site.tenantId),
    listCollections(site.tenantId),
  ]);

  /*
   * The open collection, and the rule for picking it.
   *
   * The id in the URL only counts if it is one of this site's own, which is
   * checked against the list that has already been read rather than with
   * another query. An id belonging to somebody else was never in that list, so
   * it falls through to the first collection exactly as a made-up one does and
   * confirms nothing either way.
   */
  const open = collections.find((entry) => entry.id === requested) ?? collections[0] ?? null;
  const items = open ? await listItems(site.tenantId, open.id) : [];

  return (
    <CollectionsDashboard
      account={{ email: user.email, name: user.name }}
      site={{ slug: site.slug, available: site.available }}
      siteName={tenant?.name ?? site.name}
      siteUrl={url}
      collections={collections}
      openId={open?.id ?? null}
      items={items}
    />
  );
}

// ---------------------------------------------------------------------------

function Problem({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="sv-root" data-theme="light">
      <div className="sv-wrap">
        <div className="sv-error">
          <h2>{heading}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
