// Vérifie le moteur embarqué dans le composant natif (vtc-core.js IIFE + bridge.js) tel que
// JavaScriptCore l'exécuterait (contexte isolé sans Node). Ne teste pas le code Swift.
import { beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { demoConfig } from '../src/core/config';

let ctx: vm.Context;
beforeAll(() => {
  execSync('node shortcut/build-scriptable.mjs', { stdio: 'ignore' });
  ctx = vm.createContext({});
  vm.runInContext(readFileSync('native/VTCPerso/Resources/vtc-core.js', 'utf8'), ctx);
  vm.runInContext(readFileSync('native/VTCPerso/Resources/bridge.js', 'utf8'), ctx);
});

describe('Pont natif (JavaScriptCore simulé)', () => {
  it('validation de la configuration', () => {
    const ok = JSON.parse(vm.runInContext(`vtcValidate(${JSON.stringify(JSON.stringify(demoConfig()))})`, ctx));
    expect(ok).toEqual({ ok: true, configId: demoConfig().configId, voice: true });
    const ko = JSON.parse(vm.runInContext(`vtcValidate("{}")`, ctx));
    expect(ko.ok).toBe(false);
  });
  it('analyse et empreinte de déduplication', () => {
    const text = 'Bolt\n24,30 €\nPrise en charge · 3 min · 1,1 km\nDestination · 25 min · 15,2 km';
    const r = JSON.parse(vm.runInContext(`vtcAnalyze(${JSON.stringify(text)}, ${JSON.stringify(JSON.stringify(demoConfig()))}, "2026-10-08T10:00:00.000Z")`, ctx));
    expect(r.status).toBe('ok');
    expect(r.fingerprint).toBe('bolt|24.3|1.1|15.2|25');
    expect(r.validUntil).toBe('2026-10-08T10:00:10.000Z');
    expect(JSON.parse(r.journalLine).analysis.source).toBe('native');
  });
  it('écran sans offre', () => {
    const r = JSON.parse(vm.runInContext(`vtcAnalyze("Tournez à droite dans 300 m", ${JSON.stringify(JSON.stringify(demoConfig()))}, "2026-10-08T10:00:00.000Z")`, ctx));
    expect(r.status).toBe('not_offer');
  });
});
