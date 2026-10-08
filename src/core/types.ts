// Types partagés par le moteur, les parseurs, la PWA, le script du raccourci,
// les fonctions serveur et (via le bundle JS) le composant natif.
// Aucune dépendance : ce module doit rester pur.

export const ENGINE_VERSION = 'engine-1.0.0';
export const PARSER_VERSION = 'parser-1.0.0';

export type Platform = 'uber' | 'bolt' | 'unknown';

/** Base du montant affiché sur l'offre. */
export type PriceBasis = 'net_driver' | 'gross_before_commission' | 'unknown';

/** Origine d'une valeur : jamais perdue, affichée dans le détail. */
export type Provenance = 'ocr' | 'gemini' | 'rule' | 'manual' | 'config' | 'none';

export type Confidence = 'high' | 'medium' | 'low';

export interface Field<T> {
  value: T | null;
  provenance: Provenance;
  /** Fragment de texte source (tronqué), utile au diagnostic. */
  raw?: string;
  confidence?: Confidence;
  /** Identifiant de la règle ayant produit la valeur (ex. "uber.pair-anchor"). */
  rule?: string;
}

export type ParseStatus = 'ok' | 'partial' | 'not_offer' | 'ambiguous';

export interface ParsedOffer {
  platform: Field<Platform>;
  layoutId: string | null;
  parserVersion: string;
  price: Field<number>;
  currency: 'EUR' | null;
  priceBasis: Field<PriceBasis>;
  approachKm: Field<number>;
  approachMin: Field<number>;
  tripKm: Field<number>;
  tripMin: Field<number>;
  /** Secondes restantes affichées sur l'offre, si lisibles. */
  expiresInSec: Field<number>;
  /** Montants additionnels lus (bonus inclus, péage...) : jamais additionnés automatiquement. */
  extras: { label: string; amount: number; raw: string }[];
  productLabel: string | null;
  status: ParseStatus;
  warnings: string[];
}

/** Profil de coûts versionné et immuable une fois utilisé. */
export interface CostProfile {
  id: string;
  version: number;
  effectiveFrom: string; // ISO UTC
  /** Coût variable €/km (énergie + entretien/usure non couverts ailleurs). null = non renseigné. */
  variablePerKm: number | null;
  /** Allocation des coûts fixes €/h. null = non renseigné. */
  fixedPerHour: number | null;
  /** Autres frais incrémentaux par offre (€). null = non renseigné ; 0 = confirmé nul. */
  otherPerOffer: number | null;
  /** Détail facultatif de construction des valeurs (pour l'affichage). */
  detail?: {
    energyPerKm?: number | null;
    maintenancePerKm?: number | null;
    fixedMonthly?: number | null;
    plannedHoursMonthly?: number | null;
  };
}

export type ThresholdLevel = 'revenue' | 'margin';

export interface ThresholdProfile {
  id: string;
  version: number;
  effectiveFrom: string;
  level: ThresholdLevel;
  perKm: number; // > 0
  perHour: number; // > 0
}

export interface PlatformRule {
  /** Base confirmée par l'utilisateur pour les montants affichés par la plateforme. */
  priceBasis: PriceBasis;
  /** Taux de commission confirmé (0..1) ; utilisé seulement si la base est "avant commission". */
  commissionRate: number | null;
}

export interface Scenario {
  /** Retour à vide simulé explicitement (km/min). null = non simulé. */
  returnKm: number | null;
  returnMin: number | null;
  /** Attente explicitement incluse (min). */
  waitMin: number | null;
}

/** Configuration consommée par le parcours rapide (raccourci / natif). */
export interface FastConfig {
  schema: 1;
  /** Empreinte stable du contenu (version identifiable). */
  configId: string;
  createdAt: string;
  cost: CostProfile;
  thresholds: ThresholdProfile;
  platforms: Record<'uber' | 'bolt', PlatformRule>;
  /** Plateforme supposée si le texte ne permet pas de l'identifier (null = ne rien supposer). */
  sessionPlatform: Platform | null;
  scenario: Scenario;
  /** Validité maximale d'un résultat en secondes en l'absence d'échéance lisible. */
  freshnessSec: number;
  voice: boolean;
  /** Mode de synchronisation du journal depuis le raccourci. */
  syncMode: 'off' | 'after_each';
  /** Adresse de la fonction device-api (facultatif). */
  apiBase: string | null;
}

export interface FinanceInput {
  price: number | null;
  priceBasis: PriceBasis;
  commissionRate: number | null;
  approachKm: number | null;
  approachMin: number | null;
  tripKm: number | null;
  tripMin: number | null;
  scenario: Scenario;
  variablePerKm: number | null;
  fixedPerHour: number | null;
  otherCosts: number | null;
}

export interface FinanceResult {
  /** Recette chauffeur estimée (P). null si inconnue. */
  P: number | null;
  /** Vrai si P est le montant affiché faute de base connue (borne haute). */
  pIsUpperBound: boolean;
  D: number | null;
  T: number | null;
  revenuePerKm: number | null;
  revenuePerHour: number | null;
  variableCost: number | null;
  fixedAllocation: number | null;
  /** Marge d'exploitation estimée. null si v ou f non renseignés ou P/D/T manquant. */
  margin: number | null;
  /** Vrai si E n'est pas renseigné : la marge exclut les autres frais (borne haute). */
  marginExcludesOther: boolean;
  marginPerKm: number | null;
  marginPerHour: number | null;
  notes: string[];
  missing: string[];
}

export type Verdict = 'favorable' | 'limite' | 'faible' | 'partiel' | 'indisponible';

export interface VerdictResult {
  verdict: Verdict;
  level: ThresholdLevel;
  perKm: number | null;
  perHour: number | null;
  ratioKm: number | null; // valeur / seuil
  ratioHour: number | null;
  reasons: string[];
}

export interface Analysis {
  id: string; // identifiant de requête stable
  engineVersion: string;
  parserVersion: string;
  configId: string | null;
  costProfileRef: { id: string; version: number } | null;
  thresholdRef: { id: string; version: number } | null;
  /** Valeurs de seuils utilisées (snapshot) : permettent un recalcul identique après correction. */
  thresholdValues: { level: ThresholdLevel; perKm: number; perHour: number };
  capturedAt: string; // instant de déclenchement / capture (ISO)
  analyzedAt: string;
  validUntil: string;
  source: 'shortcut' | 'native' | 'manual' | 'import' | 'server' | 'demo';
  offer: ParsedOffer;
  input: FinanceInput;
  finance: FinanceResult;
  verdict: VerdictResult;
  /** Texte court pour la notification et la voix. */
  display: { title: string; body: string; speech: string };
}
