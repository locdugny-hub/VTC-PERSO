// Extraction des champs d'une offre Uber / Bolt (France, EUR, km) depuis un texte OCR.
// Principes :
//  - aucun "premier nombre trouvé" : chaque valeur est rattachée à une unité et à une ancre ;
//  - une donnée absente reste null ; une donnée ambiguë n'est pas inventée ;
//  - chaque champ conserve sa provenance, son fragment source et la règle utilisée.
// Les ancres sont des hypothèses de format à valider sur un corpus de captures réelles.
import { PARSER_VERSION } from './types';
import type { Field, ParsedOffer, Platform, PriceBasis } from './types';

const none = <T>(): Field<T> => ({ value: null, provenance: 'none' });
const ocr = <T>(value: T, raw: string, rule: string, confidence: Field<T>['confidence'] = 'high'): Field<T> => ({
  value,
  provenance: 'ocr',
  raw: raw.slice(0, 60),
  rule,
  confidence,
});

/** Minuscule, sans accents, espaces normalisés. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function normalizeText(input: string): string {
  let t = input.replace(/\r\n?/g, '\n');
  t = t.replace(/[    ]/g, ' ');
  t = t.replace(/[‒–—−]/g, '-');
  t = t.replace(/\bEUR\b|\beur\b|\bEuros?\b|\beuros?\b/g, '€');
  // Confusions OCR fréquentes, seulement au contact de chiffres.
  t = t.replace(/(\d)[Oo](?=[\d.,\s€)]|$)/gm, '$10');
  t = t.replace(/(\d[.,])[Oo]/g, '$10');
  t = t.replace(/(\d)[lI](?=\d)/g, '$11');
  t = t.replace(/[ \t]+/g, ' ');
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

export function parseDecimal(s: string): number | null {
  const c = s.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(c)) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

interface Tok {
  kind: 'money' | 'dur' | 'dist';
  value: number;
  start: number;
  end: number;
  raw: string;
  unitOk: boolean;
  /** Durée au format "2 h 35" sans "min" : acceptée seulement si appariée à une distance. */
  hourNoMin?: boolean;
}

