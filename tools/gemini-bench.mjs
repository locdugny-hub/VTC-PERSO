#!/usr/bin/env node
// Étude comparative à lancer SUR VOTRE ORDINATEUR avec VOTRE clé Gemini (projet sans facturation) :
//   1) OCR local + parseur déterministe   2) OCR local + structuration Gemini   3) image -> Gemini multimodal
// Mesure exactitude par champ, rejet, latence de bout en bout de l'appel, volume envoyé.
// Usage : GEMINI_API_KEY=... node tools/gemini-bench.mjs [validation/corpus] [--modele gemini-2.5-flash-lite] [--max 30]
// Les images du corpus (images/<fichier>) sont envoyées à Google : n'utilisez que des captures que vous acceptez d'envoyer.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { parseOffer } from '../supabase/functions/_shared/vtc-core.js';
import { parseCsv } from './latency-report.mjs';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Définissez GEMINI_API_KEY dans votre terminal (ne la collez jamais dans une conversation).'); process.exit(1); }
const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'validation/corpus';
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const model = arg('--modele', 'gemini-2.5-flash-lite');
const max = Number(arg('--max', '30'));
const out = await build({ entryPoints: ['supabase/functions/_shared/ai.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral' });
const ai = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const rows = parseCsv(readFileSync(join(dir, 'annotations.csv'), 'utf8')).slice(0, max);
const F = [['prix', 'price'], ['approche_km', 'approachKm'], ['approche_min', 'approachMin'], ['trajet_km', 'tripKm'], ['trajet_min', 'tripMin']];
const num = (s) => (s === '' || s === undefined ? null : Number(String(s).replace(',', '.')));

async function gemini(body) {
  const t = performance.now();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) });
  const ms = performance.now() - t;
  if (r.status === 429) throw new Error('429 : quota gratuit atteint, arrêt de l’étude');
  const j = r.ok ? await r.json() : null;
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let fields = null;
  try { fields = ai.validateOffer(JSON.parse(text)).fields; } catch { fields = null; }
  return { ms, fields, bytes: JSON.stringify(body).length };
}
const res = { local: [], gemini_texte: [], gemini_image: [] };
const score = (fields, r) => {
  let ok = 0, faux = 0, inc = 0;
  for (const [col, key] of F) {
    const w = num(r[col]);
    if (w === null) continue;
    const g = fields ? fields[key] : null;
    if (g === null || g === undefined) inc++;
    else if (Math.abs(g - w) < 1e-6) ok++;
    else faux++;
  }
  return { ok, faux, inc };
};
for (const r of rows) {
  const tp = join(dir, 'textes', r.fichier.replace(/\.[a-z]+$/i, '') + '.txt');
  if (!existsSync(tp)) continue;
  const text = readFileSync(tp, 'utf8');
  let t = performance.now();
  const o = parseOffer(text);
  res.local.push({ ms: performance.now() - t, bytes: 0, ...score(Object.fromEntries(F.map(([, k]) => [k, o[k].value])), r) });
  try {
    const b1 = ai.buildRequest('extract_offer', { text }, ai.DEFAULT_AI_CONFIG);
    const g1 = await gemini(b1.body);
    res.gemini_texte.push({ ms: g1.ms, bytes: g1.bytes, ...score(g1.fields, r) });
    const ip = join(dir, 'images', r.fichier);
    if (existsSync(ip)) {
      const b64 = readFileSync(ip).toString('base64');
      const b2 = ai.buildRequest('extract_offer', { imageBase64: b64, mime: ip.endsWith('.png') ? 'image/png' : 'image/jpeg' }, { ...ai.DEFAULT_AI_CONFIG, maxImageBytes: 4_000_000 });
      if (typeof b2 === 'object') {
        const g2 = await gemini(b2.body);
        res.gemini_image.push({ ms: g2.ms, bytes: g2.bytes, ...score(g2.fields, r) });
      }
    }
  } catch (e) { console.error(String(e)); break; }
}
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]) : null; };
const summary = Object.fromEntries(Object.entries(res).map(([k, v]) => {
  const ok = v.reduce((s, x) => s + x.ok, 0), faux = v.reduce((s, x) => s + x.faux, 0), inc = v.reduce((s, x) => s + x.inc, 0);
  return [k, { offres: v.length, exactitude: ok + faux + inc ? +(ok / (ok + faux + inc)).toFixed(3) : null, valeurs_fausses: faux, inconnues: inc, latence_p50_ms: pct(v.map((x) => x.ms), 50), latence_p95_ms: pct(v.map((x) => x.ms), 95), octets_envoyes_moy: v.length ? Math.round(v.reduce((s, x) => s + x.bytes, 0) / v.length) : 0 }];
}));
console.table(summary);
console.log(`Modèle : ${model}. Latence = appel API seul depuis ce poste (le parcours iPhone ajouterait capture, OCR, réseau mobile et affichage).`);
