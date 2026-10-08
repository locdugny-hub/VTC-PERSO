// Règles de l'historique : statuts, corrections après coup, import du journal du raccourci.
import { buildDisplay } from './analyze';
import { computeFinance } from './finance';
import { computeVerdict } from './verdict';
import type { Analysis, FinanceInput, ParsedOffer } from './types';
import type { Correction, OfferRec, OfferStatus, TripRec } from './domain';

const nowIso = () => new Date().toISOString();

export function offerFromAnalysis(a: Analysis, sessionId: string | null = null, timing: OfferRec['timing'] = null): OfferRec {
  return {
    id: a.id,
    updatedAt: a.analyzedAt,
    capturedAt: a.capturedAt,
    platform: a.offer.platform.value ?? 'unknown',
    source: a.source,
    original: a,
    corrected: null,
    corrections: [],
    status: 'analysee',
    statusHistory: [{ status: 'analysee', at: a.analyzedAt }],
    sessionId,
    tripId: null,
    timing,
  };
}

const ALLOWED: Record<OfferStatus, OfferStatus[]> = {
  analysee: ['acceptee', 'refusee'],
  acceptee: ['annulee', 'realisee', 'refusee'],
  refusee: ['acceptee'],
  annulee: ['acceptee'],
  realisee: ['encaissee', 'annulee'],
  encaissee: ['realisee'],
};

export function canTransition(from: OfferStatus, to: OfferStatus): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Change le statut d'une offre. Ne crée JAMAIS de recette : passer à "réalisée" exige
 * un montant confirmé par l'utilisateur, qui crée/actualise une course (TripRec).
 */
export function setStatus(
  offer: OfferRec,
  to: OfferStatus,
  opts: { confirmedRevenue?: number; at?: string; trip?: TripRec | null } = {},
): { offer: OfferRec; trip: TripRec | null } {
  if (offer.status === to) return { offer, trip: opts.trip ?? null };
  if (!canTransition(offer.status, to)) throw new Error(`Transition ${offer.status} -> ${to} non autorisée`);
  const at = opts.at ?? nowIso();
  let trip = opts.trip ?? null;
  if (to === 'realisee' || to === 'encaissee') {
    if (!trip) {
      if (typeof opts.confirmedRevenue !== 'number' || !(opts.confirmedRevenue >= 0)) {
        throw new Error('Montant réellement perçu requis pour une course réalisée');
      }
      const a = offer.corrected ?? offer.original;
      trip = {
        id: offer.id + ':trip',
        updatedAt: at,
        offerId: offer.id,
        sessionId: offer.sessionId,
        date: offer.capturedAt,
        platform: offer.platform,
        revenue: opts.confirmedRevenue,
        km: a.finance.D,
        minutes: a.finance.T,
        status: 'realisee',
        paidAt: null,
        note: '',
      };
    }
    trip = { ...trip, status: to === 'encaissee' ? 'encaissee' : 'realisee', paidAt: to === 'encaissee' ? at : null, updatedAt: at };
  }
  if (to === 'annulee' && trip) trip = { ...trip, status: 'annulee', updatedAt: at };
  return {
    offer: {
      ...offer,
      status: to,
      statusHistory: [...offer.statusHistory, { status: to, at }],
      tripId: trip ? trip.id : offer.tripId,
      updatedAt: at,
    },
    trip,
  };
}

const FIELD_TO_INPUT: Partial<Record<Correction['field'], keyof FinanceInput>> = {
  price: 'price',
  priceBasis: 'priceBasis',
  commissionRate: 'commissionRate',
  approachKm: 'approachKm',
  approachMin: 'approachMin',
  tripKm: 'tripKm',
  tripMin: 'tripMin',
};

/**
 * Correction après coup : l'analyse d'origine est conservée ; une analyse corrigée est
 * recalculée avec LES MÊMES hypothèses (coûts, seuils, scénario) que l'origine.
 */
