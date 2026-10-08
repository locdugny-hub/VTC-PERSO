// Configuration du parcours rapide : construction, empreinte stable et validation.
// Le raccourci et le composant natif ne lisent jamais IndexedDB : ils reçoivent ce JSON
// (copié depuis la PWA ou téléchargé depuis la fonction serveur) et le conservent localement.
import type { CostProfile, FastConfig, PlatformRule, Scenario, ThresholdProfile, Platform } from './types';

/** FNV-1a 32 bits, hexadécimal : empreinte déterministe, pas une fonction de sécurité. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** JSON canonique (clés triées) pour une empreinte stable. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

export interface FastConfigParts {
  cost: CostProfile;
  thresholds: ThresholdProfile;
  platforms: Record<'uber' | 'bolt', PlatformRule>;
  sessionPlatform: Platform | null;
  scenario: Scenario;
  freshnessSec: number;
  voice: boolean;
  syncMode: 'off' | 'after_each';
  apiBase: string | null;
}

export function buildFastConfig(p: FastConfigParts, createdAt = new Date().toISOString()): FastConfig {
  // Sélection explicite des champs : des propriétés en trop (ex. configId d'une ancienne version) sont ignorées.
  const body = {
    schema: 1 as const,
    cost: p.cost,
    thresholds: p.thresholds,
    platforms: p.platforms,
    sessionPlatform: p.sessionPlatform,
    scenario: p.scenario,
    freshnessSec: p.freshnessSec,
    voice: p.voice,
    syncMode: p.syncMode,
    apiBase: p.apiBase,
  };
  const configId = 'cfg-' + fnv1a(canonical(body));
  return { ...body, configId, createdAt };
}

const isPosOrNull = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0);

export function validateFastConfig(x: unknown): { ok: true; config: FastConfig } | { ok: false; errors: string[] } {
  const e: string[] = [];
  const c = x as FastConfig;
  if (!c || typeof c !== 'object') return { ok: false, errors: ['Configuration absente'] };
  if (c.schema !== 1) e.push('Version de schéma inconnue');
  if (typeof c.configId !== 'string') e.push('configId manquant');
  if (!c.cost || typeof c.cost.id !== 'string') e.push('Profil de coûts manquant');
  else {
    if (!isPosOrNull(c.cost.variablePerKm)) e.push('v invalide');
    if (!isPosOrNull(c.cost.fixedPerHour)) e.push('f invalide');
    if (!isPosOrNull(c.cost.otherPerOffer)) e.push('E invalide');
  }
  if (!c.thresholds || !(c.thresholds.perKm > 0) || !(c.thresholds.perHour > 0)) e.push('Seuils invalides (doivent être > 0)');
  if (c.thresholds && c.thresholds.level !== 'revenue' && c.thresholds.level !== 'margin') e.push('Niveau de seuil invalide');
  for (const k of ['uber', 'bolt'] as const) {
    const r = c.platforms?.[k];
    if (!r) e.push(`Règle ${k} manquante`);
    else {
      if (!['net_driver', 'gross_before_commission', 'unknown'].includes(r.priceBasis)) e.push(`Base ${k} invalide`);
      if (r.commissionRate !== null && !(r.commissionRate >= 0 && r.commissionRate < 1)) e.push(`Commission ${k} invalide`);
    }
  }
  if (!(c.freshnessSec > 0 && c.freshnessSec <= 120)) e.push('Fraîcheur invalide (1 à 120 s)');
  if (!c.scenario) e.push('Scénario manquant');
  if (e.length === 0) {
    // Vérifie l'intégrité de l'empreinte : une config modifiée à la main est signalée.
    const { configId, createdAt, ...body } = c;
    void createdAt;
    const expect = 'cfg-' + fnv1a(canonical(body));
    if (expect !== configId) e.push('Empreinte de configuration incohérente (fichier modifié ?)');
  }
  return e.length ? { ok: false, errors: e } : { ok: true, config: c };
}

/** Configuration de démonstration, clairement fictive. */
export function demoConfig(): FastConfig {
  return buildFastConfig(
    {
      cost: { id: 'demo-cost', version: 1, effectiveFrom: '2026-01-01T00:00:00Z', variablePerKm: 0.2, fixedPerHour: 5, otherPerOffer: 0 },
      thresholds: { id: 'demo-th', version: 1, effectiveFrom: '2026-01-01T00:00:00Z', level: 'margin', perKm: 1, perHour: 18 },
      platforms: {
        uber: { priceBasis: 'net_driver', commissionRate: null },
        bolt: { priceBasis: 'unknown', commissionRate: null },
      },
      sessionPlatform: null,
      scenario: { returnKm: null, returnMin: null, waitMin: null },
      freshnessSec: 10,
      voice: true,
      syncMode: 'off',
      apiBase: null,
    },
    '2026-01-01T00:00:00.000Z',
  );
}
