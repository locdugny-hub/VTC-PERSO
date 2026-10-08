#!/usr/bin/env node
// Calcule les délais "pression -> verdict visible" à partir d'annotations vidéo (ralenti d'un 2e appareil).
// Usage : node tools/latency-report.mjs validation/mesures.csv
// CSV (séparateur ; ou ,) : essai;plateforme;etat;fps;image_pression;image_visible;image_voix;offre_encore_affichee;verdict_correct
//   etat = chaud | froid ; image_voix vide si pas de voix ; offre_encore_affichee = oui|non ; verdict_correct = oui|non
import { readFileSync } from 'node:fs';

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map((h) => h.trim());
  return lines.slice(1).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [head[i], v.trim()])));
}

const pct = (v, p) => {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

export function report(rows) {
  const groups = {};
  for (const r of rows) {
    const fps = Number(r.fps);
    const p = Number(r.image_pression);
    const vis = r.image_visible === '' ? NaN : Number(r.image_visible);
    const voix = r.image_voix === '' || r.image_voix === undefined ? NaN : Number(r.image_voix);
    const firstUseful = Math.min(...[vis, voix].filter(Number.isFinite));
    const ms = Number.isFinite(firstUseful) && fps > 0 ? Math.round(((firstUseful - p) / fps) * 1000) : null;
    for (const k of [`${r.plateforme}/${r.etat}`, `${r.plateforme}/tous`, 'tous/tous']) {
      groups[k] ??= { n: 0, ms: [], echecs: 0, perimes: 0, faux: 0 };
      const g = groups[k];
      g.n++;
      if (ms === null) g.echecs++;
      else g.ms.push(ms);
      if (r.offre_encore_affichee === 'non') g.perimes++;
      if (r.verdict_correct === 'non') g.faux++;
    }
  }
  return Object.fromEntries(
    Object.entries(groups).map(([k, g]) => [
      k,
      {
        essais: g.n,
        sans_resultat: g.echecs,
        mediane_ms: pct(g.ms, 50),
        p95_ms: pct(g.ms, 95),
        part_le_1s: g.ms.length ? Math.round((100 * g.ms.filter((x) => x <= 1000).length) / g.n) : 0,
        part_le_2s: g.ms.length ? Math.round((100 * g.ms.filter((x) => x <= 2000).length) / g.n) : 0,
        offre_disparue_avant_resultat: g.perimes,
        verdicts_faux: g.faux,
        cible_mediane_1s: pct(g.ms, 50) !== null && pct(g.ms, 50) <= 1000 && g.echecs === 0,
        cible_95pct_2s: g.ms.length ? g.ms.filter((x) => x <= 2000).length / g.n >= 0.95 : false,
      },
    ]),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = process.argv[2];
  if (!f) {
    console.error('Usage : node tools/latency-report.mjs validation/mesures.csv');
    process.exit(1);
  }
  const r = report(parseCsv(readFileSync(f, 'utf8')));
  console.table(r);
  const all = r['tous/tous'];
  console.log(all.essais < 60 ? `Attention : ${all.essais} essais (30 par plateforme minimum demandés).` : 'Volume d’essais suffisant.');
}
