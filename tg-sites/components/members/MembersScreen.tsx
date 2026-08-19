'use client';

/**
 * Who can edit this site.
 *
 * DRAWN FOR EVERYBODY, EDITABLE BY AN OWNER. Seeing who your colleagues are is
 * not a privilege, and a viewer who cannot tell whether their manager has access
 * has to ask somebody. The controls are the part that depends on the role, and
 * hiding them is a courtesy to whoever is reading the screen rather than a
 * control: the control is requireOwner in app/actions/members.ts, because a
 * server action is a public endpoint whose URL is in this file's own bundle.
 *
 * THE LINK IS SHOWN ONCE AND SAID TO BE. It is not stored, only its hash is, so
 * there is nothing to show tomorrow. The panel stays open with a copy button
 * until it is dismissed, and it says plainly that coming back means issuing a
 * new one. A credential that can be re-read is a credential sitting in a
 * database.
 *
 * NO EMAIL IS SENT, and the screen is honest about why: this product has no
 * email transport. Copying a link into whatever an agency already uses to talk
 * to each other is not a workaround, it is what Notion and Figma both offer
 * beside their email invites, and it works today.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  setDefaultPermissionsAction,
  setPermissionsAction,
  setRoleAction,
  type IssuedInvite,
} from '../../app/actions/members';
import { MEMBER_ROLES, ROLE_NOTES, type MemberRole } from '../../lib/auth/roles';
import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  PRESETS,
  type Capability,
} from '../../lib/auth/permissions';
import type { Member, PendingInvite } from '../../lib/db/members';
import type { Membership } from '../../lib/db/users';
import { AccountBar } from '../auth/AccountBar';
import { Icon } from '../editor/Icon';
import { ConfirmDialog } from '../ui/Modal';
import './members.css';

interface Props {
  account: { email: string; name: string | null };
  site: { slug: string; name: string; available: Membership[] };
  members: Member[];
  invites: PendingInvite[];
  /** Whether this person may change anything. Decided on the server. */
  canManage: boolean;
  /** The signed-in person's own user id, so the list can say "you". */
  meId: string;
  /** The site's default capabilities for a new member, or null when unset. */
  defaultPermissions: Capability[] | null;
}

