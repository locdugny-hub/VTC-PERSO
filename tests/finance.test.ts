// Tests financiers obligatoires du cahier des charges (§14) et cas de contrôle du dossier d'analyse.
import { describe, expect, it } from 'vitest';
import { computeFinance, driverRevenue } from '../src/core/finance';
import { computeVerdict } from '../src/core/verdict';
import { summarize } from '../src/core/aggregate';
import { setStatus, offerFromAnalysis } from '../src/core/history';
import { analyzeText } from '../src/core/analyze';
import { demoConfig } from '../src/core/config';
import type { FinanceInput, ThresholdProfile } from '../src/core/types';
import type { SessionRec, TripRec } from '../src/core/domain';

const base: FinanceInput = {
  price: 12.5,
  priceBasis: 'net_driver',
  commissionRate: null,
  approachKm: 2,
  approachMin: 6,
  tripKm: 8,
  tripMin: 20,
  scenario: { returnKm: null, returnMin: null, waitMin: null },
  variablePerKm: null,
  fixedPerHour: null,
  otherCosts: null,
};
const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);

describe('Moteur financier — cas obligatoires', () => {
  it('12,50 € ; 2 km/6 min + 8 km/20 min => 10 km, 26 min, 1,25 €/km, 28,85 €/h avant frais', () => {
    const f = computeFinance(base);
    expect(f.D).toBe(10);
    expect(f.T).toBe(26);
    expect(r2(f.revenuePerKm)).toBe(1.25);
    expect(r2(f.revenuePerHour)).toBe(28.85);
    expect(f.margin).toBeNull(); // coûts non renseignés : pas de marge inventée
    expect(f.missing).toContain('coût variable v');
  });

  it('v = 0,20 €/km, f = 5 €/h, E = 0 confirmé => marge 8,33 € et 19,23 €/h', () => {
    const f = computeFinance({ ...base, variablePerKm: 0.2, fixedPerHour: 5, otherCosts: 0 });
    expect(r2(f.margin)).toBe(8.33);
    expect(r2(f.marginPerHour)).toBe(19.23);
    expect(f.marginExcludesOther).toBe(false);
  });

  it('Retour simulé 10 km/25 min => marge 4,25 € et 5,00 €/h', () => {
    const f = computeFinance({ ...base, variablePerKm: 0.2, fixedPerHour: 5, otherCosts: 0, scenario: { returnKm: 10, returnMin: 25, waitMin: null } });
    expect(f.D).toBe(20);
    expect(f.T).toBe(51);
    expect(r2(f.margin)).toBe(4.25);
    expect(r2(f.marginPerHour)).toBe(5.0);
    expect(r2(f.revenuePerKm)).toBe(0.63);
    expect(r2(f.revenuePerHour)).toBe(14.71);
  });

  it('20 € avant commission 25 % => 15 € ; 15 € déjà net reste 15 €', () => {
    expect(driverRevenue(20, 'gross_before_commission', 0.25).P).toBe(15);
    expect(driverRevenue(15, 'net_driver', 0.25).P).toBe(15);
    // Taux non confirmé : aucune commission inventée, montant affiché = borne haute (jamais favorable)
    const u = driverRevenue(20, 'gross_before_commission', null);
    expect(u.P).toBe(20);
    expect(u.upperBound).toBe(true);
  });

  it('Durée absente : aucun taux horaire inventé, €/km reste disponible, verdict non favorable', () => {
    const f = computeFinance({ ...base, tripMin: null });
    expect(f.T).toBeNull();
    expect(f.revenuePerHour).toBeNull();
    expect(r2(f.revenuePerKm)).toBe(1.25);
    const th: ThresholdProfile = { id: 't', version: 1, effectiveFrom: '', level: 'revenue', perKm: 1, perHour: 20 };
    expect(computeVerdict(f, th).verdict).toBe('partiel');
  });

  it('D = 0 ou T = 0 : aucune division par zéro', () => {
    const f = computeFinance({ ...base, approachKm: 0, tripKm: 0, approachMin: 0, tripMin: 0, variablePerKm: 0.2, fixedPerHour: 5, otherCosts: 0 });
    expect(f.revenuePerKm).toBeNull();
    expect(f.revenuePerHour).toBeNull();
    expect(f.marginPerKm).toBeNull();
    expect(f.marginPerHour).toBeNull();
  });

  it('Coûts non renseignés ≠ coûts nuls', () => {
    const unknown = computeFinance(base);
    const zero = computeFinance({ ...base, variablePerKm: 0, fixedPerHour: 0, otherCosts: 0 });
    expect(unknown.margin).toBeNull();
    expect(zero.margin).toBe(12.5);
  });

  it('Approche longue : 10 € ; 8 km/20 min + 2 km/5 min => 1 €/km et 24 €/h', () => {
    const f = computeFinance({ ...base, price: 10, approachKm: 8, approachMin: 20, tripKm: 2, tripMin: 5 });
    expect(f.revenuePerKm).toBe(1);
    expect(f.revenuePerHour).toBe(24);
  });

  it('Véhicule électrique 18 kWh/100 km à 0,25 €/kWh => 0,045 €/km d’énergie', async () => {
    const { deriveCosts } = await import('../src/core/domain');
    const c = deriveCosts({ id: 'v', updatedAt: '', name: 'EV', energy: 'electrique', consumptionPer100: 18, energyUnitPrice: 0.25, maintenancePerKm: 0.03, fixedMonthly: 900, plannedHoursMonthly: 180 });
    expect(c.energyPerKm).toBeCloseTo(0.045, 10);
    expect(c.variablePerKm).toBeCloseTo(0.075, 10);
    expect(c.fixedPerHour).toBe(5);
  });
});

