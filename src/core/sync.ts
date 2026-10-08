// Synchronisation locale <-> Supabase, indépendante du transport (testable avec des faux).
// Règles :
//  - dernier écrivain gagnant par enregistrement (updatedAt client), départage déterministe ;
//  - suppression = pierre tombale (deleted=true) synchronisée, jamais d'effacement silencieux ;
//  - la file d'attente (outbox) n'est vidée qu'après accusé de réception de LA version envoyée ;
//  - le curseur de tirage n'avance qu'après application locale complète du lot ;
//  - les identifiants sont stables : un renvoi après coupure est idempotent (pas de doublon).
import type { StoreName, SyncMeta } from './domain';

export interface OutboxItem {
  store: StoreName;
  id: string;
  updatedAt: string;
}

export interface RemoteRow {
  store: StoreName;
  record: SyncMeta & Record<string, unknown>;
  serverSeq: number;
}

export interface LocalAdapter {
  get(store: StoreName, id: string): Promise<(SyncMeta & Record<string, unknown>) | undefined>;
  put(store: StoreName, rec: SyncMeta & Record<string, unknown>): Promise<void>;
  outbox(): Promise<OutboxItem[]>;
  removeOutbox(item: OutboxItem): Promise<void>;
  getCursor(): Promise<number>;
  setCursor(n: number): Promise<void>;
}

export interface RemoteAdapter {
  /** Applique les enregistrements (LWW côté serveur) et renvoie les identifiants acceptés ou déjà plus récents. */
  push(rows: { store: StoreName; record: SyncMeta & Record<string, unknown> }[]): Promise<{ store: StoreName; id: string; updatedAt: string }[]>;
  pull(afterSeq: number, limit: number): Promise<RemoteRow[]>;
}

/** Vrai si a doit remplacer b. */
export function newer(a: SyncMeta, b: SyncMeta | undefined): boolean {
  if (!b) return true;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  // Départage déterministe à horodatage égal : la pierre tombale gagne, puis l'ordre JSON.
  if (!!a.deleted !== !!b.deleted) return !!a.deleted;
  return JSON.stringify(a) > JSON.stringify(b);
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  appliedRemote: number;
  keptLocal: number;
  error: string | null;
}

export async function syncOnce(local: LocalAdapter, remote: RemoteAdapter, batch = 200): Promise<SyncReport> {
  const rep: SyncReport = { pushed: 0, pulled: 0, appliedRemote: 0, keptLocal: 0, error: null };
  try {
    // 1) Envoi
    const items = await local.outbox();
    for (let i = 0; i < items.length; i += batch) {
      const chunk = items.slice(i, i + batch);
      const rows: { store: StoreName; record: SyncMeta & Record<string, unknown> }[] = [];
      for (const it of chunk) {
        const rec = await local.get(it.store, it.id);
        if (rec) rows.push({ store: it.store, record: rec });
      }
      const acks = await remote.push(rows); // une exception laisse l'outbox intacte
      const ackSet = new Set(acks.map((a) => `${a.store}/${a.id}/${a.updatedAt}`));
      for (const it of chunk) {
        const rec = await local.get(it.store, it.id);
        // Retiré seulement si la version accusée est toujours la version locale actuelle.
        if (rec && ackSet.has(`${it.store}/${it.id}/${rec.updatedAt}`)) {
          await local.removeOutbox(it);
          rep.pushed++;
        } else if (!rec) await local.removeOutbox(it);
      }
    }
    // 2) Tirage
    let cursor = await local.getCursor();
    for (;;) {
      const rows = await remote.pull(cursor, batch);
      if (!rows.length) break;
      let maxSeq = cursor;
      for (const r of rows) {
        rep.pulled++;
        const cur = await local.get(r.store, r.record.id);
        // À horodatage égal (et même état de suppression), la copie du serveur fait foi : les deux côtés convergent.
        const tie = !!cur && cur.updatedAt === r.record.updatedAt && !!cur.deleted === !!r.record.deleted;
        if (tie || newer(r.record, cur)) {
          await local.put(r.store, r.record);
          rep.appliedRemote++;
        } else rep.keptLocal++;
        maxSeq = Math.max(maxSeq, r.serverSeq);
      }
      await local.setCursor(maxSeq); // après application complète du lot
      cursor = maxSeq;
      if (rows.length < batch) break;
    }
  } catch (e) {
    rep.error = e instanceof Error ? e.message : String(e);
  }
  return rep;
}
