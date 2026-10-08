// Couche d'accès aux API de Scriptable (fichiers, trousseau, presse-papiers, réseau, notifications).
// Isolée pour que la logique soit testable sous Node avec un runtime simulé.
import type { Analysis, FastConfig } from '../src/core';

const SYNC_BATCH = 100;
const SYNC_MAX_BATCHES = 5;

export interface Runtime {
  now(): number;
  uuid(): string;
  readJson(name: string): unknown;
  writeJson(name: string, v: unknown): void;
  appendJournal(line: unknown): void;
  /** Analyses du journal pas encore acceptées (ou refusées) par le serveur. */
  pendingCount(): number;
  copyJournal(): number;
  sync(cfg: FastConfig): Promise<string>;
  pasteboard(): string | null;
  setToken(t: string): void;
  hasToken(): boolean;
  notify(title: string, body: string): void;
  speak(text: string): void;
  alert(title: string, message: string): Promise<void>;
  menu(title: string, options: string[]): Promise<number>;
  complete(output: unknown): void;
}

/* Déclarations minimales des API Scriptable (https://docs.scriptable.app). */
declare const FileManager: {
  local(): {
    documentsDirectory(): string;
    joinPath(a: string, b: string): string;
    fileExists(p: string): boolean;
    readString(p: string): string;
    writeString(p: string, s: string): void;
    createDirectory(p: string, intermediate: boolean): void;
    listContents(p: string): string[];
  };
};
declare const Pasteboard: { paste(): string | null; copy(s: string): void };
declare const Keychain: { set(k: string, v: string): void; get(k: string): string; contains(k: string): boolean };
declare class Notification {
  title: string;
  body: string;
  schedule(): Promise<void>;
}
declare const Speech: { speak(t: string): void };
declare class Alert {
  title: string;
  message: string;
  addAction(t: string): void;
  addCancelAction(t: string): void;
  presentAlert(): Promise<number>;
  presentSheet(): Promise<number>;
}
declare class Request {
  constructor(url: string);
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutInterval: number;
  loadJSON(): Promise<unknown>;
  response: { statusCode: number };
}
declare const Script: { setShortcutOutput(v: unknown): void; complete(): void };
declare const UUID: { string(): string };

const TOKEN_KEY = 'vtcperso.deviceToken';

export function createRuntime(): Runtime {
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.documentsDirectory(), 'vtcperso');
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  const path = (n: string) => fm.joinPath(dir, n);
  const read = (n: string): string | null => (fm.fileExists(path(n)) ? fm.readString(path(n)) : null);
  const dayFile = () => 'journal-' + new Date().toISOString().slice(0, 10) + '.jsonl';
  /** File d'attente dérivée du journal (aucune écriture supplémentaire pendant le parcours rapide). */
  const unsynced = (): Analysis[] => {
    const done = new Set((rt.readJson('synced.json') as string[] | null) ?? []);
    const out: Analysis[] = [];
    for (const f of fm.listContents(dir).filter((x) => x.startsWith('journal-')).sort()) {
      for (const line of (read(f) ?? '').split('\n')) {
        if (!line.includes('"kind":"analysis"')) continue;
        try {
          const a = (JSON.parse(line) as { analysis: Analysis }).analysis;
          if (a && !done.has(a.id)) out.push(a);
        } catch {
          /* ligne corrompue ignorée */
        }
      }
    }
    return out;
  };

  const rt: Runtime = {
    now: () => Date.now(),
    uuid: () => UUID.string().toLowerCase(),
    readJson(n) {
      const s = read(n);
      if (!s) return null;
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    },
    writeJson(n, v) {
      fm.writeString(path(n), JSON.stringify(v));
    },
    appendJournal(line) {
      const f = dayFile();
      const prev = read(f) ?? '';
      fm.writeString(path(f), prev + JSON.stringify(line) + '\n');
    },
    pendingCount() {
      return unsynced().length;
    },
    copyJournal() {
      const files = fm.listContents(dir).filter((f) => f.startsWith('journal-')).sort();
      const all = files.map((f) => read(f) ?? '').join('');
      Pasteboard.copy(all);
      return all.split('\n').filter((l) => l.trim()).length;
    },
    async sync(cfg) {
      if (!cfg.apiBase) return 'Pas d\u2019adresse serveur configurée : utilisez l\u2019export du journal.';
      if (!Keychain.contains(TOKEN_KEY)) return 'Pas de jeton d\u2019appareil enregistré.';
      const pending = unsynced();
      if (!pending.length) return 'Rien à synchroniser.';
      const done = new Set((rt.readJson('synced.json') as string[] | null) ?? []);
      let sent = 0;
      for (let b = 0; b < SYNC_MAX_BATCHES && b * SYNC_BATCH < pending.length; b++) {
        const batch = pending.slice(b * SYNC_BATCH, (b + 1) * SYNC_BATCH);
        const r = new Request(cfg.apiBase.replace(/\/$/, '') + '/ingest');
        r.method = 'POST';
        r.timeoutInterval = 8;
        r.headers = { 'content-type': 'application/json', 'x-device-token': Keychain.get(TOKEN_KEY) };
        r.body = JSON.stringify({ analyses: batch });
        try {
          const res = (await r.loadJSON()) as { accepted?: string[]; rejected?: string[]; error?: string };
          if (r.response.statusCode !== 200 || !Array.isArray(res.accepted)) return `Échec : ${res.error ?? r.response.statusCode}. ${sent} envoyée(s), le reste est conservé.`;
          // Acceptées et refusées (forme invalide) sont marquées traitées : pas de renvoi sans fin.
          for (const id of [...res.accepted, ...(res.rejected ?? [])]) done.add(id);
          rt.writeJson('synced.json', [...done]);
          sent += res.accepted.length;
        } catch (e) {
          return `Réseau indisponible : ${sent} envoyée(s), le reste est conservé (${String(e).slice(0, 60)})`;
        }
      }
      return `${sent} analyse(s) synchronisée(s), ${unsynced().length} en attente.`;
    },
    pasteboard: () => Pasteboard.paste(),
    setToken: (t) => Keychain.set(TOKEN_KEY, t),
    hasToken: () => Keychain.contains(TOKEN_KEY),
    notify(title, body) {
      const n = new Notification();
      n.title = title;
      n.body = body;
      n.schedule();
    },
    speak: (t) => Speech.speak(t),
    async alert(title, message) {
      const a = new Alert();
      a.title = title;
      a.message = message;
      a.addAction('OK');
      await a.presentAlert();
    },
    async menu(title, options) {
      const a = new Alert();
      a.title = title;
      options.forEach((o) => a.addAction(o));
      a.addCancelAction('Fermer');
      return a.presentSheet();
    },
    complete(output) {
      if (output !== null && output !== undefined) Script.setShortcutOutput(output);
      Script.complete();
    },
  };
  return rt;
}