export function MembersScreen({
  account,
  site,
  members,
  invites,
  canManage,
  meId,
  defaultPermissions,
}: Props) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('editor');
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Member | null>(null);
  const [busy, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setMessage(result.error ?? 'That did not work.');
        return;
      }
      router.refresh();
    });
  }

  function invite() {
    setMessage(null);
    setCopied(false);

    startTransition(async () => {
      /*
       * The origin comes from the browser rather than from a header on the
       * server. Both are attacker-influenced, so the action parses and checks
       * it either way; sending it from here keeps a preview deployment's link
       * pointing at the preview deployment.
       */
      const result = await inviteMemberAction({ email, role, origin: window.location.origin });

      if (!result.ok) {
        setMessage(result.error);
        return;
      }

      setIssued(result.data);
      setEmail('');
      router.refresh();
    });
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.link);
      setCopied(true);
    } catch {
      // Clipboard blocked, which happens over plain http and in some browsers.
      // The link is on screen and selectable, so this is a nicety failing.
      setCopied(false);
    }
  }

  return (
    <div className="sv-root" data-theme="light">
      <div className="sv-wrap">
        <header className="sv-head">
          <div>
            <p className="sv-eyebrow">People</p>
            <h1 className="sv-title">{site.name}</h1>
            <p className="sv-url">
              Who can edit this site, and what each of them is allowed to do.
            </p>
          </div>
          <div className="sv-head__right">
            <a className="sv-btn" href="/sites">
              Back to pages
            </a>
            <AccountBar
              email={account.email}
              name={account.name}
              currentSlug={site.slug}
              available={site.available}
            />
          </div>
        </header>

        {message && (
          <p className="sv-msg" role="alert">
            <Icon name="warning" size={16} />
            {message}
          </p>
        )}

        {/* --- the people ------------------------------------------------ */}

        <section className="mb-panel">
          <h2 className="mb-panel__title">
            In this site ({members.length})
          </h2>

          <ul className="mb-list">
            {members.map((member) => (
              <li key={member.userId} className="mb-row">
                <div className="mb-row__who">
                  <p className="mb-row__name">
                    {member.name || member.email}
                    {member.userId === meId && <span className="mb-you">you</span>}
                  </p>
                  {member.name && <p className="mb-row__email">{member.email}</p>}
                </div>

                <div className="mb-row__what">
                  {canManage ? (
                    <label className="mb-role">
                      <span className="tg-visually-hidden">
                        What {member.email} can do
                      </span>
                      <select
                        className="tv-select"
                        value={member.role}
                        disabled={busy}
                        onChange={(event) =>
                          run(() => setRoleAction(member.userId, event.target.value))
                        }
                      >
                        {MEMBER_ROLES.map((option) => (
                          <option key={option} value={option}>
                            {option[0].toUpperCase() + option.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="sv-pill">
                      {member.role[0].toUpperCase() + member.role.slice(1)}
                    </span>
                  )}

                  {canManage && (
                    <button
                      type="button"
                      className="sv-btn"
                      disabled={busy}
                      onClick={() => setConfirm(member)}
                    >
                      Remove
                    </button>
                  )}
                </div>

                <p className="mb-row__note">{ROLE_NOTES[member.role]}</p>

                {canManage && (
                  <MemberPermissions
                    member={member}
                    busy={busy}
                    onSave={(perms) => run(() => setPermissionsAction(member.userId, perms))}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* --- what new people can edit by default ----------------------- */}

        {canManage && (
          <DefaultPermissions
            initial={defaultPermissions}
            busy={busy}
            onSave={(perms) => run(() => setDefaultPermissionsAction(perms))}
          />
        )}

        {/* --- invited, waiting ------------------------------------------ */}

        {invites.length > 0 && (
          <section className="mb-panel">
            <h2 className="mb-panel__title">Invited, not joined yet ({invites.length})</h2>
            <ul className="mb-list">
              {invites.map((pending) => (
                <li key={pending.id} className="mb-row mb-row--pending">
                  <div className="mb-row__who">
                    <p className="mb-row__name">{pending.email}</p>
                    <p className="mb-row__email">
                      Invited as {pending.role}. The link stops working on{' '}
                      {pending.expiresAt.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'long',
                      })}
                      .
                    </p>
                  </div>
                  {canManage && (
                    <div className="mb-row__what">
                      <button
                        type="button"
                        className="sv-btn"
                        disabled={busy}
                        onClick={() => run(() => revokeInviteAction(pending.id))}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* --- inviting --------------------------------------------------- */}

        {canManage && (
          <section className="mb-panel">
            <h2 className="mb-panel__title">Invite somebody</h2>

            {issued ? (
              /*
                SHOWN ONCE. The token is not stored, so this panel is the only
                time this link exists anywhere we can reach. It says so.
              */
              <div className="mb-link">
                <p className="mb-link__lede">
                  <Icon name="check" size={16} />
                  <span>
                    Send this to <strong>{issued.invite.email}</strong>. It is the only
                    time we can show it to you, because we do not keep a copy. If it
                    goes astray, invite them again for a fresh one.
                  </span>
                </p>

                <div className="mb-link__row">
                  <input
                    className="tv-input"
                    readOnly
                    value={issued.link}
                    aria-label="The invite link"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button type="button" className="tg-btn" data-variant="primary" onClick={copy}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <button
                  type="button"
                  className="sv-btn"
                  onClick={() => {
                    setIssued(null);
                    setCopied(false);
                  }}
                >
                  Done
                </button>
              </div>
            ) : (
              <form
                className="mb-invite"
                onSubmit={(event) => {
                  event.preventDefault();
                  invite();
                }}
              >
                <div className="sv-field">
                  <label htmlFor="mb-email">Their email address</label>
                  <input
                    id="mb-email"
                    type="email"
                    value={email}
                    placeholder="sam@youragency.co.uk"
                    autoComplete="off"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <small>
                    The link only works for this address, so a forwarded one is
                    refused.
                  </small>
                </div>

                <div className="sv-field">
                  <label htmlFor="mb-role">What they can do</label>
                  <select
                    id="mb-role"
                    className="tv-select"
                    value={role}
                    onChange={(event) => setRole(event.target.value as MemberRole)}
                  >
                    {MEMBER_ROLES.map((option) => (
                      <option key={option} value={option}>
                        {option[0].toUpperCase() + option.slice(1)}
                      </option>
                    ))}
                  </select>
                  <small>{ROLE_NOTES[role]}</small>
                </div>

                <button
                  type="submit"
                  className="tg-btn"
                  data-variant="primary"
                  disabled={busy || email.trim() === ''}
                >
                  {busy ? 'Working' : 'Make an invite link'}
                </button>

                {/*
                  Said rather than left to be discovered. Somebody expecting an
                  email will sit waiting for one.
                */}
                <p className="mb-note">
                  We do not send the email. You get a link to send them however you
                  already talk to each other.
                </p>
              </form>
            )}
          </section>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title="Remove them from this site?"
          description={
            `${confirm.name || confirm.email} will not be able to open this site any `
            + 'more. Nothing they made is deleted, and you can invite them back '
            + 'whenever you like.'
          }
          confirmLabel="Remove"
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const member = confirm;
            setConfirm(null);
            run(() => removeMemberAction(member.userId));
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * What a member's tick boxes should start on. An explicit stored set is shown as
 * it is; an unset member shows the legacy default (everything for an owner or
 * editor, nothing for a viewer), which is exactly what effectiveCapabilities
 * resolves them to, so the screen and the server agree.
 */
function displayedSet(member: Member): Set<Capability> {
  if (member.permissions !== null) return new Set(member.permissions);
  return new Set(member.role === 'viewer' ? [] : ALL_CAPABILITIES);
}

/** A short word for a set, so a collapsed row says what it is at a glance. */
function summarise(value: Set<Capability>): string {
  if (value.size === ALL_CAPABILITIES.length) return 'Everything';
  if (value.size === 0) return 'Nothing';
  const contentOnly = PRESETS['content-only'];
  if (value.size === contentOnly.length && contentOnly.every((cap) => value.has(cap))) {
    return 'Content only';
  }
  return `${value.size} of ${ALL_CAPABILITIES.length}`;
}

/** The tick boxes and the two presets, shared by a member editor and the default. */
function PermissionChecklist({
  value,
  disabled,
  onChange,
}: {
  value: Set<Capability>;
  disabled: boolean;
  onChange: (next: Set<Capability>) => void;
}) {
  return (
    <div className="mb-perms">
      <div className="mb-perms__presets">
        <span className="mb-perms__presets-label">Start from</span>
        <button
          type="button"
          className="sv-btn"
          disabled={disabled}
          onClick={() => onChange(new Set(PRESETS['content-only']))}
        >
          Content only
        </button>
        <button
          type="button"
          className="sv-btn"
          disabled={disabled}
          onClick={() => onChange(new Set(PRESETS['full-restyle']))}
        >
          Full restyle
        </button>
      </div>
      <ul className="mb-perms__list">
        {CAPABILITIES.map((cap) => (
          <li key={cap.key} className="mb-perm">
            <label className="mb-perm__label">
              <input
                type="checkbox"
                checked={value.has(cap.key)}
                disabled={disabled}
                onChange={(event) => {
                  const next = new Set(value);
                  if (event.target.checked) next.add(cap.key);
                  else next.delete(cap.key);
                  onChange(next);
                }}
              />
              <span className="mb-perm__name">{cap.label}</span>
            </label>
            <span className="mb-perm__note">{cap.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One member's capabilities: a collapsed summary that opens to the checklist. */
function MemberPermissions({
  member,
  busy,
  onSave,
}: {
  member: Member;
  busy: boolean;
  onSave: (perms: Capability[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Set<Capability>>(() => displayedSet(member));

  // Re-sync when the stored set changes under us (after a save and a refresh),
  // keyed on the values rather than the array identity a fresh fetch gives.
  const signature = member.permissions === null ? `role:${member.role}` : member.permissions.join(',');
  useEffect(() => {
    setValue(displayedSet(member));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <div className="mb-row__perms">
      <button
        type="button"
        className="mb-perms__toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? 'Hide what they can edit' : 'Change what they can edit'}
        <span className="mb-perms__summary">{summarise(value)}</span>
      </button>
      {open && (
        <PermissionChecklist
          value={value}
          disabled={busy}
          onChange={(next) => {
            setValue(next);
            onSave([...next]);
          }}
        />
      )}
    </div>
  );
}

/** The site's default capabilities for a new member. */
function DefaultPermissions({
  initial,
  busy,
  onSave,
}: {
  initial: Capability[] | null;
  busy: boolean;
  onSave: (perms: Capability[]) => void;
}) {
  const [value, setValue] = useState<Set<Capability>>(
    () => new Set(initial ?? PRESETS['full-restyle']),
  );

  return (
    <section className="mb-panel">
      <h2 className="mb-panel__title">What new people can edit by default</h2>
      <p className="mb-panel__lede">
        Applied to anybody you invite from now on. You can still change it per person
        afterwards.
      </p>
      <PermissionChecklist
        value={value}
        disabled={busy}
        onChange={(next) => {
          setValue(next);
          onSave([...next]);
        }}
      />
    </section>
  );
}
