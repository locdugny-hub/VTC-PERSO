// Tests des parseurs sur des TEXTES FICTIFS reproduisant des présentations plausibles.
// Ils vérifient la logique (ancres, unités, ambiguïtés) ; ils ne remplacent pas un corpus
// de captures réelles annotées (voir docs/VALIDATION_IPHONE.md).
import { describe, expect, it } from 'vitest';
import { parseOffer, normalizeText, parseDecimal } from '../src/core/parse';
import { analyzeText, shouldDisplay, isFresh } from '../src/core/analyze';
import { demoConfig } from '../src/core/config';

const v = (o: ReturnType<typeof parseOffer>) => ({
  price: o.price.value,
  aKm: o.approachKm.value,
  aMin: o.approachMin.value,
  tKm: o.tripKm.value,
  tMin: o.tripMin.value,
  platform: o.platform.value,
});

describe('Normalisation', () => {
  it('virgules, points, espaces insécables, OCR O/0', () => {
    expect(parseDecimal('12,50')).toBe(12.5);
    expect(parseDecimal('12.50')).toBe(12.5);
    expect(normalizeText('12,5O €')).toBe('12,50 €');
    expect(normalizeText('1O km')).toBe('10 km');
  });
});

describe('Uber (formats hypothétiques FR)', () => {
  it('format "À x min (y km)" / "Trajet de x min (y km)"', () => {
    const o = parseOffer(`UberX\nExclusif\n12,50 €\n★ 4,92\nÀ 6 min (2,0 km)\n12 rue Exemple, Paris\nTrajet de 20 min (8,0 km)\nAv. Fictive, Paris\nAccepter`);
    expect(v(o)).toEqual({ price: 12.5, aKm: 2, aMin: 6, tKm: 8, tMin: 20, platform: 'uber' });
    expect(o.status).toBe('ok');
    expect(o.price.provenance).toBe('ocr');
    expect(o.approachKm.rule).toBe('approach.anchor-line');
  });

  it('format anglais "6 mins (2.0 km) away" / "20 mins (8.0 km) trip"', () => {
    const o = parseOffer(`Uber Green\n€12.50\n6 mins (2.0 km) away\n20 mins (8.0 km) trip`);
    expect(v(o)).toEqual({ price: 12.5, aKm: 2, aMin: 6, tKm: 8, tMin: 20, platform: 'uber' });
  });

  it('texte agrandi : durée et distance coupées sur deux lignes', () => {
    const o = parseOffer(`UberX\n12,50\n€\nÀ 6 min\n(2,0 km)\nTrajet de 20 min\n(8,0 km)`);
    // "12,50\n€" : le montant est rattaché à l'unité malgré le retour à la ligne
    expect(o.approachKm.value).toBe(2);
    expect(o.tripMin.value).toBe(20);
    expect(o.tripKm.value).toBe(8);
  });

  it('bonus "+2,00 € inclus" non confondu avec le prix', () => {
    const o = parseOffer(`UberX\n14,50 €\n+2,00 € inclus\nÀ 3 min (1,1 km)\nTrajet de 15 min (6,4 km)`);
    expect(o.price.value).toBe(14.5);
    expect(o.extras).toHaveLength(1);
    expect(o.extras[0].amount).toBe(2);
  });

  it('distance en mètres convertie', () => {
    const o = parseOffer(`UberX\n9,80 €\nÀ 2 min (800 m)\nTrajet de 12 min (4,5 km)`);
    expect(o.approachKm.value).toBeCloseTo(0.8, 10);
  });

  it('durée en heures "1 h 05"', () => {
    const o = parseOffer(`UberX\n58,00 €\nÀ 4 min (1,5 km)\nTrajet de 1 h 05 min (62 km)`);
    expect(o.tripMin.value).toBe(65);
    expect(o.tripKm.value).toBe(62);
  });
});

describe('Bolt (formats hypothétiques FR)', () => {
  it('format "Prise en charge · 4 min · 1,2 km" / "Destination · 18 min · 7,5 km"', () => {
    const o = parseOffer(`Bolt\n11,20 €\nPrise en charge · 4 min · 1,2 km\nDestination · 18 min · 7,5 km\nAccepter`);
    expect(v(o)).toEqual({ price: 11.2, aKm: 1.2, aMin: 4, tKm: 7.5, tMin: 18, platform: 'bolt' });
  });

  it('ordre km puis min "1,2 km • 4 min"', () => {
    const o = parseOffer(`Bolt\n11,20 €\nPrise en charge\n1,2 km • 4 min\nTrajet\n7,5 km • 18 min`);
    expect(v(o)).toEqual({ price: 11.2, aKm: 1.2, aMin: 4, tKm: 7.5, tMin: 18, platform: 'bolt' });
  });

  it('fourchette de prix : borne basse prudente et avertissement', () => {
    const o = parseOffer(`Bolt\n11,20 - 13,40 €\nPrise en charge · 4 min · 1,2 km\nTrajet · 18 min · 7,5 km`);
    expect(o.price.value).toBe(11.2);
    expect(o.price.rule).toBe('price.range-low');
  });

  it('indice "Prix client" => base avant commission', () => {
    const o = parseOffer(`Bolt\nPrix client 20,00 €\nPrise en charge · 4 min · 1,2 km\nTrajet · 18 min · 7,5 km`);
    expect(o.priceBasis.value).toBe('gross_before_commission');
  });
});