export function applyCorrection(offer: OfferRec, field: Correction['field'], value: unknown, at = nowIso()): OfferRec {
  const base = offer.corrected ?? offer.original;
  const input: FinanceInput = { ...base.input };
  const parsed: ParsedOffer = JSON.parse(JSON.stringify(base.offer));
  let before: unknown;
  if (field === 'platform') {
    before = parsed.platform.value;
    parsed.platform = { value: value as ParsedOffer['platform']['value'], provenance: 'manual' };
  } else {
    const k = FIELD_TO_INPUT[field]!;
    before = input[k];
    (input as unknown as Record<string, unknown>)[k] = value;
    if (field !== 'commissionRate') {
      const pf = field as Exclude<Correction['field'], 'platform' | 'commissionRate'>;
      (parsed as unknown as Record<string, unknown>)[pf] = { value, provenance: 'manual' };
    }
  }
  const finance = computeFinance(input);
  const tv = base.thresholdValues;
  const verdict = computeVerdict(finance, { id: '', version: 0, effectiveFrom: '', ...tv });
  const corrected0: Omit<Analysis, 'display'> = { ...base, offer: parsed, input, finance, verdict, analyzedAt: at };
  const corrected: Analysis = { ...corrected0, display: buildDisplay(corrected0) };
  return {
    ...offer,
    platform: parsed.platform.value ?? offer.platform,
    corrected,
    corrections: [...offer.corrections, { at, field, before, after: value }],
    updatedAt: at,
  };
}

/** Ligne du journal écrite par le script du raccourci (JSONL). */
export interface JournalLine {
  kind: 'analysis' | 'timing' | 'error';
  analysis?: Analysis;
  id?: string;
  t0?: string;
  scriptStartMs?: number;
  scriptEndMs?: number;
  afterNotifyMs?: number;
  suppressed?: boolean;
}

/** Import idempotent du journal : mêmes identifiants => pas de doublon. */
export function importJournal(text: string, existing: Map<string, OfferRec>): { upserts: OfferRec[]; errors: string[]; skipped: number } {
  const errors: string[] = [];
  const byId = new Map<string, OfferRec>();
  const timings = new Map<string, NonNullable<OfferRec['timing']>>();
  let skipped = 0;
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  lines.forEach((l, i) => {
    let j: JournalLine;
    try {
      j = JSON.parse(l);
    } catch {
      errors.push(`Ligne ${i + 1} illisible`);
      return;
    }
    if (j.kind === 'analysis') {
      const a = sanitizeAnalysis(j.analysis);
      if (!a) {
        errors.push(`Ligne ${i + 1} : analyse invalide ignorée`);
        return;
      }
      if (existing.has(a.id) || byId.has(a.id)) {
        skipped++;
        return;
      }
      byId.set(a.id, offerFromAnalysis(a));
    } else if (j.kind === 'error') {
      skipped++; // trace d'erreur du raccourci : informative, rien à importer
    } else if (j.kind === 'timing' && typeof j.id === 'string') {
      const okNum = (x: unknown) => x === undefined || (typeof x === 'number' && Number.isFinite(x));
      if (!okNum(j.scriptStartMs) || !okNum(j.scriptEndMs) || !okNum(j.afterNotifyMs)) {
        errors.push(`Ligne ${i + 1} : mesure invalide`);
        return;
      }
      const t = timings.get(j.id) ?? {};
      if (typeof j.scriptStartMs === 'number') t.scriptStartMs = j.scriptStartMs;
      if (typeof j.scriptEndMs === 'number') t.scriptEndMs = j.scriptEndMs;
      if (typeof j.afterNotifyMs === 'number') t.afterNotifyMs = j.afterNotifyMs;
      timings.set(j.id, t);
    } else errors.push(`Ligne ${i + 1} : type inconnu`);
  });
  for (const [id, t] of timings) {
    const o = byId.get(id) ?? existing.get(id);
    if (!o) continue;
    const merged = { ...o, timing: { ...(o.timing ?? {}), ...t } };
    byId.set(id, merged);
  }
  return { upserts: [...byId.values()], errors, skipped };
}

/** Percentiles pour les mesures de latence (méthode du rang le plus proche). */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.ceil((p / 100) * v.length);
  return v[Math.min(v.length - 1, Math.max(0, rank - 1))];
}

// ---------- Validation des analyses venant de l'extérieur (journal importé, ingestion serveur) ----------
const nn = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x));
const str = (x: unknown, max = 300) => typeof x === 'string' && x.length <= max;
const isoOk = (x: unknown) => typeof x === 'string' && x.length <= 40 && Number.isFinite(Date.parse(x));
const PROVS = ['ocr', 'gemini', 'rule', 'manual', 'config', 'none'];
const VERDICTS = ['favorable', 'limite', 'faible', 'partiel', 'indisponible'];
const SOURCES = ['shortcut', 'native', 'manual', 'import', 'server', 'demo'];

