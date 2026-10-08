// Simulateur des API Scriptable pour exécuter le fichier GÉNÉRÉ shortcut/dist/VTCPerso.js sous Node.
// Il reproduit le contrat d'appel du raccourci (paramètre -> sortie), pas le comportement d'iOS.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

export interface SimEnv {
  files: Map<string, string>;
  keychain: Map<string, string>;
  pasteboard: string | null;
  notifications: { title: string; body: string }[];
  spoken: string[];
  alerts: { title: string; message: string }[];
  menuChoice: number;
  requests: { url: string; headers: Record<string, string>; body: string }[];
  serverResponder: ((body: unknown) => { status: number; json: unknown }) | null;
  clock: () => number;
}

export function newEnv(): SimEnv {
  return {
    files: new Map(),
    keychain: new Map(),
    pasteboard: null,
    notifications: [],
    spoken: [],
    alerts: [],
    menuChoice: -1,
    requests: [],
    serverResponder: null,
    clock: () => Date.now(),
  };
}

const SCRIPT = () => readFileSync(new URL('../shortcut/dist/VTCPerso.js', import.meta.url), 'utf8');

export async function runScript(env: SimEnv, shortcutParameter: unknown, runsInApp = false): Promise<unknown> {
  let output: unknown = undefined;
  let completed = false;
  const fm = {
    documentsDirectory: () => '/docs',
    joinPath: (a: string, b: string) => `${a}/${b}`,
    fileExists: (p: string) => env.files.has(p) || [...env.files.keys()].some((k) => k.startsWith(p + '/')) || p === '/docs/vtcperso',
    readString: (p: string) => env.files.get(p) ?? '',
    writeString: (p: string, s: string) => void env.files.set(p, s),
    createDirectory: () => undefined,
    listContents: (p: string) => [...env.files.keys()].filter((k) => k.startsWith(p + '/')).map((k) => k.slice(p.length + 1)),
  };
  class Notification {
    title = '';
    body = '';
    async schedule() {
      env.notifications.push({ title: this.title, body: this.body });
    }
  }
  class Alert {
    title = '';
    message = '';
    actions: string[] = [];
    addAction(t: string) {
      this.actions.push(t);
    }
    addCancelAction() {}
    async presentAlert() {
      env.alerts.push({ title: this.title, message: this.message });
      return 0;
    }
    async presentSheet() {
      return env.menuChoice;
    }
  }
  class Request {
    method = 'GET';
    headers: Record<string, string> = {};
    body = '';
    timeoutInterval = 60;
    response = { statusCode: 0 };
    constructor(public url: string) {}
    async loadJSON() {
      env.requests.push({ url: this.url, headers: this.headers, body: this.body });
      if (!env.serverResponder) throw new Error('offline');
      const r = env.serverResponder(JSON.parse(this.body));
      this.response.statusCode = r.status;
      return r.json;
    }
  }
  const DateShim = class extends Date {
    constructor(...a: unknown[]) {
      if (a.length === 0) super(env.clock());
      else super(...(a as [string]));
    }
    static now() {
      return env.clock();
    }
  };
  const ctx = vm.createContext({
    args: { shortcutParameter },
    config: { runsInApp, runsWithSiri: false },
    FileManager: { local: () => fm },
    Pasteboard: { paste: () => env.pasteboard, copy: (s: string) => (env.pasteboard = s) },
    Keychain: { set: (k: string, v: string) => env.keychain.set(k, v), get: (k: string) => env.keychain.get(k) ?? '', contains: (k: string) => env.keychain.has(k) },
    Notification,
    Speech: { speak: (t: string) => env.spoken.push(t) },
    Alert,
    Request,
    Script: { setShortcutOutput: (v: unknown) => (output = v), complete: () => (completed = true) },
    UUID: { string: () => randomUUID().toUpperCase() },
    Date: DateShim,
    Intl,
    console,
    Math,
    JSON,
  });
  const wrapped = `(async () => {\n${SCRIPT()}\n})()`;
  await vm.runInContext(wrapped, ctx);
  if (!completed) throw new Error('Script.complete() non appelé');
  return output;
}