const MONEY_RE = /(\+\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*€(\s*\/\s*(?:km|h|heure|min))?|€\s*(\d{1,4}(?:[.,]\d{1,2})?)(\s*\/\s*(?:km|h|heure|min))?/g;
const DUR_RE = /(\d{1,2})\s*h\s*(\d{1,2})?\s*(?:min|mn)?\b|(\d{1,3})\s*(?:mins?|mn|minutes?)\b/g;
const DIST_RE = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(km|mi|m)\b/g;

function tokenize(t: string): { money: (Tok & { plus: boolean; rate: boolean })[]; legs: Tok[] } {
  const money: (Tok & { plus: boolean; rate: boolean })[] = [];
  for (const m of t.matchAll(MONEY_RE)) {
    const num = m[2] ?? m[4];
    const v = parseDecimal(num);
    if (v === null) continue;
    money.push({
      kind: 'money',
      value: v,
      start: m.index!,
      end: m.index! + m[0].length,
      raw: m[0],
      unitOk: true,
      plus: !!m[1],
      rate: !!(m[3] ?? m[5]),
    });
  }
  const legs: Tok[] = [];
  for (const m of t.matchAll(DUR_RE)) {
    let v: number;
    const hourFmt = m[1] !== undefined;
    if (hourFmt) v = Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
    else v = Number(m[3]);
    if (!Number.isFinite(v)) continue;
    const hasMin = /m(i)?n/i.test(m[0]);
    if (hourFmt && !hasMin) {
      // Une heure d'horloge ("vers 2h35", "arrivée à 14 h 05") n'est pas une durée.
      const ls = t.lastIndexOf('\n', m.index! - 1) + 1;
      const before = fold(t.slice(Math.max(ls, m.index! - 16), m.index!));
      if (/(vers|arriv|depos|prevu|avant|apres|heure|a)\s*$/.test(before)) continue;
    }
    legs.push({ kind: 'dur', value: v, start: m.index!, end: m.index! + m[0].length, raw: m[0], unitOk: true, hourNoMin: hourFmt && !hasMin });
  }
  for (const m of t.matchAll(DIST_RE)) {
    const v = parseDecimal(m[1]);
    if (v === null) continue;
    const unit = m[2];
    // Les miles ne sont pas supportés (France) : valeur conservée mais marquée invalide.
    const km = unit === 'km' ? v : unit === 'm' ? v / 1000 : v;
    legs.push({ kind: 'dist', value: km, start: m.index!, end: m.index! + m[0].length, raw: m[0], unitOk: unit !== 'mi' });
  }
  legs.sort((a, b) => a.start - b.start);
  return { money, legs };
}

const APPROACH_ANCHORS = [
  /(^|\s)a\s*$/, // "À 6 min" : le mot "à" juste avant
  /prise en charge/,
  /approche/,
  /pick-?up/,
  /jusqu'?au (client|passager)/,
  /vers (le )?(client|passager)/,
  /recuperation/,
  /pour rejoindre/,
];
const APPROACH_AFTER = [/^\s*\)?\s*(de distance|away|d'approche|pour (le|la) prise)/];
const TRIP_ANCHORS = [/trajet/, /course/, /destination/, /\btrip\b/, /depose/, /voyage/, /duree totale/];
const TRIP_AFTER = [/^\s*\)?\s*(trip|de trajet|de course|jusqu'a destination)/];

type Role = 'approach' | 'trip' | null;

interface Leg {
  min: Tok | null;
  km: Tok | null;
  start: number;
  end: number;
}

/** Associe durée et distance proches (même segment, séparateurs seulement). */
function pairLegs(t: string, toks: Tok[]): Leg[] {
  const legs: Leg[] = [];
  const used = new Set<Tok>();
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i];
    if (used.has(a)) continue;
    const b = toks[i + 1];
    if (b && !used.has(b) && b.kind !== a.kind) {
      const between = t.slice(a.end, b.start);
      // Séparateurs : tout caractère non alphanumérique (·, •, ¢ lu par l'OCR à la place de •, parenthèses...).
      if (/^[^A-Za-z0-9]*$/.test(between) && between.split('\n').length <= 2 && between.length <= 6) {
        used.add(a);
        used.add(b);
        const min = a.kind === 'dur' ? a : b;
        const km = a.kind === 'dist' ? a : b;
        legs.push({ min, km, start: a.start, end: b.end });
        continue;
      }
    }
    used.add(a);
    legs.push({ min: a.kind === 'dur' ? a : null, km: a.kind === 'dist' ? a : null, start: a.start, end: a.end });
  }
  return legs;
}

function lineBounds(t: string, pos: number): [number, number] {
  const s = t.lastIndexOf('\n', pos - 1) + 1;
  let e = t.indexOf('\n', pos);
  if (e < 0) e = t.length;
  return [s, e];
}

function classify(t: string, leg: Leg, prevLegEnd: number): { role: Role; reason: string } {
  const [ls] = lineBounds(t, leg.start);
  const prevLineStart = ls > 0 ? lineBounds(t, ls - 1)[0] : ls;
  const beforeStart = Math.max(prevLegEnd, prevLineStart);
  const beforeSameLine = fold(t.slice(Math.max(ls, prevLegEnd), leg.start));
  const beforeWide = fold(t.slice(beforeStart, leg.start));
  const [, le] = lineBounds(t, leg.end);
  const after = fold(t.slice(leg.end, Math.min(le, leg.end + 30)));

  const isA =
    APPROACH_ANCHORS.some((r) => r.test(beforeSameLine)) ||
    APPROACH_AFTER.some((r) => r.test(after)) ||
    APPROACH_ANCHORS.slice(1).some((r) => r.test(beforeWide));
  const isT = TRIP_ANCHORS.some((r) => r.test(beforeSameLine)) || TRIP_AFTER.some((r) => r.test(after)) || TRIP_ANCHORS.some((r) => r.test(beforeWide));
  // Priorité au contexte immédiat de la ligne.
  const aLine = APPROACH_ANCHORS.some((r) => r.test(beforeSameLine)) || APPROACH_AFTER.some((r) => r.test(after));
  const tLine = TRIP_ANCHORS.some((r) => r.test(beforeSameLine)) || TRIP_AFTER.some((r) => r.test(after));
  if (aLine && !tLine) return { role: 'approach', reason: 'anchor-line' };
  if (tLine && !aLine) return { role: 'trip', reason: 'anchor-line' };
  if (isA && !isT) return { role: 'approach', reason: 'anchor-context' };
  if (isT && !isA) return { role: 'trip', reason: 'anchor-context' };
  return { role: null, reason: isA && isT ? 'both-anchors' : 'no-anchor' };
}

const EXTRA_WORDS = /(inclus|boost|bonus|pourboire|\btip\b|majoration|supplement|peage|promo|prime|defi|quest|surge|dynamique|minimum)/;
const GROSS_CUES = /(prix client|paye par (le )?(client|passager)|tarif (client|passager)|avant commission|prix total client)/;
const NET_CUES = /(vos gains|gains nets?|revenu net|net chauffeur|vous recevrez|vous gagnez|gain estime)/;

export function detectPlatform(t: string): Field<Platform> {
  const f = fold(t);
  const uber = /\buber\s?(x|green|comfort|berline|van|pet|black|pool|share|xl)?\b/.test(f) || /\buberx\b/.test(f);
  const bolt = /\bbolt\b/.test(f);
  if (uber && !bolt) return ocr<Platform>('uber', 'uber', 'platform.keyword');
  if (bolt && !uber) return ocr<Platform>('bolt', 'bolt', 'platform.keyword');
  return none();
}

export function parseOffer(rawText: string): ParsedOffer {
  const t = normalizeText(rawText ?? '');
  const f = fold(t);
  const warnings: string[] = [];
  const platform = detectPlatform(t);
  const { money, legs: legToks } = tokenize(t);

  // ---- Prix
  const extras: ParsedOffer['extras'] = [];
  const candidates: typeof money = [];
  for (const m of money) {
    if (m.rate) continue; // "1,20 €/km" n'est pas un prix d'offre
    const [ls, le] = lineBounds(t, m.start);
    const line = fold(t.slice(ls, le));
    if (m.plus || EXTRA_WORDS.test(line)) {
      extras.push({ label: line.slice(0, 40), amount: m.value, raw: m.raw });
      continue;
    }
    candidates.push(m);
  }
  let price: Field<number> = none();
  // Fourchette "12,50 - 15,00 €" sur UNE ligne, hors bonus et hors heure : borne basse retenue (prudente).
  const ranges: { lo: number; raw: string }[] = [];
  let badRange = false;
  for (const line of t.split('\n')) {
    const fl = fold(line);
    if (EXTRA_WORDS.test(fl) || /\d{1,2}[:h]\d{2}/.test(line)) continue;
    const rm = line.match(/(?<![\d.,:])(\d{1,4}(?:[.,]\d{1,2})?)\s*€?\s*-\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*€/);
    if (!rm) continue;
    const lo = parseDecimal(rm[1]);
    const hi = parseDecimal(rm[2]);
    if (lo !== null && hi !== null && hi > lo) ranges.push({ lo, raw: rm[0] });
    else badRange = true;
  }
  const distinct = [...new Set(candidates.map((c) => c.value))];
  if (ranges.length === 1) {
    price = ocr(ranges[0].lo, ranges[0].raw, 'price.range-low', 'medium');
    warnings.push('Prix en fourchette : borne basse retenue');
  } else if (ranges.length > 1 || badRange) {
    warnings.push(badRange ? 'Fourchette de prix incohérente : prix ambigu' : 'Plusieurs fourchettes de prix : prix ambigu');
  } else if (distinct.length === 1) {
    price = ocr(distinct[0], candidates[0].raw, 'price.single', 'high');
  } else if (distinct.length > 1) {
    // Un montant seul sur sa ligne (présentation habituelle du prix) l'emporte s'il est unique.
    const alone = candidates.filter((c) => {
      const [ls, le] = lineBounds(t, c.start);
      return t.slice(ls, le).trim().length <= c.raw.length + 2;
    });
    const aloneDistinct = [...new Set(alone.map((c) => c.value))];
    if (aloneDistinct.length === 1) {
      price = ocr(aloneDistinct[0], alone[0].raw, 'price.standalone-line', 'medium');
      warnings.push('Plusieurs montants lus : montant isolé retenu');
    } else {
      warnings.push(`Prix ambigu (${distinct.join(' / ')} €)`);
    }
  }
  if (price.value !== null && (price.value <= 0 || price.value > 2000)) {
    warnings.push('Prix hors plage plausible');
    price = none();
  }

  // ---- Base du prix (indice textuel explicite uniquement)
  let priceBasis: Field<PriceBasis> = none();
  const g = GROSS_CUES.test(f);
  const n = NET_CUES.test(f);
  if (g && !n) priceBasis = ocr<PriceBasis>('gross_before_commission', 'indice texte', 'basis.cue', 'medium');
  if (n && !g) priceBasis = ocr<PriceBasis>('net_driver', 'indice texte', 'basis.cue', 'medium');

  // ---- Approche et trajet
  // Écarter les heures d'horloge type "14 h" isolées : on ne garde que les durées <= 300 min.
  const legToksF = legToks.filter((x) => !(x.kind === 'dur' && x.value > 300));
  const legs = pairLegs(t, legToksF).filter((l) => !(l.min && l.min.hourNoMin && !l.km));
  const roles: { leg: Leg; role: Role; reason: string }[] = [];
  let prevEnd = 0;
  for (const leg of legs) {
    const c = classify(t, leg, prevEnd);
    roles.push({ leg, ...c });
    prevEnd = leg.end;
  }
  // Complément : deux segments complets, un seul identifié => l'autre prend le rôle restant.
  const full = roles.filter((r) => r.leg.min && r.leg.km);
  if (full.length === 2) {
    const [r1, r2] = full;
    if (r1.role && !r2.role) {
      r2.role = r1.role === 'approach' ? 'trip' : 'approach';
      r2.reason = 'complement';
    } else if (r2.role && !r1.role) {
      r1.role = r2.role === 'approach' ? 'trip' : 'approach';
      r1.reason = 'complement';
    }
  }

  const pick = (role: 'approach' | 'trip', kind: 'min' | 'km'): Field<number> => {
    const found = roles.filter((r) => r.role === role && r.leg[kind]);
    const values = [...new Set(found.map((r) => r.leg[kind]!.value))];
    if (values.length === 0) return none();
    if (values.length > 1) {
      warnings.push(`${role === 'approach' ? 'Approche' : 'Trajet'} : plusieurs ${kind === 'km' ? 'distances' : 'durées'} candidates`);
      return none();
    }
    const tok = found[0].leg[kind]!;
    if (!tok.unitOk) {
      warnings.push(`Unité non supportée : ${tok.raw}`);
      return none();
    }
    const conf = found[0].reason === 'anchor-line' ? 'high' : 'medium';
    return ocr(tok.value, tok.raw, `${role}.${found[0].reason}`, conf);
  };
  const approachKm = pick('approach', 'km');
  const approachMin = pick('approach', 'min');
  const tripKm = pick('trip', 'km');
  const tripMin = pick('trip', 'min');
  const unresolved = roles.filter((r) => !r.role && (r.leg.min || r.leg.km));
  if (unresolved.length) warnings.push(`${unresolved.length} distance(s)/durée(s) sans rôle identifiable`);

  // Cohérences simples
  if (approachKm.value !== null && approachKm.value > 100) warnings.push('Approche > 100 km : à vérifier');
  if (tripMin.value !== null && tripKm.value !== null && tripMin.value > 0) {
    const kmh = (tripKm.value / tripMin.value) * 60;
    if (kmh > 150) warnings.push('Vitesse moyenne implausible (> 150 km/h)');
  }

  // ---- Échéance éventuelle
  let expiresInSec: Field<number> = none();
  // Sur une même ligne uniquement : "Accepter (12)" ou "12 s" / "12 sec" (jamais "min").
  let exp: RegExpMatchArray | null = null;
  for (const line of t.split('\n')) {
    exp = line.match(/(?:accepter|accept)[ \t]*\([ \t]*(\d{1,2})[ \t]*\)/i) || line.match(/(?<![\d.,])(\d{1,2})[ \t]*(?:s|sec|secondes?)\b(?![ \t]*\/)/i);
    if (exp) break;
  }
  if (exp) {
    const v = Number(exp[1]);
    if (v > 0 && v <= 60) expiresInSec = ocr(v, exp[0], 'expiry.countdown', 'low');
  }

  // ---- Produit
  const prod = f.match(/\b(uberx|uber x|uber green|green|comfort|berline|van|xl|uber pet|bolt comfort|bolt xl|economy|executive|premium)\b/);
  const productLabel = prod ? prod[1] : null;

  const haveLegs = [approachKm, approachMin, tripKm, tripMin].filter((x) => x.value !== null).length;
  let status: ParsedOffer['status'];
  if (price.value === null && haveLegs === 0 && candidates.length === 0) status = 'not_offer';
  else if (price.value === null && (distinct.length > 1 || badRange || ranges.length > 1)) status = 'ambiguous';
  else if (price.value !== null && haveLegs === 4) status = 'ok';
  else status = 'partial';
  if (status === 'not_offer') warnings.push('Aucune offre reconnue dans le texte');

  return {
    platform,
    layoutId: platform.value ? `${platform.value}.fr.v1` : null,
    parserVersion: PARSER_VERSION,
    price,
    currency: price.value !== null ? 'EUR' : null,
    priceBasis,
    approachKm,
    approachMin,
    tripKm,
    tripMin,
    expiresInSec,
    extras,
    productLabel,
    status,
    warnings,
  };
}
