/**
 * Schema constants for the Travelgenix Control admin tables.
 *
 * All IDs below are hard-coded against base appAYzWZxvK6qlwXK.
 * Field names are kept here for readability; field IDs are the contract.
 *
 * Tables created 6 May 2026 as part of the unified onboarding console
 * build. See the conversation summary for the full design rationale.
 */

export const BASE_ID = 'appAYzWZxvK6qlwXK';

export const CATALOGUE = {
  tableId: 'tblhT8lhDWVieFxsT',
  fields: {
    productCode: 'fldhEaFhoKYtlGFvH',
    productName: 'fldNWSmQwp6tUHSJS',
    category: 'fldNGD0r092e7C2sy',
    description: 'fldy5uHYALZIVTx2k',
    active: 'fldoUzVwIXHnSZY2u',
    sortOrder: 'fldRmUhaS5iT2RT1X',
    created: 'fldnFs2TPhnnHYKwV',
  },
  // Used to control category ordering in the UI
  categoryOrder: ['Luna Suite', 'Marketing', 'CRM', 'Quick Quote', 'University', 'Widget'],
};

export const PACKAGES = {
  tableId: 'tbltYc7w49Ye43NI1',
  fields: {
    packageName: 'fldTZTR6u1zFbGBDT',
    packageCode: 'fldrI4APvgzsf2gaZ',
    monthlyPrice: 'fldUfFfsTXvuhXl88',
    setupFee: 'fldsR9T6aHL4FYBCK',
    description: 'fldtGqYo63sN233nn',
    active: 'fld9aJ541f1Coi5PN',
    sortOrder: 'fldrL8LegkG0BfQMh',
    created: 'fld1ndbxRg9nrtEYV',
  },
};

export const PACKAGE_CATALOGUE = {
  tableId: 'tblMmYmZDqJ5L0SHW',
  fields: {
    linkId: 'fld6Sr1DF813SSR95',
    package: 'fld0GyqEWjoPrbDE5',
    catalogueItem: 'fldTrUKZ1t4ecimmz',
    includedByDefault: 'fldZijw4yTlCIWBa1',
    availableAsAddOn: 'fld5nbZXzB5pb3ZkR',
    addOnMonthlyPrice: 'fldn4kVWKGKmI2Vvj',
    notes: 'fld1ggJGl70B40C7U',
  },
};

export const CLIENT_ENTITLEMENTS = {
  tableId: 'tbldtwpQl3ZcK5uzl',
  fields: {
    entitlementId: 'fldzZSKA9ZXnvFlc5',
    client: 'fldYTtPnhDDMgS1qs',
    catalogueItem: 'fld8djS73AXQuRLzs',
    enabled: 'fldwxESsbDw445LFv',
    source: 'fldx6qZb5PlZXRYAt',
    activatedDate: 'fldtvsJ9kKchR2C8A',
    deactivatedDate: 'fldYG5k1x4NqKc6DF',
    notes: 'fldAVqPDnhq54MqGm',
    created: 'fldHMjOCsMA1m5Qdn',
    lastModified: 'fld3YER0Zo3TmjoHj',
  },
};

// Re-export the existing Clients table id for convenience.
// The full Clients schema lives in api/_lib/auth/schema.js.
export const CLIENTS = {
  tableId: 'tblikekpaTKraMktZ',
  newFields: {
    tradingName: 'fldDbFv039Bip6W8u',
    websiteUrl: 'fld9zVc9PHgu18RVW',
    travelifyAppId: 'fldE9dL05t0x0S88w',
    travelifySiteId: 'fldXQF2zadTtqmsfY',
    setupDate: 'fldFZQXs893F740Rb',
    goLiveDate: 'fldrtf2dwPj71GEX8',
    mrr: 'fldRWul7uUaA8LtZj',
    setupFee: 'fld4oBOWPZESceJds',
    primaryContactName: 'fldDh0OLM30UtU9Fv',
    primaryContactPhone: 'fldFES7Aa057MB3VT',
    package: 'fldgQIlUsSBKIEWzd',
  },
};
