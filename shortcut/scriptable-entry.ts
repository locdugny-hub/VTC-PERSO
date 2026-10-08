// Script "VTC Perso" pour l'app Scriptable (gratuite), appelé par le raccourci iOS via l'action
// "Run Script" (Exécuter le script), SANS ouvrir l'app (option "Run In App" désactivée).
// Il reçoit le texte OCR produit par l'action Apple "Extraire le texte de l'image", applique le
// moteur local (même code que la PWA) avec la configuration enregistrée sur le téléphone,
// puis renvoie au raccourci le texte de la notification et de l'annonce vocale.
// Lancé directement dans Scriptable, il affiche un menu de configuration / export / synchronisation.
//
// Fichier généré par shortcut/build-scriptable.mjs : ne pas éditer shortcut/dist/VTCPerso.js à la main.

import { analyzeText, validateFastConfig, demoConfig, shouldDisplay } from '../src/core';
import type { Analysis, FastConfig } from '../src/core';
import { createRuntime } from './runtime';
import type { Runtime } from './runtime';

declare const args: { shortcutParameter?: unknown; queryParameters?: Record<string, string> };
declare const config: { runsInApp: boolean; runsWithSiri: boolean };

export interface FastInput {
  mode?: 'analyze' | 'post' | 'sync';
  text?: string;
  t0?: string; // date de début du raccourci (ISO avec millisecondes si possible)
  id?: string;
  tNotify?: string;
  /** Test fictif lancé depuis le menu : rien n'est journalisé. */
  test?: boolean;
}

export interface FastOutput {
  show: boolean;
  speak: boolean;
  title: string;
  body: string;
  speech: string;
  id: string;
  verdict: string;
  configId: string | null;
}

function parseIsoMs(s: string | undefined): number | null {
  if (!s || typeof s !== 'string') return null;
  // Raccourcis peut produire "2026-10-08T14:02:31.123+02:00" ou "2026-10-08 14:02:31,123".
  const t = Date.parse(s.trim().replace(' ', 'T').replace(/,(\d{1,3})/, '.$1'));
  return Number.isFinite(t) ? t : null;
}

/** Cœur du parcours rapide, testable hors iPhone avec un Runtime simulé. */
export function runAnalyze(rt: Runtime, input: FastInput): FastOutput {
  const scriptStart = rt.now();
  const t0ms = parseIsoMs(input.t0);
  const capturedAt = new Date(t0ms ?? scriptStart).toISOString();
  const id = rt.uuid();
  const log = !input.test; // un test fictif n'écrit rien dans le journal
  // Marque cette requête comme la plus récente AVANT le calcul, seulement si son déclenchement est
  // réellement plus récent que celui déjà enregistré (une requête retardée ne prend pas la place d'une plus récente).
  const prev = rt.readJson('latest.json') as { id: string; capturedAt: string } | null;
  const prevT = prev && typeof prev.capturedAt === 'string' ? Date.parse(prev.capturedAt) : -Infinity;
  if (!(prevT > Date.parse(capturedAt))) rt.writeJson('latest.json', { id, capturedAt });

  const cfgRaw = rt.readJson('config.json');
  const v = cfgRaw ? validateFastConfig(cfgRaw) : null;
  if (!v || !v.ok) {
    const out: FastOutput = {
      show: true,
      speak: false,
      title: '⚠️ Analyse indisponible',
      body: v && !v.ok ? 'Configuration invalide : ' + v.errors[0] : 'Configuration absente : ouvrez VTC Perso dans Scriptable',
      speech: '',
      id,
      verdict: 'indisponible',
      configId: null,
    };
    if (log) rt.appendJournal({ kind: 'error', id, at: capturedAt, message: out.body });
    return out;
  }
  const cfg: FastConfig = v.config;
  const text = typeof input.text === 'string' ? input.text : '';
  const a: Analysis = analyzeText(text, cfg, { id, capturedAt, now: () => new Date(rt.now()), source: 'shortcut' });
  const latest = rt.readJson('latest.json') as { id: string; capturedAt: string } | null;
  const decision = shouldDisplay(a, latest, new Date(rt.now()));
  const scriptEnd = rt.now();
  if (log) {
    rt.appendJournal({ kind: 'analysis', analysis: a });
    rt.appendJournal({
      kind: 'timing',
      id,
      scriptStartMs: t0ms !== null ? scriptStart - t0ms : undefined,
      scriptEndMs: t0ms !== null ? scriptEnd - t0ms : undefined,
      suppressed: !decision.show,
    });
  }
  if (!decision.show) {
    return { show: false, speak: false, title: '', body: decision.reason, speech: '', id, verdict: a.verdict.verdict, configId: cfg.configId };
  }
  return {
    show: true,
    speak: cfg.voice && a.display.speech.length > 0,
    title: a.display.title,
    body: a.display.body,
    speech: a.display.speech,
    id,
    verdict: a.verdict.verdict,
    configId: cfg.configId,
  };
}

