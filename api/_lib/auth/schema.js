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
    authEvents:   'fldzEKSZBrsMZbUm3',
    // Added 6 May 2026 for the admin console
    tradingName:          'fldDbFv039Bip6W8u',
    websiteUrl:           'fld9zVc9PHgu18RVW',
    travelifyAppId:       'fldE9dL05t0x0S88w',
    travelifySiteId:      'fldXQF2zadTtqmsfY',
    setupDate:            'fldFZQXs893F740Rb',
    goLiveDate:           'fldrtf2dwPj71GEX8',
    mrr:                  'fldRWul7uUaA8LtZj',
    setupFeeCharged:      'fld4oBOWPZESceJds',
    primaryContactName:   'fldDh0OLM30UtU9Fv',
    primaryContactPhone:  'fldFES7Aa057MB3VT',
    package:              'fldgQIlUsSBKIEWzd' // linked → Packages
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
    passwordHash:        'fldnBEg0qOLrVnIfc',
    role:                'fld3qxb08LWvd6NHQ',
    status:              'fldal007hv7mS2IDB',
    authMethods:         'fldhPZwiNh21Ylxb4',
    googleSub:           'fldmrMGbvFQA71neu',
    microsoftSub:        'fldf994uw2zsCCWf5',
    lastLogin:           'flddCbek2OXpTQFHc',
    lastLoginIp:         'fldJHEb9uyw3lMrtj',
    created:             'fldwq1aBBwu2QFfuG',
    forcePasswordReset:  'fldaDYS92pbGH9Nk6',
    notes:               'fldL9t2PFzluqWLgK',
    invites:             'fld1eq1X1U0bZhpZz',
    sessions:            'fldpXybYT64wnSBJX',
    authEvents:          'fld7YmcftMa0SRfQE'
  },
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
// Invites table
// ----------------------------------------------------------------------------
export const INVITES = {
  tableId: 'tblbM4VvIIbcfvYRU',
  fields: {
    tokenHash:  'fldMEXBUY3pR4yYZu',
    email:      'flduo5aNtkLkzL4cl',
    client:     'fldsDFR46bqtc7hm0',
    invitedBy:  'fldnTX28eRJ68XHul',
    role:       'fld7XtOv34LCtslKe',
    status:     'fldvPQUTMjip99rwn',
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
// Sessions table
// ----------------------------------------------------------------------------
export const SESSIONS = {
  tableId: 'tblEMrS83LrQsyu7V',
  fields: {
    sessionId:    'fldCqie3rqvGoXrs2',
    user:         'fldXSmgwtFVn6wRuQ',
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
// Auth Events table
// ----------------------------------------------------------------------------
export const AUTH_EVENTS = {
  tableId: 'tblPTBZNMn6nudzhY',
  fields: {
    eventId:        'fld1reiQp7tn7EnL3',
    type:           'fldjYX2PorMddbXuc',
    user:           'fldQK7ccySQxApb9Y',
    emailAttempted: 'fldPypuMDSpecseSF',
    client:         'fldQAxfW9BtklWiqA',
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
    ACCOUNT_UNLOCKED:        'account_unlocked',
    PERMISSION_GRANTED:      'permission_granted',
    PERMISSION_REVOKED:      'permission_revoked',
    PERMISSION_UPDATED:      'permission_updated'
  }
};

// ----------------------------------------------------------------------------
// Products table
// ----------------------------------------------------------------------------
export const PRODUCTS = {
  tableId: 'tbl8gafdldQyps4JN',
  fields: {
    productId:      'fld0L1auU7q8ep0kX',
    displayName:    'fldGSdyhaOZJ6OnwJ',
    description:    'fldhruACLHECYknxG',
    availableRoles: 'fldaczn0DWeoDui8D',
    status:         'fldo7iE9GYRXRXY1c',
    created:        'fldWl7dKanrCvi12w',
    permissions:    'fld0IitvokkAZoon9'
  },
  slugs: {
    WIDGET_SUITE:   'widget_suite',
    LUNA_CHAT:      'luna_chat',
    LUNA_MARKETING: 'luna_marketing',
    LUNA_BRAIN:     'luna_brain',
    LUNA_TRENDS:    'luna_trends',
    LUNA_QA:        'luna_qa',
    TOOL_HUB:       'tool_hub'
  },
  statuses: {
    ACTIVE:      'active',
    COMING_SOON: 'coming_soon',
    DEPRECATED:  'deprecated'
  }
};

// ----------------------------------------------------------------------------
// Permissions table — links a User to a Product with a Role
// ----------------------------------------------------------------------------
export const PERMISSIONS = {
  tableId: 'tblfuVxtQyaNRYBrB',
  fields: {
    permissionId: 'fldfL36VMxQufq6BF',
    user:         'fldWMPFEH6MiEHq2z',
    product:      'fldxrWehb2IaydcCE',
    role:         'fldtpWkG2gv1Kbu1G',
    status:       'fldUq2esKf0gOkxhs',
    granted:      'fldy8TADPRqxagHMK',
    grantedBy:    'fldRhA0BQVmgz5RC5',
    expiresAt:    'fldLteKvMhHPUG4wF',
    notes:        'fldWGqynzsVAKRjPI'
  },
  statuses: {
    ACTIVE:    'active',
    SUSPENDED: 'suspended',
    EXPIRED:   'expired'
  },
  roles: {
    OWNER:        'owner',
    ADMIN:        'admin',
    CLIENT_OWNER: 'client_owner',
    CLIENT_USER:  'client_user',
    AGENT:        'agent',
    SUPERVISOR:   'supervisor',
    VIEWER:       'viewer'
  }
};

// ============================================================================
// Admin console tables (added 6 May 2026)
// ============================================================================

// ----------------------------------------------------------------------------
// Catalogue table — granular product list for entitlements
// ----------------------------------------------------------------------------
export const CATALOGUE = {
  tableId: 'tblhT8lhDWVieFxsT',
  fields: {
    productCode:  'fldhEaFhoKYtlGFvH', // primary
    productName:  'fldNWSmQwp6tUHSJS',
    category:     'fldNGD0r092e7C2sy',
    description:  'fldy5uHYALZIVTx2k',
    active:       'fldoUzVwIXHnSZY2u',
    sortOrder:    'fldRmUhaS5iT2RT1X',
    created:      'fldnFs2TPhnnHYKwV',
    // Added 7 May 2026 - which Product slug this catalogue item grants access to
    productSlug:  'fld0PdnTl4cBwi1cR'
  },
  categories: {
    LUNA_SUITE:  'Luna Suite',
    MARKETING:   'Marketing',
    CRM:         'CRM',
    QUICK_QUOTE: 'Quick Quote',
    UNIVERSITY:  'University',
    WIDGET:      'Widget'
  },
  categoryOrder: ['Luna Suite', 'Marketing', 'CRM', 'Quick Quote', 'University', 'Widget']
};

// ----------------------------------------------------------------------------
// Packages table
// ----------------------------------------------------------------------------
export const PACKAGES = {
  tableId: 'tbltYc7w49Ye43NI1',
  fields: {
    packageName:  'fldTZTR6u1zFbGBDT',
    packageCode:  'fldrI4APvgzsf2gaZ',
    monthlyPrice: 'fldUfFfsTXvuhXl88',
    setupFee:     'fldsR9T6aHL4FYBCK',
    description:  'fldtGqYo63sN233nn',
    active:       'fld9aJ541f1Coi5PN',
    sortOrder:    'fldrL8LegkG0BfQMh',
    created:      'fld1ndbxRg9nrtEYV'
  }
};

// ----------------------------------------------------------------------------
// Package Catalogue — join: Packages × Catalogue with default flags
// ----------------------------------------------------------------------------
export const PACKAGE_CATALOGUE = {
  tableId: 'tblMmYmZDqJ5L0SHW',
  fields: {
    linkId:             'fld6Sr1DF813SSR95',
    package:            'fld0GyqEWjoPrbDE5',
    catalogueItem:      'fldTrUKZ1t4ecimmz',
    includedByDefault:  'fldZijw4yTlCIWBa1',
    availableAsAddOn:   'fld5nbZXzB5pb3ZkR',
    addOnMonthlyPrice:  'fldn4kVWKGKmI2Vvj',
    notes:              'fld1ggJGl70B40C7U'
  }
};

// ----------------------------------------------------------------------------
// Client Entitlements — join: Clients × Catalogue with actual yes/no
// ----------------------------------------------------------------------------
export const CLIENT_ENTITLEMENTS = {
  tableId: 'tbldtwpQl3ZcK5uzl',
  fields: {
    entitlementId:    'fldzZSKA9ZXnvFlc5',
    client:           'fldYTtPnhDDMgS1qs',
    catalogueItem:    'fld8djS73AXQuRLzs',
    enabled:          'fldwxESsbDw445LFv',
    source:           'fldx6qZb5PlZXRYAt',
    activatedDate:    'fldtvsJ9kKchR2C8A',
    deactivatedDate:  'fldYG5k1x4NqKc6DF',
    notes:            'fldAVqPDnhq54MqGm',
    created:          'fldHMjOCsMA1m5Qdn',
    lastModified:     'fld3YER0Zo3TmjoHj'
  },
  sources: {
    PACKAGE_DEFAULT: 'Package Default',
    MANUAL_OVERRIDE: 'Manual Override',
    ADD_ON:          'Add-On',
    REMOVED:         'Removed'
  }
};
