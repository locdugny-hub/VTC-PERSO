// Corrections, import du journal du raccourci, sauvegarde/restauration, synchronisation.
import { describe, expect, it } from 'vitest';
import { analyzeText } from '../src/core/analyze';
import { demoConfig, buildFastConfig, validateFastConfig } from '../src/core/config';
import { applyCorrection, importJournal, offerFromAnalysis, setStatus, percentile } from '../src/core/history';
import { emptyDataset, makeBackup, parseBackup, verifyRestore, offersCsv } from '../src/core/backup';
import { syncOnce, newer } from '../src/core/sync';
import type { LocalAdapter, OutboxItem, RemoteAdapter, RemoteRow } from '../src/core/sync';
import type { StoreName, SyncMeta } from '../src/core/domain';

const TXT = `UberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)`;

describe('Configuration versionnée', () => {
  it('empreinte stable et intégrité vérifiée', () => {
    const c = demoConfig();
    expect(validateFastConfig(c).ok).toBe(true);
    const tampered = { ...c, freshnessSec: 30 };
    const r = validateFastConfig(tampered);
    expect(r.ok).toBe(false);
  });
  it('changer les réglages change l’identifiant mais pas les analyses anciennes', () => {
    const c1 = demoConfig();
    const a1 = analyzeText(TXT, c1);
    const c2 = buildFastConfig({ ...c1, cost: { ...c1.cost, version: 2, variablePerKm: 0.3 } });
    expect(c2.configId).not.toBe(c1.configId);
    const before = JSON.stringify(a1);
    analyzeText(TXT, c2);
    expect(JSON.stringify(a1)).toBe(before);
    expect(a1.configId).toBe(c1.configId);
    expect(a1.input.variablePerKm).toBe(0.2);
  });
});

describe('Corrections après coup', () => {
  it('l’original est conservé ; recalcul avec les mêmes hypothèses ; provenance manuelle', () => {
    const a = analyzeText(`UberX\n12,50 €\nÀ 6 min (2,0 km)`, demoConfig()); // trajet masqué
    let o = offerFromAnalysis(a);
    o = applyCorrection(o, 'tripKm', 8);
    o = applyCorrection(o, 'tripMin', 20);
    expect(o.original.finance.D).toBeNull();
    expect(o.corrected!.finance.D).toBe(10);
    expect(Math.round(o.corrected!.finance.margin! * 100) / 100).toBe(8.33);
    expect(o.corrected!.offer.tripKm.provenance).toBe('manual');
    expect(o.corrections).toHaveLength(2);
    expect(o.corrected!.thresholdValues).toEqual(o.original.thresholdValues);
  });
});

