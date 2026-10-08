// Stockage IndexedDB de la PWA (fake-indexeddb sous Node) : séparation des comptes, file d'attente, migration.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDB, migrateScope } from '../src/app/db';
import { syncOnce } from '../src/core/sync';
import type { ExpenseRec } from '../src/core/domain';

const exp = (id: string, amount: number): ExpenseRec => ({ id, updatedAt: '', date: '2026-10-08T10:00:00Z', category: 'peage', amount, currency: 'EUR', vehicleId: null, note: '', source: 'manual' });

describe('IndexedDB', () => {
  it('écriture + file d’attente dans la même transaction ; suppression = pierre tombale', async () => {
    const db = await LocalDB.open('t1');
    const saved = await db.save('expenses', exp('e1', 3));
    expect(saved.updatedAt).not.toBe('');
    expect(await db.outbox()).toEqual([{ store: 'expenses', id: 'e1', updatedAt: saved.updatedAt }]);
    await db.remove('expenses', 'e1');
    expect(await db.all('expenses')).toHaveLength(0);
    expect(await db.all('expenses', true)).toHaveLength(1);
    expect((await db.outbox())).toHaveLength(1); // une seule entrée par enregistrement
    db.close();
  });
  it('deux comptes : bases séparées sur le même appareil', async () => {
    const a = await LocalDB.open('u-A');
    const b = await LocalDB.open('u-B');
    await a.save('expenses', exp('x', 1));
    expect(await b.all('expenses')).toHaveLength(0);
    a.close();
    b.close();
  });
  it('migration locale -> compte sans perte ni doublon (idempotente)', async () => {
    const local = await LocalDB.open('local-m');
    const acct = await LocalDB.open('u-M');
    await local.save('expenses', exp('m1', 5));
    await local.save('expenses', exp('m2', 6));
    const r1 = await migrateScope(local, acct);
    const r2 = await migrateScope(local, acct);
    expect(r1.copied).toBe(2);
    expect(r2.copied).toBe(0);
    expect(await acct.all('expenses')).toHaveLength(2);
    expect(await acct.outbox()).toHaveLength(2);
    expect(await local.all('expenses')).toHaveLength(2); // l'original est conservé
    local.close();
    acct.close();
  });
  it('synchronisation réelle de la base locale avec un serveur simulé', async () => {
    const db = await LocalDB.open('u-S');
    await db.save('expenses', exp('s1', 7));
    const server = new Map<string, unknown>();
    let seq = 0;
    const rows: { store: 'expenses'; record: { id: string; updatedAt: string }; serverSeq: number }[] = [];
    const r = await syncOnce(db, {
      async push(rs) {
        for (const x of rs) { server.set(x.record.id, x.record); rows.push({ store: 'expenses', record: x.record, serverSeq: ++seq }); }
        return rs.map((x) => ({ store: x.store, id: x.record.id, updatedAt: x.record.updatedAt }));
      },
      async pull(after) { return rows.filter((x) => x.serverSeq > after) as never; },
    });
    expect(r.error).toBeNull();
    expect(await db.outbox()).toHaveLength(0);
    expect(await db.getCursor()).toBe(1);
    db.close();
  });
});
