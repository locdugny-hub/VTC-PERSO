// Sauvegarde JSON versionnée, vérification après import, export CSV.
import { STORES } from './domain';
import type { StoreName, StoreTypes } from './domain';

export const BACKUP_FORMAT = 'vtcperso-backup';
export const BACKUP_VERSION = 1;

export type Dataset = { [K in StoreName]: StoreTypes[K][] };

export interface BackupSummary {
  counts: Record<StoreName, number>;
  totals: { tripRevenue: number; expenses: number; offerPrices: number };
  relations: { tripsWithOffer: number; offersWithTrip: number; offersWithSession: number };
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  app: string;
  data: Dataset;
  summary: BackupSummary;
}

export function emptyDataset(): Dataset {
  return Object.fromEntries(STORES.map((s) => [s, []])) as unknown as Dataset;
}

const cents = (x: number) => Math.round(x * 100);

export function summarizeDataset(d: Dataset): BackupSummary {
  const counts = Object.fromEntries(STORES.map((s) => [s, d[s].length])) as Record<StoreName, number>;
  const live = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter((x) => !x.deleted);
  return {
    counts,
    totals: {
      tripRevenue: live(d.trips).reduce((s, t) => s + cents(t.revenue), 0) / 100,
      expenses: live(d.expenses).reduce((s, e) => s + cents(e.amount), 0) / 100,
      offerPrices: live(d.offers).reduce((s, o) => s + cents(o.original.offer.price.value ?? 0), 0) / 100,
    },
    relations: {
      tripsWithOffer: d.trips.filter((t) => t.offerId).length,
      offersWithTrip: d.offers.filter((o) => o.tripId).length,
      offersWithSession: d.offers.filter((o) => o.sessionId).length,
    },
  };
}

export function makeBackup(d: Dataset, now = new Date().toISOString()): Backup {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, app: 'VTC Perso', data: d, summary: summarizeDataset(d) };
}

export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; error: string } {
  let b: Backup;
  try {
    b = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Fichier JSON illisible' };
  }
  if (b?.format !== BACKUP_FORMAT) return { ok: false, error: 'Ce fichier n’est pas une sauvegarde VTC Perso' };
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) return { ok: false, error: `Version ${b.version} non prise en charge` };
  for (const s of STORES) if (!Array.isArray(b.data?.[s])) return { ok: false, error: `Section ${s} manquante` };
  for (const s of STORES) for (const r of b.data[s] as { id?: unknown }[]) if (typeof r.id !== 'string') return { ok: false, error: `Identifiant manquant dans ${s}` };
  // Contrôle d'intégrité : le résumé embarqué doit correspondre aux données.
  const check = summarizeDataset(b.data);
  if (JSON.stringify(check) !== JSON.stringify(b.summary)) return { ok: false, error: 'Résumé incohérent : fichier modifié ou incomplet' };
  return { ok: true, backup: b };
}

/**
 * Vérifie qu'une restauration reproduit les comptes, relations et totaux.
 * exact = true quand la base cible était vide avant l'import (égalité stricte attendue).
 */
export function verifyRestore(expected: BackupSummary, actual: Dataset, exact = true): string[] {
  const a = summarizeDataset(actual);
  const errs: string[] = [];
  for (const s of STORES) {
    if (exact ? a.counts[s] !== expected.counts[s] : a.counts[s] < expected.counts[s]) errs.push(`${s} : ${a.counts[s]} lignes au lieu de ${expected.counts[s]}`);
  }
  if (exact) {
    if (a.totals.tripRevenue !== expected.totals.tripRevenue) errs.push('Total des recettes différent');
    if (a.totals.expenses !== expected.totals.expenses) errs.push('Total des dépenses différent');
    if (a.totals.offerPrices !== expected.totals.offerPrices) errs.push('Total des prix d\u2019offres différent');
    for (const k of ['tripsWithOffer', 'offersWithTrip', 'offersWithSession'] as const) if (a.relations[k] !== expected.relations[k]) errs.push(`Relations ${k} différentes`);
  }
  return errs;
}

/** Neutralise les formules dans un tableur (=, +, -, @ en tête d'un texte). */
function csvSafe(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : csvSafe(String(v));
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** CSV séparé par ";" (Excel FR), décimales à virgule. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const head = columns.join(';');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(';'));
  return '﻿' + [head, ...body].join('\n');
}

export function offersCsv(d: Dataset): string {
  const rows = d.offers
    .filter((o) => !o.deleted)
    .map((o) => {
      const a = o.corrected ?? o.original;
      return {
        id: o.id,
        capture: o.capturedAt,
        plateforme: o.platform,
        statut: o.status,
        prix_lu: a.offer.price.value,
        base: a.input.priceBasis,
        recette_P: a.finance.P,
        km_total: a.finance.D,
        min_total: a.finance.T,
        recette_km: a.finance.revenuePerKm,
        recette_h: a.finance.revenuePerHour,
        marge: a.finance.margin,
        marge_km: a.finance.marginPerKm,
        marge_h: a.finance.marginPerHour,
        verdict: a.verdict.verdict,
        niveau: a.verdict.level,
        config: a.configId,
        corrigee: o.corrected ? 'oui' : 'non',
      };
    });
  return toCsv(rows, Object.keys(rows[0] ?? { id: 1 }));
}

export function tripsCsv(d: Dataset): string {
  const rows = d.trips.filter((t) => !t.deleted).map((t) => ({ id: t.id, date: t.date, plateforme: t.platform, statut: t.status, recette: t.revenue, km: t.km, minutes: t.minutes, offre: t.offerId }));
  return toCsv(rows, ['id', 'date', 'plateforme', 'statut', 'recette', 'km', 'minutes', 'offre']);
}

export function expensesCsv(d: Dataset): string {
  const rows = d.expenses.filter((e) => !e.deleted).map((e) => ({ id: e.id, date: e.date, categorie: e.category, montant: e.amount, note: e.note, source: e.source }));
  return toCsv(rows, ['id', 'date', 'categorie', 'montant', 'note', 'source']);
}
