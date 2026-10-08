// Modèle de données de l'historique (PWA + Supabase). Montants en euros décimaux,
// distances en km, durées en minutes, instants en ISO UTC.
import type { Analysis, CostProfile, Platform, PlatformRule, Scenario, ThresholdProfile } from './types';

export interface SyncMeta {
  id: string;
  updatedAt: string; // horodatage client de la dernière modification (LWW)
  deleted?: boolean; // suppression = pierre tombale synchronisée
}

export interface Vehicle extends SyncMeta {
  name: string;
  energy: 'diesel' | 'essence' | 'hybride' | 'electrique' | 'gpl' | 'autre';
  /** L/100 km ou kWh/100 km selon l'énergie. */
  consumptionPer100: number | null;
  energyUnitPrice: number | null; // €/L ou €/kWh
  maintenancePerKm: number | null;
  fixedMonthly: number | null; // assurance, location/crédit, licence, téléphone...
  plannedHoursMonthly: number | null;
}

export type CostProfileRec = CostProfile & SyncMeta & { vehicleId: string | null };
export type ThresholdRec = ThresholdProfile & SyncMeta;

export type OfferStatus = 'analysee' | 'acceptee' | 'refusee' | 'annulee' | 'realisee' | 'encaissee';
export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  analysee: 'Analysée',
  acceptee: 'Acceptée',
  refusee: 'Refusée',
  annulee: 'Annulée',
  realisee: 'Réalisée',
  encaissee: 'Encaissée',
};

export interface Correction {
  at: string;
  field: 'price' | 'priceBasis' | 'commissionRate' | 'approachKm' | 'approachMin' | 'tripKm' | 'tripMin' | 'platform';
  before: unknown;
  after: unknown;
}

export interface OfferRec extends SyncMeta {
  capturedAt: string;
  platform: Platform;
  source: Analysis['source'];
  /** Analyse d'origine : jamais modifiée. */
  original: Analysis;
  /** Analyse recalculée après corrections (mêmes hypothèses que l'origine). */
  corrected: Analysis | null;
  corrections: Correction[];
  status: OfferStatus;
  statusHistory: { status: OfferStatus; at: string }[];
  sessionId: string | null;
  tripId: string | null;
  /** Mesures de temps de réponse remontées par le raccourci (ms depuis t0). */
  timing?: { scriptStartMs?: number; scriptEndMs?: number; afterNotifyMs?: number } | null;
}

export interface TripRec extends SyncMeta {
  offerId: string | null;
  sessionId: string | null;
  date: string; // ISO
  platform: Platform;
  /** Recette chauffeur confirmée (€). Jamais déduite automatiquement d'une offre. */
  revenue: number;
  km: number | null;
  minutes: number | null;
  status: 'realisee' | 'encaissee' | 'annulee';
  paidAt: string | null;
  note: string;
}

export interface SessionRec extends SyncMeta {
  startedAt: string;
  endedAt: string | null;
  pauses: { start: string; end: string | null }[];
  vehicleId: string | null;
  odoStart: number | null;
  odoEnd: number | null;
  platformFocus: Platform | null;
}

export type ExpenseCategory = 'carburant' | 'recharge' | 'peage' | 'parking' | 'entretien' | 'assurance' | 'location' | 'lavage' | 'telephone' | 'autre';

export interface ExpenseRec extends SyncMeta {
  date: string;
  category: ExpenseCategory;
  amount: number;
  currency: 'EUR';
  vehicleId: string | null;
  note: string;
  source: 'manual' | 'gemini_receipt' | 'import';
}

export interface SettingsRec extends SyncMeta {
  // id fixe "settings"
  activeVehicleId: string | null;
  activeCostProfileId: string | null;
  activeThresholdId: string | null;
  platforms: Record<'uber' | 'bolt', PlatformRule & { confirmed: boolean }>;
  sessionPlatform: Platform | null;
  scenario: Scenario;
  freshnessSec: number;
  voice: boolean;
  syncMode: 'off' | 'after_each';
  apiBase: string | null;
  aiEnabled: boolean;
  onboardingDone: boolean;
}

export const STORES = ['vehicles', 'costProfiles', 'thresholds', 'offers', 'trips', 'sessions', 'expenses', 'settings'] as const;
export type StoreName = (typeof STORES)[number];

export interface StoreTypes {
  vehicles: Vehicle;
  costProfiles: CostProfileRec;
  thresholds: ThresholdRec;
  offers: OfferRec;
  trips: TripRec;
  sessions: SessionRec;
  expenses: ExpenseRec;
  settings: SettingsRec;
}

/** Calcule v (€/km) et f (€/h) depuis la fiche véhicule. null si une donnée manque. */
export function deriveCosts(v: Vehicle): { variablePerKm: number | null; fixedPerHour: number | null; energyPerKm: number | null } {
  const energyPerKm =
    v.consumptionPer100 !== null && v.energyUnitPrice !== null ? (v.consumptionPer100 / 100) * v.energyUnitPrice : null;
  const variablePerKm = energyPerKm !== null && v.maintenancePerKm !== null ? energyPerKm + v.maintenancePerKm : null;
  const fixedPerHour =
    v.fixedMonthly !== null && v.plannedHoursMonthly !== null && v.plannedHoursMonthly > 0 ? v.fixedMonthly / v.plannedHoursMonthly : null;
  return { variablePerKm, fixedPerHour, energyPerKm };
}

export function defaultSettings(now = new Date().toISOString()): SettingsRec {
  return {
    id: 'settings',
    updatedAt: now,
    activeVehicleId: null,
    activeCostProfileId: null,
    activeThresholdId: null,
    platforms: {
      uber: { priceBasis: 'unknown', commissionRate: null, confirmed: false },
      bolt: { priceBasis: 'unknown', commissionRate: null, confirmed: false },
    },
    sessionPlatform: null,
    scenario: { returnKm: null, returnMin: null, waitMin: null },
    freshnessSec: 10,
    voice: true,
    syncMode: 'off',
    apiBase: null,
    aiEnabled: false,
    onboardingDone: false,
  };
}
