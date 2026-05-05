/**
 * Airtable schema constants for the Widget Suite auth system.
 *
 * SINGLE SOURCE OF TRUTH for table and field IDs. Everything else imports
 * from here. Do not hardcode IDs anywhere else.
 *
 * If a field is renamed or restructured in Airtable, update this file only.
 *
 * Base: appAYzWZxvK6qlwXK (Travelgenix Widget Suite / Configs)
 */

export const BASE_ID = 'appAYzWZxvK6qlwXK';

// ----------------------------------------------------------------------------
// Clients table (renamed from Users in May 2026 when multi-user auth shipped)
// ----------------------------------------------------------------------------
export const CLIENTS = {
  tableId: 'tblikekpaTKraMktZ',
  fields: {
    email:        'fldVRiIAlrTjxnNHP', // primary
    clientCode:   'fld7I0zpY89fD8xCb', // legacy, deprecated post-migration
    clientName:   'fldx9CiWtSm5lX7MF',
    status:       'fldgz6ScqvHQy2jdH',
    plan:         'fldBgDeQdtwMqTIS4',
    createdAt:    'fldcVbJggWfEHa6o9',
    lastLogin:    'fldFms2qS48qqJ7TO',
    notes:        'fldWYu5FZybusSaVR',
    aiDailyCount: 'fldlyipF5vQLUUxoh',
    aiDailyDate:  'fldlJ8nMB41hqdRnS',
    users:        'fldE4ZU98iGLbio3q',
    invites:      'fldoyAaAg7uJtSINO',
    authEvents:   'fldzEKSZBrsMZbUm3'
  }
};

// ----------------------------------------------------------------------------
// Users table (NEW — person-level accounts)
// ----------------------------------------------------------------------------
export const USERS = {
  tableId: 'tblIpeQeZmF7CM7OJ',
  fields: {
    email:               'fldSQLKBfsAcVS2s3', // primary
    client:              'fldyXVZjZKUjlYCm6', // linked → Clients
    fullName:            'fldz1zYCcVCpTMTDl',
    passwordHash:        'fldnBEg0qOLrVnIfc', // bcrypt cost 12
    role:                'fld3qxb08LWvd6NHQ', // owner | admin | member
    status:              'fldal007hv7mS2IDB', // active | invited | suspended
    authMethods:         'fldhPZwiNh21Ylxb4', // password, google, microsoft, magic
    googleSub:           'fldmrMGbvFQA71neu', // Phase 2
    microsoftSub:        'fldf994uw2zsCCWf5', // Phase 2
    lastLogin:           'flddCbek2OXpTQFHc',
    lastLoginIp:         'fldJHEb9uyw3lMrtj',
    created:             'fldwq1aBBwu2QFfuG',
    forcePasswordReset:  'fldaDYS92pbGH9Nk6',
    notes:               'fldL9t2PFzluqWLgK',
    invites:             'fld1eq1X1U0bZhpZz',
    sessions:            'fldpXybYT64wnSBJX',
    authEvents:          'fld7YmcftMa0SRfQE'
  },
  // Allowed values for select fields — keep in sync with Airtable
  roles: { OWNER: 'owner', ADMIN: 'admin', MEMBER: 'member' },
  statuses: { ACTIVE: 'active', INVITED: 'invited', SUSPENDED: 'suspended' },
  authMethodValues: {
    PASSWORD: 'password',
    GOOGLE: 'google',
    MICROSOFT: 'microsoft',
    MAGIC: 'magic'
  }
};

// ----------------------------------------------------------------------------
// Invites table (NEW)
// ----------------------------------------------------------------------------
export const INVITES = {
  tableId: 'tblbM4VvIIbcfvYRU',
  fields: {
    tokenHash:  'fldMEXBUY3pR4yYZu', // primary — SHA-256 of raw token
    email:      'flduo5aNtkLkzL4cl',
    client:     'fldsDFR46bqtc7hm0', // linked → Clients
    invitedBy:  'fldnTX28eRJ68XHul', // linked → Users
    role:       'fld7XtOv34LCtslKe',
    status:     'fldvPQUTMjip99rwn', // pending | accepted | revoked | expired
    expiresAt:  'fldOmk0pAwcKshqzU',
    acceptedAt: 'fldHLDPst0VYJMwfF',
    created:    'fld1lliuMM6P38ast'
  },
  statuses: {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REVOKED: 'revoked',
    EXPIRED: 'expired'
  }
};

// ----------------------------------------------------------------------------
// Sessions table (NEW)
// ----------------------------------------------------------------------------
export const SESSIONS = {
  tableId: 'tblEMrS83LrQsyu7V',
  fields: {
    sessionId:    'fldCqie3rqvGoXrs2', // primary — UUID v4
    user:         'fldXSmgwtFVn6wRuQ', // linked → Users
    jwtJti:       'fldEFcDen79tj5nPc',
    userAgent:    'fldu8l3urD05suOAx',
    ipAddress:    'fldFYvAyKf0UvLgjj',
    created:      'fldZaduJZUkP5FDKj',
    expiresAt:    'fldmwZgxykdGt3m2p',
    lastUsed:     'fldn9FbaqLKGPqYYS',
    revokedAt:    'fldTNjwARohuG78u5',
    revokeReason: 'fldBrJVLehsYKVSRD'
  },
  revokeReasons: {
    SIGNOUT:        'signout',
    SIGNOUT_ALL:    'signout_all',
    PASSWORD_RESET: 'password_reset',
    ADMIN:          'admin',
    EXPIRED:        'expired'
  }
};

// ----------------------------------------------------------------------------
// Auth Events table (NEW — append-only audit log)
// ----------------------------------------------------------------------------
export const AUTH_EVENTS = {
  tableId: 'tblPTBZNMn6nudzhY',
  fields: {
    eventId:        'fld1reiQp7tn7EnL3', // primary — UUID v4
    type:           'fldjYX2PorMddbXuc',
    user:           'fldQK7ccySQxApb9Y', // linked → Users (optional)
    emailAttempted: 'fldPypuMDSpecseSF',
    client:         'fldQAxfW9BtklWiqA', // linked → Clients (optional)
    ip:             'fldunEvYkBgw2lHfY',
    userAgent:      'fldsQdrQkrw9UZSmZ',
    success:        'fldhOs2utZJQeuDXI',
    detail:         'fld3JjzHFguAyQ8cF',
    timestamp:      'fldITcvNWPuYvB1AW'
  },
  types: {
    SIGNIN_SUCCESS:          'signin_success',
    SIGNIN_FAIL:             'signin_fail',
    SIGNOUT:                 'signout',
    SIGNOUT_ALL:             'signout_all',
    PASSWORD_RESET_REQUEST:  'password_reset_request',
    PASSWORD_RESET_COMPLETE: 'password_reset_complete',
    PASSWORD_CHANGE:         'password_change',
    INVITE_SENT:             'invite_sent',
    INVITE_ACCEPTED:         'invite_accepted',
    INVITE_REVOKED:          'invite_revoked',
    OAUTH_LINK:              'oauth_link',
    OAUTH_UNLINK:            'oauth_unlink',
    MAGIC_LINK_SENT:         'magic_link_sent',
    MAGIC_LINK_USED:         'magic_link_used',
    ACCOUNT_LOCKED:          'account_locked',
    ACCOUNT_UNLOCKED:        'account_unlocked'
  }
};