describe('Journal du raccourci -> historique', () => {
  it('import idempotent, mesures de temps rattachées, lignes invalides signalées', () => {
    const a1 = analyzeText(TXT, demoConfig(), { id: 'req-1' });
    const a2 = analyzeText(TXT, demoConfig(), { id: 'req-2' });
    const jsonl = [
      JSON.stringify({ kind: 'analysis', analysis: a1 }),
      JSON.stringify({ kind: 'timing', id: 'req-1', scriptStartMs: 310, scriptEndMs: 340 }),
      JSON.stringify({ kind: 'analysis', analysis: a2 }),
      JSON.stringify({ kind: 'timing', id: 'req-1', afterNotifyMs: 520 }),
      'pas du json',
    ].join('\n');
    const r = importJournal(jsonl, new Map());
    expect(r.upserts).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.upserts.find((o) => o.id === 'req-1')!.timing).toEqual({ scriptStartMs: 310, scriptEndMs: 340, afterNotifyMs: 520 });
    const again = importJournal(jsonl, new Map(r.upserts.map((o) => [o.id, o])));
    expect(again.upserts.filter((o) => !o.timing)).toHaveLength(0); // pas de nouvelle offre
    expect(again.skipped).toBe(2);
  });
  it('percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('Sauvegarde et restauration', () => {
  it('export/import : mêmes données, relations et totaux', () => {
    const d = emptyDataset();
    let o = setStatus(offerFromAnalysis(analyzeText(TXT, demoConfig(), { id: 'o1' })), 'acceptee').offer;
    const r = setStatus(o, 'realisee', { confirmedRevenue: 12.5 });
    o = { ...r.offer, sessionId: 's1' };
    d.offers.push(o);
    d.trips.push(r.trip!);
    d.sessions.push({ id: 's1', updatedAt: '2026-10-08T10:00:00Z', startedAt: '2026-10-08T08:00:00Z', endedAt: null, pauses: [], vehicleId: null, odoStart: null, odoEnd: null, platformFocus: 'uber' });
    d.expenses.push({ id: 'e1', updatedAt: '2026-10-08T10:00:00Z', date: '2026-10-08T10:00:00Z', category: 'peage', amount: 3.4, currency: 'EUR', vehicleId: null, note: 'A1; "test"', source: 'manual' });
    const b = makeBackup(d);
    const text = JSON.stringify(b);
    const p = parseBackup(text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.backup.data).toEqual(d);
    expect(verifyRestore(b.summary, p.backup.data)).toEqual([]);
    expect(b.summary.totals).toEqual({ tripRevenue: 12.5, expenses: 3.4, offerPrices: 12.5 });
    expect(b.summary.relations).toEqual({ tripsWithOffer: 1, offersWithTrip: 1, offersWithSession: 1 });
    // fichier altéré refusé
    const bad = JSON.parse(text);
    bad.data.trips[0].revenue = 99;
    expect(parseBackup(JSON.stringify(bad)).ok).toBe(false);
    expect(offersCsv(d)).toMatch(/^﻿id;capture;plateforme/);
  });
});

// ---------- Synchronisation avec faux local / faux serveur ----------
type Rec = SyncMeta & Record<string, unknown>;
class FakeLocal implements LocalAdapter {
  data = new Map<string, Rec>();
  box: OutboxItem[] = [];
  cursor = 0;
  async get(s: StoreName, id: string) {
    return this.data.get(s + '/' + id);
  }
  async put(s: StoreName, r: Rec) {
    this.data.set(s + '/' + r.id, r);
  }
  write(s: StoreName, r: Rec) {
    this.data.set(s + '/' + r.id, r);
    this.box = this.box.filter((b) => !(b.store === s && b.id === r.id));
    this.box.push({ store: s, id: r.id, updatedAt: r.updatedAt });
  }
  async outbox() {
    return [...this.box];
  }
  async removeOutbox(it: OutboxItem) {
    this.box = this.box.filter((b) => !(b.store === it.store && b.id === it.id));
  }
  async getCursor() {
    return this.cursor;
  }
  async setCursor(n: number) {
    this.cursor = n;
  }
}
class FakeServer implements RemoteAdapter {
  rows = new Map<string, RemoteRow>();
  seq = 0;
  failPushAfter = Infinity; // simule une coupure après N lignes appliquées
  failPull = false;
  async push(rows: { store: StoreName; record: Rec }[]) {
    const acks: { store: StoreName; id: string; updatedAt: string }[] = [];
    let n = 0;
    for (const r of rows) {
      if (n >= this.failPushAfter) throw new Error('Réseau coupé');
      const k = r.store + '/' + r.record.id;
      const cur = this.rows.get(k);
      if (!cur || newer(r.record, cur.record)) this.rows.set(k, { store: r.store, record: r.record, serverSeq: ++this.seq });
      acks.push({ store: r.store, id: r.record.id, updatedAt: r.record.updatedAt });
      n++;
    }
    return acks;
  }
  async pull(after: number, limit: number) {
    if (this.failPull) throw new Error('Réseau coupé');
    return [...this.rows.values()].filter((r) => r.serverSeq > after).sort((a, b) => a.serverSeq - b.serverSeq).slice(0, limit);
  }
}

