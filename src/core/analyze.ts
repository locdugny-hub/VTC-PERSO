// Chaîne complète du parcours rapide : texte OCR + configuration locale -> analyse + restitution courte.
// Aucune dépendance réseau. Utilisée par le script du raccourci, le composant natif, la PWA et le serveur.
import { computeFinance, fmtNum } from './finance';
import { parseOffer } from './parse';
import { computeVerdict, VERDICT_LABEL, VERDICT_SYMBOL } from './verdict';
import { ENGINE_VERSION } from './types';
import type { Analysis, FastConfig, FinanceInput, ParsedOffer, PriceBasis } from './types';

export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Repli (Scriptable / JavaScriptCore) : UUID v4 pseudo-aléatoire, suffisant pour un identifiant de requête.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Construit l'entrée financière depuis l'offre lue et la configuration (provenance conservée dans l'offre). */
export function buildFinanceInput(offer: ParsedOffer, cfg: FastConfig): FinanceInput {
  const plat = offer.platform.value && offer.platform.value !== 'unknown' ? offer.platform.value : null;
  const rule = plat ? cfg.platforms[plat] : null;
  let basis: PriceBasis = 'unknown';
  if (offer.priceBasis.value) basis = offer.priceBasis.value;
  else if (rule) basis = rule.priceBasis;
  return {
    price: offer.price.value,
    priceBasis: basis,
    // Le taux n'est utilisé que si l'utilisateur a confirmé que cette plateforme affiche un montant avant commission.
    commissionRate: rule && rule.priceBasis === 'gross_before_commission' ? rule.commissionRate : null,
    approachKm: offer.approachKm.value,
    approachMin: offer.approachMin.value,
    tripKm: offer.tripKm.value,
    tripMin: offer.tripMin.value,
    scenario: cfg.scenario,
    variablePerKm: cfg.cost.variablePerKm,
    fixedPerHour: cfg.cost.fixedPerHour,
    otherCosts: cfg.cost.otherPerOffer,
  };
}

/** Applique la plateforme de session si le texte ne l'identifie pas (provenance "config"). */
export function applySessionPlatform(offer: ParsedOffer, cfg: FastConfig): ParsedOffer {
  if (offer.platform.value || !cfg.sessionPlatform || cfg.sessionPlatform === 'unknown') return offer;
  return { ...offer, platform: { value: cfg.sessionPlatform, provenance: 'config', rule: 'session-platform' } };
}

function hhmmss(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  // Heure locale de l'appareil (Europe/Paris sur le téléphone de l'utilisateur).
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function buildDisplay(a: Omit<Analysis, 'display'>): Analysis['display'] {
  const v = a.verdict;
  const lvl = v.level === 'margin' ? 'marge' : 'recette';
  const fin0 = a.finance;
  // Si le niveau choisi n'est pas calculable (coûts absents), on montre la recette AVANT FRAIS, libellée comme telle.
  const preCost = v.perHour === null && v.perKm === null && (fin0.revenuePerHour !== null || fin0.revenuePerKm !== null);
  const main =
    v.perHour !== null
      ? `${fmtNum(v.perHour, 2)} €/h ${lvl}`
      : v.perKm !== null
        ? `${fmtNum(v.perKm, 2)} €/km ${lvl}`
        : preCost
          ? fin0.revenuePerHour !== null
            ? `${fmtNum(fin0.revenuePerHour, 2)} €/h recette avant frais`
            : `${fmtNum(fin0.revenuePerKm, 2)} €/km recette avant frais`
          : '';
  const title = `${VERDICT_SYMBOL[v.verdict]} ${VERDICT_LABEL[v.verdict]}${main ? ' · ' + main : ''}`;
  const parts: string[] = [];
  if (v.perKm !== null && v.perHour !== null) parts.push(`${fmtNum(v.perKm, 2)} €/km`);
  if (preCost && fin0.revenuePerHour !== null && fin0.revenuePerKm !== null) parts.push(`${fmtNum(fin0.revenuePerKm, 2)} €/km avant frais`);
  const fin = a.finance;
  if (fin.P !== null) parts.push(`P ${fmtNum(fin.P, 2)} €${fin.pIsUpperBound ? ' (base ?)' : ''}`);
  if (fin.D !== null) parts.push(`${fmtNum(fin.D, 1)} km`);
  if (fin.T !== null) parts.push(`${fmtNum(fin.T, 0)} min`);
  if (a.input.approachKm !== null || a.input.approachMin !== null) parts.push('approche incluse');
  if (v.verdict === 'partiel' || v.verdict === 'indisponible' || v.verdict === 'faible') {
    const r = v.reasons[0];
    if (r) parts.push(r);
  }
  const plat = a.offer.platform.value ? a.offer.platform.value.toUpperCase() : 'plateforme ?';
  parts.push(`${plat} ${hhmmss(a.capturedAt)}`);
  let speech: string;
  if (v.verdict === 'indisponible') speech = 'Analyse indisponible.';
  else if (v.perHour !== null) speech = `${VERDICT_LABEL[v.verdict]}. ${Math.round(v.perHour)} euros de l'heure.`;
  else if (preCost && fin0.revenuePerHour !== null) speech = `${VERDICT_LABEL[v.verdict]}. ${Math.round(fin0.revenuePerHour)} euros de l'heure avant frais.`;
  else if (v.perKm !== null) speech = `${VERDICT_LABEL[v.verdict]}. ${fmtNum(v.perKm, 2).replace(',', ' euro ')} du kilomètre.`;
  else speech = `${VERDICT_LABEL[v.verdict]}.`;
  return { title, body: parts.join(' · '), speech };
}

export interface AnalyzeOptions {
  id?: string;
  capturedAt?: string; // ISO de déclenchement
  now?: () => Date;
  source?: Analysis['source'];
}

export function analyzeText(text: string, cfg: FastConfig, opts: AnalyzeOptions = {}): Analysis {
  const now = opts.now ?? (() => new Date());
  const capturedAt = opts.capturedAt ?? now().toISOString();
  const offer = applySessionPlatform(parseOffer(text), cfg);
  return analyzeParsed(offer, cfg, { ...opts, capturedAt, now });
}

export function analyzeParsed(offer: ParsedOffer, cfg: FastConfig, opts: AnalyzeOptions = {}): Analysis {
  const now = opts.now ?? (() => new Date());
  const capturedAt = opts.capturedAt ?? now().toISOString();
  const input = buildFinanceInput(offer, cfg);
  const finance = computeFinance(input);
  let verdict = computeVerdict(finance, cfg.thresholds);
  if (offer.status === 'not_offer') {
    verdict = { ...verdict, verdict: 'indisponible', reasons: ['Aucune offre reconnue', ...verdict.reasons] };
  }
  const expiry = offer.expiresInSec.value;
  const validSec = expiry !== null ? Math.min(expiry, cfg.freshnessSec) : cfg.freshnessSec;
  const validUntil = new Date(new Date(capturedAt).getTime() + validSec * 1000).toISOString();
  const base: Omit<Analysis, 'display'> = {
    id: opts.id ?? newId(),
    engineVersion: ENGINE_VERSION,
    parserVersion: offer.parserVersion,
    configId: cfg.configId,
    costProfileRef: { id: cfg.cost.id, version: cfg.cost.version },
    thresholdRef: { id: cfg.thresholds.id, version: cfg.thresholds.version },
    thresholdValues: { level: cfg.thresholds.level, perKm: cfg.thresholds.perKm, perHour: cfg.thresholds.perHour },
    capturedAt,
    analyzedAt: now().toISOString(),
    validUntil,
    source: opts.source ?? 'shortcut',
    offer,
    input,
    finance,
    verdict,
  };
  return { ...base, display: buildDisplay(base) };
}

/** Règle de fraîcheur explicite : un résultat n'est une recommandation active que jusqu'à validUntil. */
export function isFresh(a: Pick<Analysis, 'validUntil'>, now: Date = new Date()): boolean {
  return now.getTime() <= new Date(a.validUntil).getTime();
}

/**
 * Arbitrage entre analyses concurrentes : un résultat n'est restitué que s'il correspond
 * à la requête la plus récente connue (horodatage de déclenchement) et qu'il est encore frais.
 */
export function shouldDisplay(
  a: Pick<Analysis, 'capturedAt' | 'validUntil' | 'id'>,
  latestRequest: { id: string; capturedAt: string } | null,
  now: Date = new Date(),
): { show: boolean; reason: string } {
  if (latestRequest && latestRequest.id !== a.id && new Date(latestRequest.capturedAt) > new Date(a.capturedAt)) {
    return { show: false, reason: 'Résultat remplacé par une offre plus récente' };
  }
  if (!isFresh(a, now)) return { show: false, reason: 'Résultat périmé' };
  return { show: true, reason: 'ok' };
}