/** Appelé après l'affichage : enregistre l'instant de restitution (mesure) ; synchronise si demandé. */
export async function runPost(rt: Runtime, input: FastInput): Promise<string> {
  const latest = rt.readJson('latest.json') as { id: string; capturedAt: string } | null;
  const t0 = latest && latest.id === input.id ? Date.parse(latest.capturedAt) : null;
  const tn = parseIsoMs(input.tNotify) ?? rt.now();
  if (input.id) rt.appendJournal({ kind: 'timing', id: input.id, afterNotifyMs: t0 !== null ? tn - t0 : undefined });
  const cfgRaw = rt.readJson('config.json') as FastConfig | null;
  if (cfgRaw && cfgRaw.syncMode === 'after_each') return rt.sync(cfgRaw);
  return 'ok';
}

async function inAppMenu(rt: Runtime): Promise<void> {
  const choice = await rt.menu('VTC Perso', [
    'Importer la configuration (presse-papiers)',
    'Tester une offre fictive (notification + voix)',
    'Copier le journal dans le presse-papiers',
    'Synchroniser maintenant',
    'Enregistrer le jeton d’appareil (presse-papiers)',
    'Installer la configuration de démonstration',
    'État',
  ]);
  if (choice === 0) {
    const txt = rt.pasteboard();
    let obj: unknown = null;
    try {
      obj = JSON.parse(txt ?? '');
    } catch {
      /* noop */
    }
    const v = validateFastConfig(obj);
    if (!v.ok) return rt.alert('Configuration refusée', v.errors.join('\n'));
    rt.writeJson('config.json', v.config);
    return rt.alert('Configuration enregistrée', `${v.config.configId}\nCoûts v${v.config.cost.version}, seuils v${v.config.thresholds.version}`);
  }
  if (choice === 1) {
    const fake = 'OFFRE FICTIVE\nUberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)';
    const out = runAnalyze(rt, { mode: 'analyze', text: fake, t0: new Date(rt.now()).toISOString(), test: true });
    rt.notify(out.title, out.body + ' (TEST FICTIF)');
    if (out.speak) rt.speak(out.speech);
    return rt.alert(out.title, out.body + '\n\nCe test vérifie la configuration, la notification et la voix. Il ne mesure pas le parcours réel.');
  }
  if (choice === 2) {
    const n = rt.copyJournal();
    return rt.alert('Journal copié', `${n} ligne(s). Collez-les dans la PWA : Réglages > Données > Importer le journal du raccourci.`);
  }
  if (choice === 3) {
    const cfg = rt.readJson('config.json') as FastConfig | null;
    if (!cfg) return rt.alert('Synchronisation', 'Configuration absente');
    return rt.alert('Synchronisation', await rt.sync(cfg));
  }
  if (choice === 4) {
    const tok = (rt.pasteboard() ?? '').trim();
    if (!/^vtcd_[A-Za-z0-9_-]{30,}$/.test(tok)) return rt.alert('Jeton refusé', 'Le presse-papiers ne contient pas un jeton VTC Perso (vtcd_…).');
    rt.setToken(tok);
    return rt.alert('Jeton enregistré', 'Stocké dans le trousseau iOS de Scriptable. Révocable depuis la PWA.');
  }
  if (choice === 5) {
    rt.writeJson('config.json', demoConfig());
    return rt.alert('Démonstration', 'Configuration FICTIVE installée (v=0,20 €/km, f=5 €/h, seuils marge 1 €/km et 18 €/h). Remplacez-la par la vôtre avant de conduire.');
  }
  if (choice === 6) {
    const cfg = rt.readJson('config.json') as FastConfig | null;
    return rt.alert('État', `Configuration : ${cfg ? cfg.configId + ' du ' + cfg.createdAt.slice(0, 10) : 'absente'}\nEn attente de synchronisation : ${rt.pendingCount()}\nJeton : ${rt.hasToken() ? 'oui' : 'non'}`);
  }
}

export async function main(): Promise<void> {
  const rt = createRuntime();
  const p = (typeof args !== 'undefined' ? args.shortcutParameter : undefined) as FastInput | string | undefined;
  const input: FastInput | null = typeof p === 'string' ? { mode: 'analyze', text: p } : p && typeof p === 'object' ? p : null;
  if (!input) {
    if (config.runsInApp) await inAppMenu(rt);
    rt.complete(null);
    return;
  }
  try {
    if (input.mode === 'post') {
      rt.complete(await runPost(rt, input));
    } else if (input.mode === 'sync') {
      const cfg = rt.readJson('config.json') as FastConfig | null;
      rt.complete(cfg ? await rt.sync(cfg) : 'Configuration absente');
    } else {
      rt.complete(runAnalyze(rt, input));
    }
  } catch (e) {
    // Jamais de dialogue bloquant dans le parcours : on renvoie un résultat "indisponible".
    rt.complete({ show: true, speak: false, title: '⚠️ Analyse indisponible', body: 'Erreur interne : ' + String(e).slice(0, 80), speech: '', id: '', verdict: 'indisponible', configId: null });
  }
}