describe('Synchronisation', () => {
  it('coupure pendant l’envoi : aucune perte, aucun doublon après reprise', async () => {
    const L = new FakeLocal();
    const S = new FakeServer();
    for (let i = 0; i < 5; i++) L.write('expenses', { id: 'e' + i, updatedAt: `2026-10-08T10:00:0${i}Z`, amount: i });
    S.failPushAfter = 2;
    const r1 = await syncOnce(L, S, 10);
    expect(r1.error).toMatch(/coupé/);
    expect(L.box).toHaveLength(5); // rien retiré sans accusé de réception
    S.failPushAfter = Infinity;
    const r2 = await syncOnce(L, S, 10);
    expect(r2.error).toBeNull();
    expect(L.box).toHaveLength(0);
    expect(S.rows.size).toBe(5); // pas de doublon (identifiants stables)
  });

  it('modification locale pendant l’envoi : reste en attente', async () => {
    const L = new FakeLocal();
    const S = new FakeServer();
    L.write('trips', { id: 't1', updatedAt: '2026-10-08T10:00:00Z', revenue: 10 });
    const orig = S.push.bind(S);
    S.push = async (rows) => {
      const acks = await orig(rows);
      L.write('trips', { id: 't1', updatedAt: '2026-10-08T10:00:05Z', revenue: 11 }); // édition concurrente
      return acks;
    };
    await syncOnce(L, S);
    expect(L.box).toHaveLength(1);
    S.push = orig;
    await syncOnce(L, S);
    expect((S.rows.get('trips/t1')!.record as Rec).revenue).toBe(11);
  });

  it('conflit : le plus récent gagne des deux côtés ; suppression propagée', async () => {
    const A = new FakeLocal();
    const B = new FakeLocal();
    const S = new FakeServer();
    A.write('expenses', { id: 'x', updatedAt: '2026-10-08T10:00:00Z', amount: 1 });
    await syncOnce(A, S);
    await syncOnce(B, S);
    expect(B.data.get('expenses/x')!.amount).toBe(1);
    A.write('expenses', { id: 'x', updatedAt: '2026-10-08T10:00:10Z', amount: 2 });
    B.write('expenses', { id: 'x', updatedAt: '2026-10-08T10:00:20Z', amount: 3, deleted: true });
    await syncOnce(A, S);
    await syncOnce(B, S);
    await syncOnce(A, S);
    expect(A.data.get('expenses/x')!.deleted).toBe(true);
    expect(B.data.get('expenses/x')!.deleted).toBe(true);
  });

  it('coupure pendant le tirage : le curseur n’avance pas', async () => {
    const A = new FakeLocal();
    const S = new FakeServer();
    await S.push([{ store: 'expenses', record: { id: 'y', updatedAt: '2026-10-08T10:00:00Z' } }]);
    S.failPull = true;
    const r = await syncOnce(A, S);
    expect(r.error).not.toBeNull();
    expect(A.cursor).toBe(0);
    S.failPull = false;
    await syncOnce(A, S);
    expect(A.data.has('expenses/y')).toBe(true);
  });
});

describe('Import du journal : validation (revue)', () => {
  it('une analyse contenant du HTML dans un champ numérique est refusée', () => {
    const a = analyzeText(TXT, demoConfig(), { id: 'ok-1' });
    const evil = JSON.parse(JSON.stringify(analyzeText(TXT, demoConfig(), { id: 'bad-1' })));
    evil.input.scenario.waitMin = '<script>x</script>';
    const r = importJournal([JSON.stringify({ kind: 'analysis', analysis: a }), JSON.stringify({ kind: 'analysis', analysis: evil }), JSON.stringify({ kind: 'error', id: 'z', message: 'x' })].join('\n'), new Map());
    expect(r.upserts.map((o) => o.id)).toEqual(['ok-1']);
    expect(r.errors).toHaveLength(1);
  });
});