describe('Verdict', () => {
  const th: ThresholdProfile = { id: 't', version: 1, effectiveFrom: '', level: 'margin', perKm: 0.8, perHour: 18 };
  const full = { ...base, variablePerKm: 0.2, fixedPerHour: 5, otherCosts: 0 };
  it('Favorable si les deux seuils sont atteints', () => {
    expect(computeVerdict(computeFinance(full), th).verdict).toBe('favorable'); // 0,83 €/km, 19,23 €/h
  });
  it('Limite si chaque ratio >= 80 % et un au moins inférieur', () => {
    expect(computeVerdict(computeFinance(full), { ...th, perHour: 22 }).verdict).toBe('limite'); // 19,23/22 = 87 %
  });
  it('Faible sinon', () => {
    expect(computeVerdict(computeFinance(full), { ...th, perHour: 30 }).verdict).toBe('faible'); // 64 %
  });
  it('Base inconnue : jamais favorable', () => {
    const f = computeFinance({ ...full, priceBasis: 'unknown' });
    expect(f.pIsUpperBound).toBe(true);
    expect(computeVerdict(f, th).verdict).toBe('partiel');
  });
  it('Base inconnue mais borne haute déjà < 80 % => faible (certain)', () => {
    const f = computeFinance({ ...full, priceBasis: 'unknown', price: 5 });
    expect(computeVerdict(f, th).verdict).toBe('faible');
  });
  it('E non renseigné au niveau marge : partiel, pas favorable', () => {
    const f = computeFinance({ ...full, otherCosts: null });
    expect(computeVerdict(f, th).verdict).toBe('partiel');
  });
  it('Prix inconnu : analyse indisponible', () => {
    expect(computeVerdict(computeFinance({ ...full, price: null }), th).verdict).toBe('indisponible');
  });
  it('Seuils non positifs refusés', () => {
    expect(computeVerdict(computeFinance(full), { ...th, perKm: 0 }).verdict).toBe('indisponible');
  });
});

