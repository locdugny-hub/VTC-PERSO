// Données de démonstration FICTIVES, dans un espace séparé ("demo").
import { analyzeText, newId } from '../core/analyze';
import { buildFastConfig } from '../core/config';
import { offerFromAnalysis, setStatus } from '../core/history';
import type { LocalDB } from './db';
import type { SessionRec, ExpenseRec, TripRec } from '../core/domain';
import { defaultSettings } from '../core/domain';

export async function seedDemo(db: LocalDB) {
  if ((await db.all('offers')).length) return;
  const now = Date.now();
  const costId = 'demo-cost', thId = 'demo-th';
  await db.save('costProfiles', { id: costId, updatedAt: '', vehicleId: 'demo-v', version: 1, effectiveFrom: new Date(now - 30 * 864e5).toISOString(), variablePerKm: 0.2, fixedPerHour: 5, otherPerOffer: 0 });
  await db.save('thresholds', { id: thId, updatedAt: '', version: 1, effectiveFrom: new Date(now - 30 * 864e5).toISOString(), level: 'margin', perKm: 0.8, perHour: 18 });
  await db.save('vehicles', { id: 'demo-v', updatedAt: '', name: 'Véhicule FICTIF', energy: 'hybride', consumptionPer100: 5, energyUnitPrice: 1.8, maintenancePerKm: 0.11, fixedMonthly: 800, plannedHoursMonthly: 160 });
  await db.save('settings', {
    ...defaultSettings(),
    activeVehicleId: 'demo-v',
    activeCostProfileId: costId,
    activeThresholdId: thId,
    platforms: { uber: { priceBasis: 'net_driver', commissionRate: null, confirmed: true }, bolt: { priceBasis: 'net_driver', commissionRate: null, confirmed: true } },
    onboardingDone: true,
  });
  const cfg = buildFastConfig({
    cost: { id: costId, version: 1, effectiveFrom: '', variablePerKm: 0.2, fixedPerHour: 5, otherPerOffer: 0 },
    thresholds: { id: thId, version: 1, effectiveFrom: '', level: 'margin', perKm: 0.8, perHour: 18 },
    platforms: { uber: { priceBasis: 'net_driver', commissionRate: null }, bolt: { priceBasis: 'net_driver', commissionRate: null } },
    sessionPlatform: null,
    scenario: { returnKm: null, returnMin: null, waitMin: null },
    freshnessSec: 10,
    voice: true,
    syncMode: 'off',
    apiBase: null,
  });
  const samples = [
    'UberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)',
    'Bolt\n24,30 €\nPrise en charge · 3 min · 1,1 km\nDestination · 25 min · 15,2 km',
    'UberX\n8,20 €\nÀ 12 min (5,5 km)\nTrajet de 14 min (4,0 km)',
    'Bolt\n31,00 €\nPrise en charge · 5 min · 2,0 km\nDestination · 35 min · 22,0 km',
    'UberX\n15,00 €\nÀ 4 min (1,5 km)',
  ];
  for (let day = 0; day < 6; day++) {
    const start = now - day * 864e5 - 8 * 36e5;
    const s: SessionRec = { id: newId(), updatedAt: '', startedAt: new Date(start).toISOString(), endedAt: new Date(start + 5 * 36e5).toISOString(), pauses: [{ start: new Date(start + 2 * 36e5).toISOString(), end: new Date(start + 2.5 * 36e5).toISOString() }], vehicleId: 'demo-v', odoStart: 10000 + day * 150, odoEnd: 10120 + day * 150, platformFocus: null };
    await db.save('sessions', s);
    for (let i = 0; i < samples.length; i++) {
      const t = new Date(start + (i + 0.5) * 36e5 * 0.9).toISOString();
      const a = analyzeText(samples[i], cfg, { capturedAt: t, now: () => new Date(t), source: 'demo' });
      let o = offerFromAnalysis(a, s.id);
      let trip: TripRec | null = null;
      if (i % 2 === 0) {
        o = setStatus(o, 'acceptee', { at: t }).offer;
        let r = setStatus(o, 'realisee', { confirmedRevenue: a.finance.P ?? 10, at: t });
        if (i === 0) r = setStatus(r.offer, 'encaissee', { trip: r.trip, at: t });
        o = r.offer;
        trip = r.trip;
      } else o = setStatus(o, 'refusee', { at: t }).offer;
      await db.save('offers', o, { keepTimestamp: true });
      if (trip) await db.save('trips', { ...trip, note: 'FICTIF' });
    }
    const e: ExpenseRec = { id: newId(), updatedAt: '', date: new Date(start + 36e5).toISOString(), category: day % 2 ? 'peage' : 'carburant', amount: day % 2 ? 4.6 : 38.5, currency: 'EUR', vehicleId: 'demo-v', note: 'FICTIF', source: 'manual' };
    await db.save('expenses', e);
  }
}
