// Stockage local IndexedDB. Une base par "portée" : "local" (sans compte), "u-<id>" (compte),
// "demo" (données fictives). Les données de deux comptes ne se mélangent jamais.
import { STORES } from '../core/domain';
import type { StoreName, StoreTypes, SyncMeta } from '../core/domain';
import type { LocalAdapter, OutboxItem } from '../core/sync';

const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('Transaction annulée'));
  });
}

export class LocalDB implements LocalAdapter {
  private constructor(public readonly scope: string, private db: IDBDatabase) {}

  static async open(scope: string, idb: IDBFactory = indexedDB): Promise<LocalDB> {
    const r = idb.open(`vtcperso-${scope}`, DB_VERSION);
    r.onupgradeneeded = (ev) => {
      const db = r.result;
      const old = (ev as IDBVersionChangeEvent).oldVersion;
      // Migrations successives : ne jamais supprimer de données existantes.
      if (old < 1) {
        for (const s of STORES) db.createObjectStore(s, { keyPath: 'id' });
        db.createObjectStore('outbox', { keyPath: ['store', 'id'] });
        db.createObjectStore('meta', { keyPath: 'k' });
      }
    };
    const db = await req(r);
    return new LocalDB(scope, db);
  }

  close() {
    this.db.close();
  }

  async all<K extends StoreName>(store: K, includeDeleted = false): Promise<StoreTypes[K][]> {
    const tx = this.db.transaction(store, 'readonly');
    const rows = (await req(tx.objectStore(store).getAll())) as StoreTypes[K][];
    return includeDeleted ? rows : rows.filter((r) => !(r as SyncMeta).deleted);
  }

  async get(store: StoreName, id: string): Promise<(SyncMeta & Record<string, unknown>) | undefined> {
    const tx = this.db.transaction(store, 'readonly');
    return (await req(tx.objectStore(store).get(id))) as (SyncMeta & Record<string, unknown>) | undefined;
  }

  /** Écriture locale : horodate et met en file d'attente de synchronisation, dans la même transaction. */
  async save<K extends StoreName>(store: K, rec: StoreTypes[K], opts: { keepTimestamp?: boolean } = {}): Promise<StoreTypes[K]> {
    const r = { ...rec, updatedAt: opts.keepTimestamp ? rec.updatedAt : new Date().toISOString() } as StoreTypes[K];
    const tx = this.db.transaction([store, 'outbox'], 'readwrite');
    tx.objectStore(store).put(r);
    tx.objectStore('outbox').put({ store, id: r.id, updatedAt: r.updatedAt });
    await done(tx);
    return r;
  }

  async saveMany<K extends StoreName>(store: K, recs: StoreTypes[K][], opts: { keepTimestamp?: boolean } = {}): Promise<void> {
    const tx = this.db.transaction([store, 'outbox'], 'readwrite');
    for (const rec of recs) {
      const r = { ...rec, updatedAt: opts.keepTimestamp ? rec.updatedAt : new Date().toISOString() };
      tx.objectStore(store).put(r);
      tx.objectStore('outbox').put({ store, id: r.id, updatedAt: r.updatedAt });
    }
    await done(tx);
  }

  /** Suppression = pierre tombale synchronisée. */
  async remove(store: StoreName, id: string): Promise<void> {
    const cur = await this.get(store, id);
    if (!cur) return;
    await this.save(store, { ...cur, deleted: true } as never);
  }

  /** Application d'une donnée venant du serveur : pas de mise en file d'attente. */
  async put(store: StoreName, rec: SyncMeta & Record<string, unknown>): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(rec);
    await done(tx);
  }

  async outbox(): Promise<OutboxItem[]> {
    const tx = this.db.transaction('outbox', 'readonly');
    return (await req(tx.objectStore('outbox').getAll())) as OutboxItem[];
  }
  async removeOutbox(item: OutboxItem): Promise<void> {
    const tx = this.db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').delete([item.store, item.id]);
    await done(tx);
  }
  async meta<T>(k: string): Promise<T | undefined> {
    const tx = this.db.transaction('meta', 'readonly');
    const r = (await req(tx.objectStore('meta').get(k))) as { k: string; v: T } | undefined;
    return r?.v;
  }
  async setMeta<T>(k: string, v: T): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ k, v });
    await done(tx);
  }
  async getCursor(): Promise<number> {
    return (await this.meta<number>('pullCursor')) ?? 0;
  }
  async setCursor(n: number): Promise<void> {
    await this.setMeta('pullCursor', n);
  }

  async dataset(includeDeleted = true) {
    const out: Record<string, unknown[]> = {};
    for (const s of STORES) out[s] = await this.all(s, includeDeleted);
    return out as { [K in StoreName]: StoreTypes[K][] };
  }

  async clearAll(): Promise<void> {
    const tx = this.db.transaction([...STORES, 'outbox', 'meta'], 'readwrite');
    for (const s of [...STORES, 'outbox', 'meta']) tx.objectStore(s).clear();
    await done(tx);
  }
}

/**
 * Migration des données locales vers le compte : copie idempotente (mêmes identifiants),
 * toutes les lignes sont mises en file d'attente. La base locale n'est pas effacée.
 */
export async function migrateScope(from: LocalDB, to: LocalDB): Promise<{ copied: number; skippedNewer: number }> {
  let copied = 0;
  let skippedNewer = 0;
  for (const s of STORES) {
    const rows = await from.all(s, true);
    const keep: StoreTypes[typeof s][] = [];
    for (const r of rows) {
      const cur = await to.get(s, r.id);
      if (cur && cur.updatedAt >= r.updatedAt) {
        skippedNewer++;
        continue;
      }
      keep.push(r);
    }
    await to.saveMany(s, keep as never[], { keepTimestamp: true });
    copied += keep.length;
  }
  await from.setMeta('migratedTo', { scope: to.scope, at: new Date().toISOString() });
  return { copied, skippedNewer };
}