describe('Historique et bilans', () => {
  it('Offre refusée ou annulée : aucune recette automatique', () => {
    const a = analyzeText('UberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)', demoConfig());
    let o = offerFromAnalysis(a);
    o = setStatus(o, 'refusee').offer;
    const s1 = summarize('day', { trips: [], expenses: [], sessions: [], offers: [o] });
    expect(s1[0].revenueRealized).toBe(0);
    let o2 = offerFromAnalysis({ ...a, id: 'x2' });
    o2 = setStatus(o2, 'acceptee').offer;
    const r = setStatus(o2, 'annulee');
    expect(r.trip).toBeNull();
    const s2 = summarize('day', { trips: [], expenses: [], sessions: [], offers: [r.offer] });
    expect(s2[0].revenueRealized).toBe(0);
    expect(() => setStatus(setStatus(offerFromAnalysis({ ...a, id: 'x3' }), 'acceptee').offer, 'realisee')).toThrow(/Montant/);
  });

  it('Course réalisée puis annulée : la recette ne compte plus', () => {
    const a = analyzeText('UberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)', demoConfig());
    let o = setStatus(offerFromAnalysis(a), 'acceptee').offer;
    const r1 = setStatus(o, 'realisee', { confirmedRevenue: 12.5 });
    o = r1.offer;
    const r2b = setStatus(o, 'annulee', { trip: r1.trip });
    const s = summarize('day', { trips: [r2b.trip!], expenses: [], sessions: [], offers: [r2b.offer] });
    expect(s[0].revenueRealized).toBe(0);
  });

  it('Marge 20 € en 1 h et 30 € en 4 h => 10 €/h global (pas de moyenne de ratios)', () => {
    const day = '2026-10-05';
    const sessions: SessionRec[] = [
      { id: 's1', updatedAt: '', startedAt: `${day}T06:00:00Z`, endedAt: `${day}T07:00:00Z`, pauses: [], vehicleId: null, odoStart: null, odoEnd: null, platformFocus: null },
      { id: 's2', updatedAt: '', startedAt: `${day}T09:00:00Z`, endedAt: `${day}T13:00:00Z`, pauses: [], vehicleId: null, odoStart: null, odoEnd: null, platformFocus: null },
    ];
    const trips: TripRec[] = [
      { id: 't1', updatedAt: '', offerId: null, sessionId: 's1', date: `${day}T06:30:00Z`, platform: 'uber', revenue: 20, km: null, minutes: null, status: 'realisee', paidAt: null, note: '' },
      { id: 't2', updatedAt: '', offerId: null, sessionId: 's2', date: `${day}T10:00:00Z`, platform: 'bolt', revenue: 30, km: null, minutes: null, status: 'encaissee', paidAt: null, note: '' },
    ];
    const [s] = summarize('day', { trips, expenses: [], sessions, offers: [] });
    expect(s.result).toBe(50);
    expect(s.activityMinutes).toBe(300);
    expect(s.resultPerHour).toBe(10);
    expect(s.revenueCashed).toBe(30);
  });

  it('Dépenses de période déduites une seule fois, pauses exclues du temps', () => {
    const sessions: SessionRec[] = [
      { id: 's1', updatedAt: '', startedAt: '2026-10-05T06:00:00Z', endedAt: '2026-10-05T10:00:00Z', pauses: [{ start: '2026-10-05T08:00:00Z', end: '2026-10-05T09:00:00Z' }], vehicleId: null, odoStart: 1000, odoEnd: 1100, platformFocus: null },
    ];
    const trips: TripRec[] = [{ id: 't', updatedAt: '', offerId: null, sessionId: 's1', date: '2026-10-05T07:00:00Z', platform: 'uber', revenue: 90, km: 20, minutes: 30, status: 'realisee', paidAt: null, note: '' }];
    const [s] = summarize('day', {
      trips,
      sessions,
      offers: [],
      expenses: [{ id: 'e', updatedAt: '', date: '2026-10-05T12:00:00Z', category: 'carburant', amount: 30, currency: 'EUR', vehicleId: null, note: '', source: 'manual' }],
    });
    expect(s.activityMinutes).toBe(180);
    expect(s.result).toBe(60);
    expect(s.resultPerHour).toBe(20);
    expect(s.resultPerKm).toBe(0.6);
  });

  it('Solde après cotisations seulement avec base et taux fournis', () => {
    const trips: TripRec[] = [{ id: 't', updatedAt: '', offerId: null, sessionId: null, date: '2026-10-05T07:00:00Z', platform: 'uber', revenue: 100, km: null, minutes: null, status: 'realisee', paidAt: null, note: '' }];
    const [a] = summarize('month', { trips, sessions: [], offers: [], expenses: [] });
    expect(a.social).toBeNull();
    const [b] = summarize('month', { trips, sessions: [], offers: [], expenses: [] }, { social: { '2026-10': { base: 120, rate: 0.212 } } });
    expect(b.social!.contribution).toBeCloseTo(25.44, 10);
    expect(b.social!.balance).toBeCloseTo(74.56, 10);
  });
});
