// Exécute le script Scriptable GÉNÉRÉ (shortcut/dist/VTCPerso.js) avec des API simulées.
// Valide le contrat raccourci <-> script ; ne valide pas iOS, l'OCR d'Apple ni les délais réels.
import { beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { newEnv, runScript } from './scriptable-sim';
import { demoConfig, buildFastConfig } from '../src/core/config';
import { percentile } from '../src/core/history';

const OFFER = 'UberX\n12,50 €\nÀ 6 min (2,0 km)\nTrajet de 20 min (8,0 km)';
type Out = { show: boolean; speak: boolean; title: string; body: string; speech: string; id: string; verdict: string; configId: string | null };

beforeAll(() => {
  execSync('node shortcut/build-scriptable.mjs', { stdio: 'ignore' });
});

describe('Script Scriptable (bundle généré)', () => {
  it('sans configuration : résultat "Analyse indisponible" sans dialogue', async () => {
    const env = newEnv();
    const out = (await runScript(env, { mode: 'analyze', text: OFFER, t0: new Date().toISOString() })) as Out;
    expect(out.title).toMatch(/indisponible/);
    expect(env.alerts).toHaveLength(0);
  });

  it('import de la configuration depuis le presse-papiers (menu dans l’app)', async () => {
    const env = newEnv();
    env.pasteboard = JSON.stringify(demoConfig());
    env.menuChoice = 0;
    await runScript(env, undefined, true);
    expect(env.alerts[0].title).toBe('Configuration enregistrée');
    expect(env.files.has('/docs/vtcperso/config.json')).toBe(true);
    env.pasteboard = '{"schema":1}';
    await runScript(env, undefined, true);
    expect(env.alerts[1].title).toBe('Configuration refusée');
  });

  it('parcours analyse : sortie pour notification + voix, journal et file d’attente', async () => {
    const env = newEnv();
    env.files.set('/docs/vtcperso/config.json', JSON.stringify(demoConfig()));
    const t0 = new Date(Date.now() - 300).toISOString();
    const out = (await runScript(env, { mode: 'analyze', text: OFFER, t0 })) as Out;
    expect(out.show).toBe(true);
    expect(out.speak).toBe(true);
    expect(out.title).toMatch(/^🟠 Limite · 19,23 €\/h marge/);
    expect(out.body).toMatch(/approche incluse/);
    expect(out.speech).toBe("Limite. 19 euros de l'heure.");
    expect(out.configId).toBe(demoConfig().configId);
    const journal = [...env.files.entries()].find(([k]) => k.includes('journal-'))![1].trim().split('\n');
    expect(journal).toHaveLength(2);
    const timing = JSON.parse(journal[1]);
    expect(timing.scriptStartMs).toBeGreaterThanOrEqual(300);
    expect(env.files.has('/docs/vtcperso/pending.json')).toBe(false); // aucune file écrite pendant le parcours
    // Étape "post" : enregistre l'instant d'affichage
    await runScript(env, { mode: 'post', id: out.id, tNotify: new Date().toISOString() });
    const j2 = [...env.files.entries()].find(([k]) => k.includes('journal-'))![1].trim().split('\n');
    expect(JSON.parse(j2[2]).afterNotifyMs).toBeGreaterThanOrEqual(300);
  });

  it('accepte une date Raccourcis "AAAA-MM-JJ HH:MM:SS,mmm"', async () => {
    const env = newEnv();
    env.files.set('/docs/vtcperso/config.json', JSON.stringify(demoConfig()));
    const out = (await runScript(env, { mode: 'analyze', text: OFFER, t0: '2026-10-08 14:02:31,123' })) as Out;
    expect(out.verdict).toBe('limite');
  });

  it('texte brut en paramètre (variante minimale du raccourci)', async () => {
    const env = newEnv();
    env.files.set('/docs/vtcperso/config.json', JSON.stringify(demoConfig()));
    const out = (await runScript(env, OFFER)) as Out;
    expect(out.verdict).toBe('limite');
  });

  it('configuration modifiée à la main : refusée, pas de verdict', async () => {
    const env = newEnv();
    env.files.set('/docs/vtcperso/config.json', JSON.stringify({ ...demoConfig(), freshnessSec: 60 }));
    const out = (await runScript(env, { mode: 'analyze', text: OFFER })) as Out;
    expect(out.verdict).toBe('indisponible');
    expect(out.body).toMatch(/Empreinte/);
  });

  it('résultat périmé (t0 trop ancien) : non affiché', async () => {
    const env = newEnv();
    env.files.set('/docs/vtcperso/config.json', JSON.stringify(demoConfig()));
    const out = (await runScript(env, { mode: 'analyze', text: OFFER, t0: new Date(Date.now() - 15000).toISOString() })) as Out;
    expect(out.show).toBe(false);
    expect(out.body).toMatch(/périmé/);
  });

  it('synchronisation : hors ligne => données conservées ; en ligne => file vidée', async () => {
    const env = newEnv();
    env.files.set('/docs/vtcperso/config.json', JSON.stringify(buildFastConfig({ ...demoConfig(), syncMode: 'off', apiBase: 'https://exemple.supabase.co/functions/v1/device-api' })));
    env.keychain.set('vtcperso.deviceToken', 'vtcd_' + 'a'.repeat(40));
    await runScript(env, { mode: 'analyze', text: OFFER });
    const r1 = await runScript(env, { mode: 'sync' });
    expect(String(r1)).toMatch(/Réseau indisponible/);
    env.serverResponder = (body) => ({ status: 200, json: { accepted: (body as { analyses: { id: string }[] }).analyses.map((a) => a.id), rejected: [] } });
    const r2 = await runScript(env, { mode: 'sync' });
    expect(String(r2)).toMatch(/1 analyse/);
    expect(env.requests.at(-1)!.headers['x-device-token']).toMatch(/^vtcd_/);
    const r3 = await runScript(env, { mode: 'sync' });
    expect(String(r3)).toMatch(/Rien à synchroniser/);
    // Une analyse refusée par le serveur n'est pas renvoyée indéfiniment
    await runScript(env, { mode: 'analyze', text: OFFER });
    env.serverResponder = (body) => ({ status: 200, json: { accepted: [], rejected: (body as { analyses: { id: string }[] }).analyses.map((a) => a.id) } });
    await runScript(env, { mode: 'sync' });
    expect(String(await runScript(env, { mode: 'sync' }))).toMatch(/Rien à synchroniser/);
  });

  it('requête retardée : un déclenchement plus ancien ne remplace pas le plus récent', async () => {
    const env = newEnv();
    env.files.set('/docs/vtcperso/config.json', JSON.stringify(demoConfig()));
    const now = Date.now();
    const newer = (await runScript(env, { mode: 'analyze', text: OFFER, t0: new Date(now - 200).toISOString() })) as Out;
    expect(newer.show).toBe(true);
    const older = (await runScript(env, { mode: 'analyze', text: OFFER, t0: new Date(now - 1500).toISOString() })) as Out;
    expect(older.show).toBe(false);
    expect(older.title).toBe('');
    expect(JSON.parse(env.files.get('/docs/vtcperso/latest.json')!).id).toBe(newer.id);
  });

  it('test fictif depuis le menu : notification et voix, rien dans le journal', async () => {
    const env = newEnv();
    env.files.set('/docs/vtcperso/config.json', JSON.stringify(demoConfig()));
    env.menuChoice = 1;
    await runScript(env, undefined, true);
    expect(env.notifications[0].body).toMatch(/TEST FICTIF/);
    expect(env.spoken).toHaveLength(1);
    expect([...env.files.keys()].some((k) => k.includes('journal-'))).toBe(false);
  });

  it('mesure indicative du calcul (Node, pas iPhone) : 200 analyses', async () => {
    const env = newEnv();
    env.files.set('/docs/vtcperso/config.json', JSON.stringify(demoConfig()));
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const s = performance.now();
      await runScript(env, { mode: 'analyze', text: OFFER });
      times.push(performance.now() - s);
      if (i % 50 === 0) env.files.forEach((_, k) => k.includes('journal-') && env.files.set(k, ''));
    }
    const p50 = percentile(times, 50)!;
    const p95 = percentile(times, 95)!;
    console.log(`[mesure Node] exécution complète du script (chargement + calcul + fichiers simulés) : p50=${p50.toFixed(1)} ms, p95=${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(500);
  });
});
