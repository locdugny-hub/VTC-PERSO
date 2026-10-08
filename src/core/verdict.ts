// Verdict original (pas l'algorithme d'un tiers).
// Favorable : les deux seuils atteints.
// Limite : chaque ratio >= 80 % de son seuil et au moins un inférieur.
// Faible : sinon.
// Partiel / indisponible : données nécessaires manquantes ou incertaines.
// Règle de prudence : une valeur incertaine (borne haute) ne peut jamais produire "favorable" ni "limite".
// En revanche, si une borne haute est déjà < 80 % du seuil, "faible" est logiquement certain.
import type { FinanceResult, ThresholdProfile, VerdictResult } from './types';

export const LIMIT_FACTOR = 0.8;

export function computeVerdict(fin: FinanceResult, th: ThresholdProfile): VerdictResult {
  const reasons: string[] = [];
  const level = th.level;
  const validTh = th.perKm > 0 && th.perHour > 0 && Number.isFinite(th.perKm) && Number.isFinite(th.perHour);
  if (!validTh) {
    return { verdict: 'indisponible', level, perKm: null, perHour: null, ratioKm: null, ratioHour: null, reasons: ['Seuils invalides'] };
  }
  if (fin.P === null) {
    return {
      verdict: 'indisponible',
      level,
      perKm: null,
      perHour: null,
      ratioKm: null,
      ratioHour: null,
      reasons: ['Recette chauffeur inconnue', ...fin.missing.filter((m) => m !== 'P').map((m) => `${m} manquant`)],
    };
  }

  const perKm = level === 'revenue' ? fin.revenuePerKm : fin.marginPerKm;
  const perHour = level === 'revenue' ? fin.revenuePerHour : fin.marginPerHour;
  const ratioKm = perKm === null ? null : perKm / th.perKm;
  const ratioHour = perHour === null ? null : perHour / th.perHour;

  // Incertitudes qui font des ratios des bornes hautes.
  const upper = fin.pIsUpperBound || (level === 'margin' && fin.marginExcludesOther);
  if (fin.pIsUpperBound) reasons.push('Base du prix non confirmée');
  if (level === 'margin' && fin.marginExcludesOther) reasons.push('Autres frais non renseignés');
  if (level === 'margin' && fin.margin === null) {
    const costsMissing = fin.missing.includes('coût variable v') || fin.missing.includes('allocation fixe f');
    reasons.push(costsMissing ? 'Coûts non renseignés : marge indisponible' : 'Marge indisponible : distance ou durée manquante');
  }
  if (perKm === null) reasons.push('€/km indisponible');
  if (perHour === null) reasons.push(fin.T === null ? '€/h indisponible (durée manquante)' : '€/h indisponible');

  const available = [ratioKm, ratioHour].filter((r): r is number => r !== null);
  const anyBelowLimit = available.some((r) => r < LIMIT_FACTOR);

  if (anyBelowLimit) {
    // Certain même avec une donnée manquante ou une borne haute.
    if (ratioKm !== null && ratioKm < LIMIT_FACTOR) reasons.unshift(`€/km sous 80 % du seuil`);
    if (ratioHour !== null && ratioHour < LIMIT_FACTOR) reasons.unshift(`€/h sous 80 % du seuil`);
    return { verdict: 'faible', level, perKm, perHour, ratioKm, ratioHour, reasons };
  }
  if (available.length < 2 || upper) {
    if (available.length === 0) {
      // Niveau "marge" sans coûts : les indicateurs avant frais restent affichables => partiel, pas indisponible.
      const pre = fin.revenuePerKm !== null || fin.revenuePerHour !== null;
      return { verdict: pre ? 'partiel' : 'indisponible', level, perKm, perHour, ratioKm, ratioHour, reasons };
    }
    return { verdict: 'partiel', level, perKm, perHour, ratioKm, ratioHour, reasons };
  }
  const [rk, rh] = [ratioKm as number, ratioHour as number];
  if (rk >= 1 && rh >= 1) return { verdict: 'favorable', level, perKm, perHour, ratioKm, ratioHour, reasons: ['Deux seuils atteints', ...reasons] };
  if (rk < 1) reasons.unshift('€/km sous le seuil');
  if (rh < 1) reasons.unshift('€/h sous le seuil');
  return { verdict: 'limite', level, perKm, perHour, ratioKm, ratioHour, reasons };
}

export const VERDICT_LABEL: Record<VerdictResult['verdict'], string> = {
  favorable: 'Favorable',
  limite: 'Limite',
  faible: 'Faible',
  partiel: 'Partiel',
  indisponible: 'Analyse indisponible',
};

export const VERDICT_SYMBOL: Record<VerdictResult['verdict'], string> = {
  favorable: '✅',
  limite: '🟠',
  faible: '⛔',
  partiel: '❔',
  indisponible: '⚠️',
};
