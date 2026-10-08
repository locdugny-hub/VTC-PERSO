// Banc SYNTHÉTIQUE (offres fictives + OCR Tesseract) : robustesse du parseur au bruit OCR.
// N'établit PAS la précision sur de vraies offres Uber/Bolt ni avec l'OCR d'Apple.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOffer } from '../src/core/parse';
import { analyzeText } from '../src/core/analyze';
import { buildFastConfig, demoConfig } from '../src/core/config';

interface Case { id: string; platform: string; layout: string; dark: boolean; big: boolean; masked: boolean; truth: Record<string, number>; ocrText: string }
const { cases } = JSON.parse(readFileSync(new URL('./fixtures/synthetic/cases.json', import.meta.url), 'utf8')) as { cases: Case[] };
const FIELDS = ['price', 'approachKm', 'approachMin', 'tripKm', 'tripMin'] as const;

describe(`Banc synthétique Tesseract (${cases.length} images fictives)`, () => {
  const stats = { correct: 0, wrong: 0, missing: 0, total: 0, fullyRead: 0, wrongDetails: [] as string[] };
  for (const c of cases) {
    const o = parseOffer(c.ocrText);
    let all = true;
    for (const f of FIELDS) {
      const got = o[f].value;
      const want = c.truth[f];
      stats.total++;
      if (got === null) { stats.missing++; all = false; }
      else if (Math.abs(got - want) < 1e-9) stats.correct++;
      else { stats.wrong++; all = false; stats.wrongDetails.push(`${c.id} ${f}: lu ${got}, attendu ${want}`); }
    }
    if (all) stats.fullyRead++;
  }
  it('aucune valeur fausse (une valeur incertaine doit rester inconnue)', () => {
    console.log(`[banc synthétique] champs corrects ${stats.correct}/${stats.total}, inconnus ${stats.missing}, faux ${stats.wrong} ; offres entièrement lues ${stats.fullyRead}/${cases.length}`);
    if (stats.wrongDetails.length) console.log(stats.wrongDetails.join('\n'));
    expect(stats.wrong).toBe(0);
  });
  it('offres non masquées : au moins 90 % entièrement lues', () => {
    const unmasked = cases.filter((c) => !c.masked);
    const ok = unmasked.filter((c) => { const o = parseOffer(c.ocrText); return FIELDS.every((f) => o[f].value !== null && Math.abs(o[f].value! - c.truth[f]) < 1e-9); });
    console.log(`[banc synthétique] non masquées entièrement lues : ${ok.length}/${unmasked.length}`);
    expect(ok.length / unmasked.length).toBeGreaterThanOrEqual(0.9);
  });
  it('offres masquées : favorable seulement si tous les champs restent correctement lus', () => {
    const permissive = buildFastConfig({ ...demoConfig(), thresholds: { ...demoConfig().thresholds, perKm: 0.01, perHour: 0.01 }, platforms: { uber: { priceBasis: 'net_driver', commissionRate: null }, bolt: { priceBasis: 'net_driver', commissionRate: null } } });
    for (const c of cases.filter((x) => x.masked)) {
      const a = analyzeText(c.ocrText, permissive);
      const allRead = FIELDS.every((f) => a.offer[f].value !== null && Math.abs(a.offer[f].value! - c.truth[f]) < 1e-9);
      if (!allRead) expect(a.verdict.verdict, c.id).not.toBe('favorable');
    }
  });
});
