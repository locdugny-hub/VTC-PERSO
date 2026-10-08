// Logique de la fonction "device-api" (appelée par le raccourci avec un jeton d'appareil).
// Indépendante de Deno pour être testée sous Node. Aucun secret fournisseur n'est exposé.
import { analyzeText, validateFastConfig, sanitizeAnalysis } from './vtc-core.js';

export interface DeviceDeps {
  resolveToken(token: string, scope: 'ingest' | 'analyze'): Promise<{ userId: string; tokenId: string; allowed: boolean } | null>;
  ingest(userId: string, analyses: unknown[]): Promise<string[]>;
  latestConfig(userId: string): Promise<unknown | null>;
  now(): Date;
}

export const LIMITS = { ingestBytes: 512_000, analyzeBytes: 20_000, ingestBatch: 100 };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function handleDevice(req: Request, deps: DeviceDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'POST uniquement' });
  const url = new URL(req.url);
  const route = url.pathname.split('/').filter(Boolean).pop();
  if (route !== 'ingest' && route !== 'analyze') return json(404, { error: 'Route inconnue' });
  const token = req.headers.get('x-device-token') ?? '';
  if (!/^vtcd_[A-Za-z0-9_-]{30,80}$/.test(token)) return json(401, { error: 'Jeton absent ou mal formé' });
  const len = Number(req.headers.get('content-length') ?? '0');
  const max = route === 'ingest' ? LIMITS.ingestBytes : LIMITS.analyzeBytes;
  if (len > max) return json(413, { error: 'Requête trop volumineuse' });
  const raw = await req.text();
  if (raw.length > max) return json(413, { error: 'Requête trop volumineuse' });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'JSON invalide' });
  }
  const who = await deps.resolveToken(token, route);
  if (!who) return json(401, { error: 'Jeton inconnu ou révoqué' });
  if (!who.allowed) return json(429, { error: 'Trop de requêtes : réessayez dans une minute' });

  if (route === 'ingest') {
    const list = body.analyses;
    if (!Array.isArray(list) || list.length > LIMITS.ingestBatch) return json(400, { error: 'analyses : tableau de 1 à 100 éléments attendu' });
    // Forme vérifiée champ par champ : une analyse invalide est refusée (et signalée pour ne pas être renvoyée sans fin).
    const clean = list.map((a) => sanitizeAnalysis(a)).filter((a): a is NonNullable<typeof a> => a !== null);
    const rejected = list
      .filter((a) => sanitizeAnalysis(a) === null)
      .map((a) => (a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string' ? (a as { id: string }).id.slice(0, 128) : null))
      .filter((x): x is string => x !== null);
    const accepted = clean.length ? await deps.ingest(who.userId, clean) : [];
    return json(200, { accepted, rejected });
  }

  // analyze : variante B (calcul serveur), même moteur que le script local.
  const text = typeof body.text === 'string' ? body.text.slice(0, 8000) : '';
  const cfgRaw = await deps.latestConfig(who.userId);
  const v = cfgRaw ? validateFastConfig(cfgRaw) : null;
  if (!v || !v.ok) {
    return json(200, { title: '⚠️ Analyse indisponible', body: 'Configuration non publiée depuis la PWA', speech: '', id: '', verdict: 'indisponible' });
  }
  const t0 = typeof body.t0 === 'string' && Number.isFinite(Date.parse(body.t0.replace(' ', 'T').replace(/,(\d{1,3})/, '.$1')))
    ? new Date(Date.parse(body.t0.replace(' ', 'T').replace(/,(\d{1,3})/, '.$1'))).toISOString()
    : deps.now().toISOString();
  const a = analyzeText(text, v.config, { capturedAt: t0, now: deps.now, source: 'server' });
  // L'analyse est aussi enregistrée dans l'historique (sans le texte OCR brut).
  await deps.ingest(who.userId, [a]);
  const fresh = deps.now().getTime() <= new Date(a.validUntil).getTime();
  return json(200, {
    title: fresh ? a.display.title : '',
    body: fresh ? a.display.body : 'Résultat périmé',
    speech: fresh && v.config.voice ? a.display.speech : '',
    id: a.id,
    verdict: a.verdict.verdict,
  });
}
