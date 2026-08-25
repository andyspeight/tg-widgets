// =============================================================================
//  lib/types.ts — row shapes for the gt_002 schema
// =============================================================================
//  Hand-written for now. Once the migration is applied these can be generated
//  from the live database instead, and generated should win over hand-written.
// =============================================================================

export type PlanBand = 'trial' | 'start' | 'grow' | 'scale' | 'enterprise';
export type TripKind = 'group' | 'tour';
export type TripStatus = 'draft' | 'published' | 'archived';
export type DepartureStatus = 'open' | 'closed' | 'cancelled';
export type BookingStatus = 'pending' | 'deposit_paid' | 'paid' | 'cancelled' | 'expired';
export type PaymentKind = 'deposit' | 'balance' | 'instalment';

export interface Operator {
  id: string;
  client_record_id: string | null;
  name: string;
  slug: string;
  contact_email: string;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  brand: OperatorBrand;
  plan_band: PlanBand;
  custom_domain: string | null;
}

export interface OperatorBrand {
  logoUrl?: string;
  primaryColour?: string;
  accentColour?: string;
  fontFamily?: string;
  replyTo?: string;
}

export interface Trip {
  id: string;
  operator_id: string;
  slug: string;
  title: string;
  summary: string | null;
  kind: TripKind;
  status: TripStatus;
  hero_image_url: string | null;
  location: string | null;
  currency: string;
  content: TripContent;
  legacy_widget_id: string | null;
}

/** The long-form body. Matches what the Tour Builder already emits. */
export interface TripContent {
  overview?: string;
  highlights?: string[];
  included?: string[];
  excluded?: string[];
  days?: TripDay[];
  gallery?: string[];
  packingList?: string[];
  footnotes?: string[];
}

export interface TripDay {
  title: string;
  body?: string;
  images?: string[];
  facts?: Record<string, string>;
}

export interface Departure {
  id: string;
  trip_id: string;
  starts_on: string;
  ends_on: string;
  capacity: number;
  price_pence: number | null;
  deposit_pence: number | null;
  balance_due_date: string | null;
  hold_minutes: number;
  status: DepartureStatus;
}

export interface Package {
  id: string;
  trip_id: string;
  name: string;
  description: string | null;
  price_pence: number | null;
  occupancy: number;
  capacity: number | null;
  image_url: string | null;
  info_url: string | null;
  sort_order: number;
}
