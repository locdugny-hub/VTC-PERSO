// État applicatif : base locale ouverte, réglages, profils versionnés, configuration du parcours rapide.
import { buildFastConfig } from '../core/config';
import { defaultSettings, deriveCosts } from '../core/domain';
import type { CostProfileRec, SettingsRec, ThresholdRec, Vehicle } from '../core/domain';
import type { FastConfig, ThresholdLevel } from '../core/types';
import { newId } from '../core/analyze';
import { LocalDB } from './db';

export interface AppState {
  db: LocalDB;
  scope: string;
  settings: SettingsRec;
  userEmail: string | null;
  userId: string | null;
}

export const state = {} as AppState;

export function storedScope(): string {
  try {
    return localStorage.getItem('vtcperso.scope') || 'local';
  } catch {
    return 'local';
  }
}
export function rememberScope(scope: string) {
  try {
    localStorage.setItem('vtcperso.scope', scope);
  } catch {
    /* stockage indisponible : la portée par défaut sera utilisée */
  }
}

export async function openScope(scope: string): Promise<void> {
  if (state.db) state.db.close();
  state.db = await LocalDB.open(scope);
  state.scope = scope;
  const s = (await state.db.get('settings', 'settings')) as SettingsRec | undefined;
  state.settings = s ?? defaultSettings();
  if (!s) await state.db.save('settings', state.settings);
}

export async function saveSettings(patch: Partial<SettingsRec>) {
  state.settings = await state.db.save('settings', { ...state.settings, ...patch });
}

export async function activeVehicle(): Promise<Vehicle | null> {
  if (!state.settings.activeVehicleId) return null;
  return ((await state.db.get('vehicles', state.settings.activeVehicleId)) as Vehicle | undefined) ?? null;
}
export async function activeCost(): Promise<CostProfileRec | null> {
  if (!state.settings.activeCostProfileId) return null;
  return ((await state.db.get('costProfiles', state.settings.activeCostProfileId)) as CostProfileRec | undefined) ?? null;
}
export async function activeThreshold(): Promise<ThresholdRec | null> {
  if (!state.settings.activeThresholdId) return null;
  return ((await state.db.get('thresholds', state.settings.activeThresholdId)) as ThresholdRec | undefined) ?? null;
}

/**
 * Enregistre le véhicule et crée une NOUVELLE version du profil de coûts (les anciennes restent
 * intactes : les analyses passées gardent leurs hypothèses).
 */
export async function saveVehicleAndCosts(v: Omit<Vehicle, 'id' | 'updatedAt'> & { id?: string }, otherPerOffer: number | null): Promise<CostProfileRec> {
  const vehicle: Vehicle = { ...v, id: v.id ?? newId(), updatedAt: '' } as Vehicle;
  const savedV = await state.db.save('vehicles', vehicle);
  const prev = await activeCost();
  const d = deriveCosts(savedV);
  const now = new Date().toISOString();
  const prof: CostProfileRec = {
    id: newId(),
    updatedAt: now,
    vehicleId: savedV.id,
    version: (prev?.version ?? 0) + 1,
    effectiveFrom: now,
    variablePerKm: d.variablePerKm,
    fixedPerHour: d.fixedPerHour,
    otherPerOffer,
    detail: {
      energyPerKm: d.energyPerKm,
      maintenancePerKm: savedV.maintenancePerKm,
      fixedMonthly: savedV.fixedMonthly,
      plannedHoursMonthly: savedV.plannedHoursMonthly,
    },
  };
  const saved = await state.db.save('costProfiles', prof);
  await saveSettings({ activeVehicleId: savedV.id, activeCostProfileId: saved.id });
  return saved;
}

export async function saveThresholds(level: ThresholdLevel, perKm: number, perHour: number): Promise<ThresholdRec> {
  if (!(perKm > 0) || !(perHour > 0)) throw new Error('Les seuils doivent être strictement positifs');
  const prev = await activeThreshold();
  const now = new Date().toISOString();
  const t: ThresholdRec = { id: newId(), updatedAt: now, version: (prev?.version ?? 0) + 1, effectiveFrom: now, level, perKm, perHour };
  const saved = await state.db.save('thresholds', t);
  await saveSettings({ activeThresholdId: saved.id });
  return saved;
}

/** Règle transmise au raccourci : base et taux seulement s'ils sont confirmés par l'utilisateur. */
function ruleFor(p: SettingsRec['platforms']['uber']) {
  if (!p.confirmed) return { priceBasis: 'unknown' as const, commissionRate: null };
  return { priceBasis: p.priceBasis, commissionRate: p.priceBasis === 'gross_before_commission' ? p.commissionRate : null };
}

/** Configuration du parcours rapide dérivée des réglages actuels, ou liste de ce qui manque. */
export async function currentFastConfig(): Promise<{ config: FastConfig | null; missing: string[]; warnings: string[] }> {
  const missing: string[] = [];
  const warnings: string[] = [];
  const cost = await activeCost();
  const th = await activeThreshold();
  if (!th) missing.push('seuils');
  if (!cost) warnings.push('Coûts non renseignés : seuls les indicateurs avant frais seront disponibles');
  else {
    if (cost.variablePerKm === null) warnings.push('Coût variable v non renseigné');
    if (cost.fixedPerHour === null) warnings.push('Allocation fixe f non renseignée');
    if (cost.otherPerOffer === null) warnings.push('Autres frais E non confirmés : verdict de marge au mieux « partiel »');
  }
  if (th && th.level === 'margin' && (!cost || cost.variablePerKm === null || cost.fixedPerHour === null)) {
    warnings.push('Seuils au niveau « marge » sans coûts complets : verdicts partiels');
  }
  const s = state.settings;
  for (const p of ['uber', 'bolt'] as const) {
    if (!s.platforms[p].confirmed) warnings.push(`Base du prix ${p === 'uber' ? 'Uber' : 'Bolt'} non confirmée : verdict au mieux « partiel »`);
  }
  if (missing.length) return { config: null, missing, warnings };
  const costProf = cost ?? { id: 'none', version: 0, effectiveFrom: new Date(0).toISOString(), variablePerKm: null, fixedPerHour: null, otherPerOffer: null };
  const config = buildFastConfig({
    cost: {
      id: costProf.id,
      version: costProf.version,
      effectiveFrom: costProf.effectiveFrom,
      variablePerKm: costProf.variablePerKm,
      fixedPerHour: costProf.fixedPerHour,
      otherPerOffer: costProf.otherPerOffer,
    },
    thresholds: { id: th!.id, version: th!.version, effectiveFrom: th!.effectiveFrom, level: th!.level, perKm: th!.perKm, perHour: th!.perHour },
    platforms: {
      uber: ruleFor(s.platforms.uber),
      bolt: ruleFor(s.platforms.bolt),
    },
    sessionPlatform: s.sessionPlatform,
    scenario: s.scenario,
    freshnessSec: s.freshnessSec,
    voice: s.voice,
    syncMode: s.syncMode,
    apiBase: s.apiBase,
  });
  return { config, missing, warnings };
}
