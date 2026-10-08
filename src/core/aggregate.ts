// Bilans réels : recettes confirmées, dépenses de période (déduites une seule fois),
// temps d'activité issu des sessions (attente comprise, pauses exclues).
// Les ratios globaux utilisent les totaux, jamais une moyenne de ratios.
// Les allocations estimées utilisées pour juger les offres ne sont PAS déduites ici.
import type { ExpenseRec, OfferRec, SessionRec, TripRec } from './domain';

export type PeriodKind = 'day' | 'week' | 'month';

/** Date civile Europe/Paris d'un instant, "YYYY-MM-DD". */
export function parisDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Clé de période pour une date civile. Semaine ISO (lundi). */
export function periodKey(iso: string, kind: PeriodKind): string {
  const day = parisDate(iso);
  if (kind === 'day') return day;
  if (kind === 'month') return day.slice(0, 7);
  const [y, m, dd] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = lundi
  dt.setUTCDate(dt.getUTCDate() - dow + 3); // jeudi de la semaine
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-S${String(week).padStart(2, '0')}`;
}

/** Durée d'activité d'une session en minutes (pauses exclues). Session ouverte : jusqu'à "now". */
export function sessionMinutes(s: SessionRec, now: Date = new Date()): number {
  const start = new Date(s.startedAt).getTime();
  const end = s.endedAt ? new Date(s.endedAt).getTime() : now.getTime();
  let ms = Math.max(0, end - start);
  for (const p of s.pauses) {
    const ps = new Date(p.start).getTime();
    const pe = p.end ? new Date(p.end).getTime() : end;
    ms -= Math.max(0, Math.min(pe, end) - Math.max(ps, start));
  }
  return Math.max(0, ms / 60000);
}

export interface PeriodSummary {
  key: string;
  revenueRealized: number; // réalisées + encaissées
  revenueCashed: number; // encaissées
  tripsCount: number;
  expenses: number;
  expensesByCategory: Record<string, number>;
  activityMinutes: number;
  openSessions: number;
  /** Résultat d'exploitation réel = recettes confirmées − dépenses de période. */
  result: number;
  resultPerHour: number | null;
  revenuePerHour: number | null;
  kmOdometer: number | null; // si toutes les sessions ont un compteur
  kmTrips: number | null;
  resultPerKm: number | null;
  offers: { analysed: number; byVerdict: Record<string, number>; accepted: number; refused: number };
  completeness: string[];
  /** Solde après cotisations modélisées : seulement si base et taux fournis explicitement. */
  social: { base: number; rate: number; contribution: number; balance: number } | null;
}

const alive = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter((x) => !x.deleted);

export function summarize(
  kind: PeriodKind,
  data: { trips: TripRec[]; expenses: ExpenseRec[]; sessions: SessionRec[]; offers: OfferRec[] },
  opts: { now?: Date; social?: Record<string, { base: number; rate: number }> } = {},
): PeriodSummary[] {
  const now = opts.now ?? new Date();
  const map = new Map<string, PeriodSummary>();
  const get = (key: string) => {
    let s = map.get(key);
    if (!s) {
      s = {
        key,
        revenueRealized: 0,
        revenueCashed: 0,
        tripsCount: 0,
        expenses: 0,
        expensesByCategory: {},
        activityMinutes: 0,
        openSessions: 0,
        result: 0,
        resultPerHour: null,
        revenuePerHour: null,
        kmOdometer: null,
        kmTrips: null,
        resultPerKm: null,
        offers: { analysed: 0, byVerdict: {}, accepted: 0, refused: 0 },
        completeness: [],
        social: null,
      };
      map.set(key, s);
    }
    return s;
  };
  const kmOdo = new Map<string, { sum: number; complete: boolean }>();
  const kmTr = new Map<string, { sum: number; complete: boolean }>();

  for (const t of alive(data.trips)) {
    if (t.status === 'annulee') continue; // une course annulée n'est jamais une recette
    const s = get(periodKey(t.date, kind));
    s.revenueRealized += t.revenue;
    if (t.status === 'encaissee') s.revenueCashed += t.revenue;
    s.tripsCount += 1;
    const k = kmTr.get(s.key) ?? { sum: 0, complete: true };
    if (t.km === null) k.complete = false;
    else k.sum += t.km;
    kmTr.set(s.key, k);
  }
  for (const e of alive(data.expenses)) {
    const s = get(periodKey(e.date, kind));
    s.expenses += e.amount;
    s.expensesByCategory[e.category] = (s.expensesByCategory[e.category] ?? 0) + e.amount;
  }
  for (const se of alive(data.sessions)) {
    // Session attribuée à la période de son début (journée de travail, y compris après minuit).
    const s = get(periodKey(se.startedAt, kind));
    s.activityMinutes += sessionMinutes(se, now);
    if (!se.endedAt) s.openSessions += 1;
    const k = kmOdo.get(s.key) ?? { sum: 0, complete: true };
    if (se.odoStart === null || se.odoEnd === null || se.odoEnd < se.odoStart) k.complete = false;
    else k.sum += se.odoEnd - se.odoStart;
    kmOdo.set(s.key, k);
  }
  for (const o of alive(data.offers)) {
    const s = get(periodKey(o.capturedAt, kind));
    s.offers.analysed += 1;
    const v = (o.corrected ?? o.original).verdict.verdict;
    s.offers.byVerdict[v] = (s.offers.byVerdict[v] ?? 0) + 1;
    if (['acceptee', 'realisee', 'encaissee'].includes(o.status)) s.offers.accepted += 1;
    if (o.status === 'refusee') s.offers.refused += 1;
  }

  for (const s of map.values()) {
    s.result = s.revenueRealized - s.expenses;
    const h = s.activityMinutes / 60;
    s.resultPerHour = h > 0 ? s.result / h : null;
    s.revenuePerHour = h > 0 ? s.revenueRealized / h : null;
    const ko = kmOdo.get(s.key);
    s.kmOdometer = ko && ko.complete && ko.sum > 0 ? ko.sum : null;
    const kt = kmTr.get(s.key);
    s.kmTrips = kt && kt.complete ? kt.sum : null;
    s.resultPerKm = s.kmOdometer ? s.result / s.kmOdometer : null;
    if (s.activityMinutes === 0) s.completeness.push('Aucune session : taux horaire indisponible');
    if (s.openSessions) s.completeness.push(`${s.openSessions} session(s) non clôturée(s)`);
    if (!s.kmOdometer) s.completeness.push('Compteur kilométrique incomplet : €/km réel indisponible');
    const pending = alive(data.offers).filter(
      (o) => periodKey(o.capturedAt, kind) === s.key && o.status === 'acceptee' && !o.tripId,
    ).length;
    if (pending) s.completeness.push(`${pending} offre(s) acceptée(s) sans course confirmée (non comptées)`);
    const soc = opts.social?.[s.key];
    if (soc && soc.base >= 0 && soc.rate >= 0 && soc.rate < 1) {
      const contribution = soc.base * soc.rate;
      s.social = { base: soc.base, rate: soc.rate, contribution, balance: s.result - contribution };
    }
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}