describe('Robustesse et refus', () => {
  it('écran partiellement masqué : trajet absent => partiel, pas d’invention', () => {
    const o = parseOffer(`UberX\n12,50 €\nÀ 6 min (2,0 km)`);
    expect(o.tripKm.value).toBeNull();
    expect(o.tripMin.value).toBeNull();
    expect(o.status).toBe('partial');
    const a = analyzeText(`UberX\n12,50 €\nÀ 6 min (2,0 km)`, demoConfig());
    expect(a.verdict.verdict).not.toBe('favorable');
  });

  it('deux prix concurrents sans indice : ambigu, prix inconnu', () => {
    const o = parseOffer(`UberX 12,50 € 15,00 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)`);
    expect(o.price.value).toBeNull();
    expect(o.status).toBe('ambiguous');
    expect(analyzeText(`UberX 12,50 € 15,00 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)`, demoConfig()).verdict.verdict).toBe('indisponible');
  });

  it('miles refusés (France uniquement)', () => {
    const o = parseOffer(`UberX\n12,50 €\nÀ 6 min (1.2 mi)\nTrajet de 20 min (5.0 mi)`);
    expect(o.approachKm.value).toBeNull();
    expect(o.warnings.join(' ')).toMatch(/Unité non supportée/);
  });

  it('écran sans offre (guidage) : not_offer', () => {
    const o = parseOffer(`14:32\nTournez à droite dans 300 m\nRue de Rivoli\n5G`);
    expect(o.status).toBe('not_offer');
    const a = analyzeText(`14:32\nTournez à droite dans 300 m`, demoConfig());
    expect(a.verdict.verdict).toBe('indisponible');
  });

  it('heure système et note passager ignorées', () => {
    const o = parseOffer(`14:32\nUberX\n4,95 ★\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)`);
    expect(o.price.value).toBe(12.5);
  });

  it('format inconnu (pas d’ancre) : rôles non attribués', () => {
    const o = parseOffer(`12,50 €\n6 min 2,0 km\n20 min 8,0 km`);
    expect(o.approachKm.value).toBeNull();
    expect(o.tripKm.value).toBeNull();
    expect(o.warnings.join(' ')).toMatch(/sans rôle/);
  });

  it('un seul segment identifié parmi deux complets : complément documenté', () => {
    const o = parseOffer(`UberX\n12,50 €\n6 min (2,0 km)\nTrajet de 20 min (8,0 km)`);
    expect(o.approachKm.value).toBe(2);
    expect(o.approachKm.rule).toBe('approach.complement');
    expect(o.approachKm.confidence).toBe('medium');
  });

  it('plateforme non identifiée : plateforme de session appliquée avec provenance config', () => {
    const cfg = { ...demoConfig(), sessionPlatform: 'uber' as const };
    const a = analyzeText(`12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)`, cfg);
    expect(a.offer.platform.value).toBe('uber');
    expect(a.offer.platform.provenance).toBe('config');
  });

  it('même entrée => même résultat (déterminisme)', () => {
    const t = `UberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)`;
    const fixed = { capturedAt: '2026-10-08T10:00:00.000Z', now: () => new Date('2026-10-08T10:00:00.400Z'), id: 'r1' };
    expect(analyzeText(t, demoConfig(), fixed)).toEqual(analyzeText(t, demoConfig(), fixed));
  });
});

