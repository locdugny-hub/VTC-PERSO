#!/usr/bin/env node
// Évalue les parseurs sur VOTRE corpus de captures réelles annotées (texte OCR Apple + vérité terrain).
// Usage : node tools/corpus-eval.mjs [validation/corpus] [--jeu validation]
// annotations.csv : fichier;plateforme;prix;base;approche_km;approche_min;trajet_km;trajet_min;jeu
//   (valeur vide = absente de l'écran ; jeu = reglage | validation ; validation = images inédites réservées)
// textes/<fichier>.txt : texte produit par "Extraire le texte de l'image" (raccourci "VTC Corpus").
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseOffer, analyzeParsed, computeFinance, computeVerdict, demoConfig } from '../supabase/functions/_shared/vtc-core.js';
import { parseCsv } from './latency-report.mjs';

const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'validation/corpus';
const jeu = process.argv.includes('--jeu') ? process.argv[process.argv.indexOf('--jeu') + 1] : null;
const cfgPath = join(dir, 'config.json');
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : demoConfig();
const rows = parseCsv(readFileSync(join(dir, 'annotations.csv'), 'utf8')).filter((r) => !jeu || r.jeu === jeu);
const F = [['prix', 'price'], ['approche_km', 'approachKm'], ['approche_min', 'approachMin'], ['trajet_km', 'tripKm'], ['trajet_min', 'tripMin']];
const num = (s) => (s === '' || s === undefined ? null : Number(String(s).replace(',', '.')));
const st = { offres: 0, champs: 0, corrects: 0, faux: 0, inconnus: 0, plateformeFausse: 0, verdictFaux: 0, favorableErrone: 0, rejet: 0, parPlateforme: {} };
const errs = [];
for (const r of rows) {
  const p = join(dir, 'textes', r.fichier.replace(/\.[a-z]+$/i, '') + '.txt');
  if (!existsSync(p)) { errs.push(`${r.fichier} : texte absent`); continue; }
  const o = parseOffer(readFileSync(p, 'utf8'));
  st.offres++;
  const pp = (st.parPlateforme[r.plateforme] ??= { offres: 0, completes: 0, faux: 0 });
  pp.offres++;
  let complete = true;
  for (const [col, key] of F) {
    const want = num(r[col]);
    const got = o[key].value;
    if (want === null) continue;
    st.champs++;
    if (got === null) { st.inconnus++; complete = false; }
    else if (Math.abs(got - want) < 1e-6) st.corrects++;
    else { st.faux++; pp.faux++; complete = false; errs.push(`${r.fichier} ${key} : lu ${got}, attendu ${want}`); }
  }
  if (complete) pp.completes++;
  if (o.platform.value && o.platform.value !== r.plateforme) st.plateformeFausse++;
  // Verdict "vrai" = moteur appliqué aux valeurs annotées ; verdict obtenu = moteur appliqué à la lecture.
  const truthOffer = { ...o, platform: { value: r.plateforme, provenance: 'manual' } };
  for (const [col, key] of F) truthOffer[key] = { value: num(r[col]), provenance: 'manual' };
  if (r.base) truthOffer.priceBasis = { value: r.base, provenance: 'manual' };
  const vTrue = analyzeParsed(truthOffer, cfg).verdict.verdict;
  const vGot = analyzeParsed({ ...o, platform: o.platform.value ? o.platform : { value: r.plateforme, provenance: 'config' } }, cfg).verdict.verdict;
  if (vGot === 'indisponible' || vGot === 'partiel') st.rejet++;
  else if (vGot !== vTrue) { st.verdictFaux++; if (vGot === 'favorable') st.favorableErrone++; errs.push(`${r.fichier} verdict ${vGot} au lieu de ${vTrue}`); }
}
console.log(JSON.stringify({ corpus: dir, jeu: jeu ?? 'tous', configuration: cfg.configId, ...st, exactitude_champs: st.champs ? +(st.corrects / st.champs).toFixed(4) : null, taux_rejet: st.offres ? +(st.rejet / st.offres).toFixed(4) : null }, null, 2));
if (errs.length) console.log('\nDétails :\n' + errs.join('\n'));
if (st.favorableErrone > 0) { console.log('\nÉCHEC : verdict favorable provoqué par une erreur de lecture.'); process.exitCode = 2; }
void computeFinance; void computeVerdict;
