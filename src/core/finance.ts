// Moteur financier déterministe, indépendant de l'OCR, de Gemini et de l'interface.
// Calculs en nombres décimaux, arrondi uniquement à l'affichage.
import type { FinanceInput, FinanceResult } from './types';

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function sumKnown(parts: (number | null | undefined)[], required: (number | null | undefined)[]): number | null {
  // Les termes "required" doivent tous être connus ; les autres sont optionnels mais
  // s'ils sont fournis (non null), ils sont ajoutés.
  for (const r of required) if (!isNum(r)) return null;
  let s = 0;
  for (const p of parts) if (isNum(p)) s += p;
  return s;
}

/** Recette chauffeur P à partir du montant lu et de sa base. */
export function driverRevenue(
  price: number | null,
  basis: FinanceInput['priceBasis'],
  commissionRate: number | null,
): { P: number | null; upperBound: boolean; note: string | null } {
  if (!isNum(price) || price < 0) return { P: null, upperBound: false, note: 'Prix inconnu' };
  if (basis === 'net_driver') return { P: price, upperBound: false, note: null };
  if (basis === 'gross_before_commission') {
    if (!isNum(commissionRate) || commissionRate < 0 || commissionRate >= 1) {
      // Aucune commission déduite sans taux confirmé : le montant affiché n'est qu'une borne haute de P.
      return { P: price, upperBound: true, note: 'Montant avant commission, taux non confirmé : montant affiché utilisé comme borne haute' };
    }
    return { P: price * (1 - commissionRate), upperBound: false, note: `Commission ${(commissionRate * 100).toFixed(1)} % déduite` };
  }
  // Base inconnue : on garde le montant affiché comme borne haute de la recette chauffeur.
  return { P: price, upperBound: true, note: 'Base du prix inconnue : montant affiché utilisé comme borne haute' };
}

export function computeFinance(input: FinanceInput): FinanceResult {
  const notes: string[] = [];
  const missing: string[] = [];
  const rev = driverRevenue(input.price, input.priceBasis, input.commissionRate);
  if (rev.note) notes.push(rev.note);
  if (rev.P === null) missing.push('P');

  const sc = input.scenario;
  const returnKm = isNum(sc.returnKm) && sc.returnKm > 0 ? sc.returnKm : null;
  const returnMin = isNum(sc.returnMin) && sc.returnMin > 0 ? sc.returnMin : null;
  const waitMin = isNum(sc.waitMin) && sc.waitMin > 0 ? sc.waitMin : null;
  if ((returnKm === null) !== (returnMin === null)) notes.push('Retour simulé incomplet : ignoré');
  const useReturn = returnKm !== null && returnMin !== null;
  if (useReturn) notes.push(`Retour simulé inclus : ${returnKm} km / ${returnMin} min`);
  if (waitMin !== null) notes.push(`Attente incluse : ${waitMin} min`);

  const D = sumKnown([input.approachKm, input.tripKm, useReturn ? returnKm : null], [input.approachKm, input.tripKm]);
  const T = sumKnown(
    [input.approachMin, input.tripMin, useReturn ? returnMin : null, waitMin],
    [input.approachMin, input.tripMin],
  );
  if (!isNum(input.approachKm)) missing.push('distance d’approche');
  if (!isNum(input.tripKm)) missing.push('distance du trajet');
  if (!isNum(input.approachMin)) missing.push('durée d’approche');
  if (!isNum(input.tripMin)) missing.push('durée du trajet');

  const P = rev.P;
  const revenuePerKm = P !== null && D !== null && D > 0 ? P / D : null;
  const revenuePerHour = P !== null && T !== null && T > 0 ? (60 * P) / T : null;
  if (D === 0) notes.push('Distance totale nulle : €/km indisponible');
  if (T === 0) notes.push('Durée totale nulle : €/h indisponible');

  const v = isNum(input.variablePerKm) && input.variablePerKm >= 0 ? input.variablePerKm : null;
  const f = isNum(input.fixedPerHour) && input.fixedPerHour >= 0 ? input.fixedPerHour : null;
  const E = isNum(input.otherCosts) && input.otherCosts >= 0 ? input.otherCosts : null;
  if (v === null) missing.push('coût variable v');
  if (f === null) missing.push('allocation fixe f');

  const variableCost = v !== null && D !== null ? v * D : null;
  const fixedAllocation = f !== null && T !== null ? (f * T) / 60 : null;
  let margin: number | null = null;
  let marginExcludesOther = false;
  if (P !== null && variableCost !== null && fixedAllocation !== null) {
    margin = P - variableCost - fixedAllocation - (E ?? 0);
    if (E === null) {
      marginExcludesOther = true;
      notes.push('Autres frais E non renseignés : marge hors E (borne haute)');
    }
  }
  const marginPerKm = margin !== null && D !== null && D > 0 ? margin / D : null;
  const marginPerHour = margin !== null && T !== null && T > 0 ? (60 * margin) / T : null;

  return {
    P,
    pIsUpperBound: rev.upperBound,
    D,
    T,
    revenuePerKm,
    revenuePerHour,
    variableCost,
    fixedAllocation,
    margin,
    marginExcludesOther,
    marginPerKm,
    marginPerHour,
    notes,
    missing,
  };
}

/** Arrondi d'affichage (jamais utilisé dans les calculs). */
export function round(x: number | null, digits = 2): number | null {
  if (!isNum(x)) return null;
  const k = 10 ** digits;
  return Math.round((x + Number.EPSILON) * k) / k;
}

export function fmtEur(x: number | null, digits = 2): string {
  if (!isNum(x)) return '—';
  return x.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' €';
}

export function fmtNum(x: number | null, digits = 2): string {
  if (!isNum(x)) return '—';
  return x.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
