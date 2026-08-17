'use client';

/**
 * The domains tab: a client points their own web address at their site.
 *
 * SELF-CONTAINED, LOADED WHEN OPENED, the same shape as the custom code panel. It
 * reads its own list on mount rather than being handed one as a prop, because the
 * tab is drawn only for an owner or staff and opened deliberately, so one read
 * when it is first looked at is cheaper than threading a list through every render
 * of the settings screen.
 *
 * WHAT IT DOES NOT DECIDE. Every button here calls a server action that checks for
 * itself that the caller may change domains and that talks to Vercel behind the
 * one boundary file. The panel shows status and the DNS records to set; it never
 * attaches a domain or issues a certificate itself. The record to show is worked
 * out by a pure helper (an apex gets an A record, a subdomain a CNAME), so it is
 * right for theiragency.co.uk as well as theiragency.com.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';

import {
  addDomainAction,
  listDomainsAction,
  refreshDomainAction,
  removeDomainAction,
  setPrimaryDomainAction,
  type DomainsView,
} from '../../app/actions/domains';
import type { SiteDomain } from '../../lib/db/tenants';
import { pointingRecord } from '../../lib/domains/dns';
import { Icon } from '../editor/Icon';

export function DomainsPanel() {
  const [view, setView] = useState<DomainsView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [busy, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await listDomainsAction();
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setView(result.data);
    });
    // Once, on mount, and again after a primary changes because that moves the
    // flag on more than one row.
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!view) return <p className="tv-note">Reading your domains…</p>;

  const { domains, hostingConnected, previewUrl } = view;
  const custom = domains.filter((d) => d.kind === 'custom');

  function replace(next: SiteDomain) {
    setView((current) =>
      current && {
        ...current,
        domains: current.domains.some((d) => d.hostname === next.hostname)
          ? current.domains.map((d) => (d.hostname === next.hostname ? next : d))
          : [next, ...current.domains],
      },
    );
  }

  function drop(hostname: string) {
    setView((current) =>
      current && { ...current, domains: current.domains.filter((d) => d.hostname !== hostname) },
    );
  }

  function add() {
    const hostname = adding.trim();
    if (!hostname) return;
    setMessage(null);
    startTransition(async () => {
      const result = await addDomainAction(hostname);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      replace(result.data);
      setAdding('');
    });
  }

  function check(hostname: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await refreshDomainAction(hostname);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      if (result.data) replace(result.data);
    });
  }

  function remove(hostname: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await removeDomainAction(hostname);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      drop(hostname);
    });
  }

  function makePrimary(hostname: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await setPrimaryDomainAction(hostname);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      load();
    });
  }

  return (
    <section className="tv-group" aria-label="Domains">
      <p className="tv-note">
        Your site is always reachable at{' '}
        <a href={previewUrl} target="_blank" rel="noreferrer">
          <code>{previewUrl.replace(/^https?:\/\//, '')}</code>
        </a>
        . Add a web address you own to use it instead. We look after the
        certificate, so the site stays on https with nothing for you to renew.
      </p>

      {!hostingConnected && (
        <p className="st-warn">
          <Icon name="warning" size={16} />
          Custom domains are being switched on for your account. You can add your
          address now and it will finish connecting shortly.
        </p>
      )}

      {message && (
        <p className="sv-msg" role="alert">
          <Icon name="warning" size={16} />
          {message}
        </p>
      )}

      <div className="st-domain-add">
        <input
          className="tv-input"
          type="text"
          value={adding}
          placeholder="yourname.co.uk"
          aria-label="The web address you own"
          spellCheck={false}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="tg-btn"
          data-variant="primary"
          disabled={busy || !adding.trim()}
          onClick={add}
        >
          <Icon name="plus" size={16} />
          Add domain
        </button>
      </div>

      {custom.length === 0 ? (
        <p className="tv-note">
          No custom domain yet. When you have one, add it above and we will show you
          the two lines to set at your domain provider.
        </p>
      ) : (
        <ul className="st-domains">
          {custom.map((domain) => (
            <DomainRow
              key={domain.hostname}
              domain={domain}
              hostingConnected={hostingConnected}
              busy={busy}
              onCheck={check}
              onRemove={remove}
              onPrimary={makePrimary}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function StatusPill({ status }: { status: SiteDomain['sslStatus'] }) {
  if (status === 'active') {
    return (
      <span className="sv-pill" data-state="published">
        Live
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="sv-pill" data-state="changed">
        Not working
      </span>
    );
  }
  return (
    <span className="sv-pill" data-state="scheduled">
      Awaiting DNS
    </span>
  );
}

function DomainRow({
  domain,
  hostingConnected,
  busy,
  onCheck,
  onRemove,
  onPrimary,
}: {
  domain: SiteDomain;
  hostingConnected: boolean;
  busy: boolean;
  onCheck: (hostname: string) => void;
  onRemove: (hostname: string) => void;
  onPrimary: (hostname: string) => void;
}) {
  const record = pointingRecord(domain.hostname);
  const live = domain.sslStatus === 'active';
  const challenges = domain.verification.filter((v) => v.type.toUpperCase() === 'TXT');

  return (
    <li className="st-domain">
      <div className="st-domain__head">
        <span className="st-domain__name">
          {live ? (
            <a href={`https://${domain.hostname}`} target="_blank" rel="noreferrer">
              {domain.hostname}
            </a>
          ) : (
            domain.hostname
          )}
          {domain.isPrimary && <span className="st-domain__main">Main</span>}
        </span>
        <StatusPill status={domain.sslStatus} />
      </div>

      {!live && (
        <div className="st-dns">
          <p className="tv-field__help">
            Set {challenges.length > 0 ? 'these records' : 'this record'} at whoever
            runs your domain, then press Check. A DNS change can take anything from a
            few minutes to a few hours to spread.
          </p>
          <div className="st-dns__scroll">
            <table className="st-dns__table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Points to</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{record.type}</td>
                  <td>
                    <code>{record.host}</code>
                  </td>
                  <td>
                    <code>{record.value}</code>
                  </td>
                </tr>
                {challenges.map((challenge) => (
                  <tr key={challenge.value}>
                    <td>TXT</td>
                    <td>
                      <code>{challenge.domain}</code>
                    </td>
                    <td>
                      <code>{challenge.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="st-domain__actions">
        {hostingConnected && (
          <button type="button" className="tg-btn" disabled={busy} onClick={() => onCheck(domain.hostname)}>
            Check
          </button>
        )}
        {live && !domain.isPrimary && (
          <button type="button" className="tg-btn" disabled={busy} onClick={() => onPrimary(domain.hostname)}>
            Make main
          </button>
        )}
        <button
          type="button"
          className="tg-btn"
          data-variant="danger"
          disabled={busy}
          onClick={() => onRemove(domain.hostname)}
        >
          Remove
        </button>
      </div>
    </li>
  );
}