describe('Analyse complète, fraîcheur et concurrence', () => {
  const t = `UberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)`;
  it('démo : marge 8,33 €, 19,23 €/h, verdict favorable (seuils démo 1 €/km ? non : 0,83 < 1) ', () => {
    const a = analyzeText(t, demoConfig());
    expect(Math.round(a.finance.margin! * 100) / 100).toBe(8.33);
    // seuils démo : 1 €/km et 18 €/h au niveau marge -> 0,83 €/km = 83 % => limite
    expect(a.verdict.verdict).toBe('limite');
    expect(a.display.title).toMatch(/Limite/);
    expect(a.display.speech).toBe("Limite. 19 euros de l'heure.");
  });

  it('résultat périmé après la fenêtre de fraîcheur', () => {
    const a = analyzeText(t, demoConfig(), { capturedAt: '2026-10-08T10:00:00.000Z' });
    expect(isFresh(a, new Date('2026-10-08T10:00:09.000Z'))).toBe(true);
    expect(isFresh(a, new Date('2026-10-08T10:00:11.000Z'))).toBe(false);
  });

  it('un ancien résultat ne remplace pas une offre plus récente', () => {
    const old = analyzeText(t, demoConfig(), { id: 'a', capturedAt: '2026-10-08T10:00:00.000Z' });
    const latest = { id: 'b', capturedAt: '2026-10-08T10:00:02.000Z' };
    expect(shouldDisplay(old, latest, new Date('2026-10-08T10:00:03.000Z')).show).toBe(false);
    expect(shouldDisplay(old, { id: 'a', capturedAt: old.capturedAt }, new Date('2026-10-08T10:00:03.000Z')).show).toBe(true);
  });

  it('échéance lue plus courte que la fraîcheur configurée', () => {
    const a = analyzeText(`Bolt\n11,20 €\nPrise en charge · 4 min · 1,2 km\nTrajet · 18 min · 7,5 km\nAccepter (6)`, demoConfig(), { capturedAt: '2026-10-08T10:00:00.000Z' });
    expect(a.offer.expiresInSec.value).toBe(6);
    expect(a.validUntil).toBe('2026-10-08T10:00:06.000Z');
  });
});

describe('Correctifs issus de la revue', () => {
  it('heure + montant sur une ligne : pas de fourchette inventée', () => {
    const o = parseOffer('UberX\nArrivée 14:05 - 12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)');
    expect(o.price.value).toBe(12.5);
    expect(o.price.rule).not.toBe('price.range-low');
  });
  it('bonus en fourchette ignoré', () => {
    const o = parseOffer('UberX\n12,50 €\nBonus 1 - 3 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)');
    expect(o.price.value).toBe(12.5);
  });
  it('fourchette inversée : repli sur le montant unique', () => {
    const o = parseOffer('Bolt\n15,00 - 12,00 €\nPrise en charge · 4 min · 1,2 km\nTrajet · 18 min · 7,5 km');
    expect(o.price.value).toBeNull(); // deux montants, pas de fourchette valide : ambigu
    expect(o.status).toBe('ambiguous');
  });
  it('compte à rebours : pas de confusion avec "15 min" ou "2 places"', () => {
    expect(parseOffer('UberX\n12,50 €\nAccepter\n15 min (8,0 km) trip').expiresInSec.value).toBeNull();
    expect(parseOffer('UberX\n12,50 €\nReste 2 places').expiresInSec.value).toBeNull();
    expect(parseOffer('Bolt\n11,20 €\nAccepter (12)').expiresInSec.value).toBe(12);
    expect(parseOffer('Bolt\n11,20 €\nExpire dans 8 s').expiresInSec.value).toBe(8);
  });
  it('heure de dépose "vers 2h35" non lue comme durée', () => {
    const o = parseOffer('UberX\n32,00 €\nÀ 5 min (2,0 km)\nTrajet de 25 min (18,0 km)\nDépose vers 2h35');
    expect(o.tripMin.value).toBe(25);
    expect(o.status).toBe('ok');
  });
  it('durée "À 1 h 05 min (60 km)" conservée', () => {
    const o = parseOffer('UberX\n80,00 €\nÀ 1 h 05 min (60 km)\nTrajet de 30 min (25 km)');
    expect(o.approachMin.value).toBe(65);
  });
});

describe('Commission non confirmée (revue)', () => {
  it('indice "prix client" + plateforme non confirmée : aucune commission, jamais favorable', async () => {
    const { buildFastConfig } = await import('../src/core/config');
    const base = demoConfig();
    const cfg = buildFastConfig({ ...base, thresholds: { ...base.thresholds, perKm: 0.5, perHour: 5 }, platforms: { uber: { priceBasis: 'unknown', commissionRate: 0.25 }, bolt: base.platforms.bolt } });
    const a = analyzeText('UberX\nPrix client 40,00 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)', cfg);
    expect(a.input.commissionRate).toBeNull();
    expect(a.finance.P).toBe(40);
    expect(a.finance.pIsUpperBound).toBe(true);
    expect(a.verdict.verdict).toBe('partiel');
  });
});

describe('Coûts absents au niveau marge (revue)', () => {
  it('affiche la recette avant frais, verdict partiel', async () => {
    const { buildFastConfig } = await import('../src/core/config');
    const base = demoConfig();
    const cfg = buildFastConfig({ ...base, cost: { ...base.cost, variablePerKm: null, fixedPerHour: null } });
    const a = analyzeText('UberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)', cfg);
    expect(a.verdict.verdict).toBe('partiel');
    expect(a.display.title).toBe('❔ Partiel · 28,85 €/h recette avant frais');
    expect(a.display.body).toContain('1,25 €/km avant frais');
    expect(a.display.speech).toBe("Partiel. 29 euros de l'heure avant frais.");
  });
});