function fieldOk(f: unknown, values?: readonly (string | null)[]): boolean {
  if (!f || typeof f !== 'object') return false;
  const o = f as Record<string, unknown>;
  if (!PROVS.includes(o.provenance as string)) return false;
  if (values ? !values.includes(o.value as string | null) : !nn(o.value)) return false;
  if (o.raw !== undefined && !str(o.raw, 80)) return false;
  if (o.rule !== undefined && !str(o.rule, 60)) return false;
  if (o.confidence !== undefined && !['high', 'medium', 'low'].includes(o.confidence as string)) return false;
  return true;
}

/**
 * Vérifie la forme d'une analyse reçue de l'extérieur. Renvoie null si un champ a un type inattendu :
 * une donnée importée ne peut ni injecter de contenu ni fausser silencieusement les calculs affichés.
 */
export function sanitizeAnalysis(x: unknown): Analysis | null {
  const a = x as Analysis;
  if (!a || typeof a !== 'object') return null;
  if (!str(a.id, 128) || !/^[A-Za-z0-9:_-]+$/.test(a.id)) return null;
  if (!isoOk(a.capturedAt) || !isoOk(a.analyzedAt) || !isoOk(a.validUntil)) return null;
  if (!SOURCES.includes(a.source)) return null;
  if (!str(a.engineVersion, 40) || !str(a.parserVersion, 40)) return null;
  if (a.configId !== null && !(str(a.configId, 40) && /^cfg-[0-9a-f]{8}$/.test(a.configId))) return null;
  const o = a.offer;
  if (!o || typeof o !== 'object') return null;
  if (!fieldOk(o.platform, ['uber', 'bolt', 'unknown', null]) || !fieldOk(o.priceBasis, ['net_driver', 'gross_before_commission', 'unknown', null])) return null;
  for (const k of ['price', 'approachKm', 'approachMin', 'tripKm', 'tripMin', 'expiresInSec'] as const) if (!fieldOk(o[k])) return null;
  if (!Array.isArray(o.warnings) || !o.warnings.every((w) => str(w, 200))) return null;
  if (!Array.isArray(o.extras) || !o.extras.every((e) => e && str(e.label, 60) && str(e.raw, 60) && typeof e.amount === 'number')) return null;
  if (o.productLabel !== null && !str(o.productLabel, 40)) return null;
  const i = a.input;
  if (!i || !['net_driver', 'gross_before_commission', 'unknown'].includes(i.priceBasis)) return null;
  for (const k of ['price', 'commissionRate', 'approachKm', 'approachMin', 'tripKm', 'tripMin', 'variablePerKm', 'fixedPerHour', 'otherCosts'] as const) if (!nn(i[k])) return null;
  if (!i.scenario || !nn(i.scenario.returnKm) || !nn(i.scenario.returnMin) || !nn(i.scenario.waitMin)) return null;
  const f = a.finance;
  if (!f) return null;
  for (const k of ['P', 'D', 'T', 'revenuePerKm', 'revenuePerHour', 'variableCost', 'fixedAllocation', 'margin', 'marginPerKm', 'marginPerHour'] as const) if (!nn(f[k])) return null;
  if (!Array.isArray(f.notes) || !f.notes.every((n) => str(n, 200)) || !Array.isArray(f.missing) || !f.missing.every((n) => str(n, 60))) return null;
  const v = a.verdict;
  if (!v || !VERDICTS.includes(v.verdict) || !['revenue', 'margin'].includes(v.level) || !nn(v.perKm) || !nn(v.perHour) || !nn(v.ratioKm) || !nn(v.ratioHour)) return null;
  if (!Array.isArray(v.reasons) || !v.reasons.every((r) => str(r, 200))) return null;
  const t = a.thresholdValues;
  if (!t || !['revenue', 'margin'].includes(t.level) || !(t.perKm > 0) || !(t.perHour > 0)) return null;
  const d = a.display;
  if (!d || !str(d.title, 200) || !str(d.body, 400) || !str(d.speech, 200)) return null;
  return a;
}
