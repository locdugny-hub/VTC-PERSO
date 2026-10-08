// Supabase côté navigateur : uniquement l'URL du projet et la clé PUBLIABLE (prévue pour le navigateur,
// protégée par RLS). Aucune clé secrète, aucune clé Gemini ici.
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RemoteAdapter, RemoteRow } from '../core/sync';
import type { StoreName } from '../core/domain';
import type { FastConfig } from '../core/types';

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '';

let client: SupabaseClient | null = null;

export const cloudConfigured = () => URL_.startsWith('https://') && KEY.length > 10;

export function sb(): SupabaseClient | null {
  if (!cloudConfigured()) return null;
  if (!client) client = createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  return client;
}

export const functionsBase = () => (cloudConfigured() ? URL_.replace(/\/$/, '') + '/functions/v1' : null);

export async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  const c = sb();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  const u = data.session?.user;
  return u ? { id: u.id, email: u.email ?? null } : null;
}

export async function signInGoogle() {
  const c = sb();
  if (!c) throw new Error('Supabase non configuré');
  const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
}

export async function signOut() {
  await sb()?.auth.signOut();
}

/** Recouvrement du tirage : compense d'éventuels numéros de séquence validés dans le désordre (fusion idempotente). */
const PULL_OVERLAP = 50;

export function remoteAdapter(): RemoteAdapter {
  const c = sb();
  if (!c) throw new Error('Supabase non configuré');
  return {
    async push(rows) {
      if (!rows.length) return [];
      const { data, error } = await c.rpc('sync_push', { rows });
      if (error) throw new Error(error.message);
      return data as { store: StoreName; id: string; updatedAt: string }[];
    },
    async pull(afterSeq, limit) {
      const { data, error } = await c.rpc('sync_pull', { after_seq: Math.max(0, afterSeq - PULL_OVERLAP), max_rows: limit });
      if (error) throw new Error(error.message);
      const rows = (data as { store: StoreName; record: RemoteRow['record']; server_seq: number }[]).map((r) => ({ store: r.store, record: r.record, serverSeq: Number(r.server_seq) }));
      // Les lignes du recouvrement (déjà vues) sont renvoyées : la fusion LWW les rend sans effet,
      // et une ligne validée tardivement avec un numéro inférieur au curseur est ainsi rattrapée.
      // Le recouvrement (50) reste inférieur à la taille de lot (200) : la boucle de tirage se termine.
      return rows;
    },
  };
}

export async function publishConfig(cfg: FastConfig) {
  const c = sb();
  if (!c) throw new Error('Supabase non configuré');
  const { error } = await c.from('fast_configs').upsert({ config_id: cfg.configId, data: cfg, published_at: new Date().toISOString() }, { onConflict: 'user_id,config_id' });
  if (error) throw new Error(error.message);
}

export async function createDeviceToken(label: string): Promise<string> {
  const c = sb();
  if (!c) throw new Error('Supabase non configuré');
  const { data, error } = await c.rpc('create_device_token', { p_label: label });
  if (error) throw new Error(error.message);
  return data as string;
}
export async function listDeviceTokens() {
  const c = sb();
  if (!c) return [];
  const { data } = await c.from('device_tokens').select('id,label,created_at,last_used_at,revoked_at').order('created_at', { ascending: false });
  return (data ?? []) as { id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[];
}
export async function revokeDeviceToken(id: string) {
  const { error } = await sb()!.rpc('revoke_device_token', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function aiUsageToday(): Promise<number | null> {
  const c = sb();
  if (!c) return null;
  // Le compteur serveur est remis à zéro à minuit, heure du Pacifique (comme les quotas Gemini).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const { data } = await c.from('ai_usage').select('day,n').eq('day', today).limit(1);
  return data && data[0] ? (data[0].n as number) : 0;
}

export async function invokeAi(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const c = sb();
  if (!c) return { ok: false, status: 0, data: { error: 'Supabase non configuré' } };
  if (!navigator.onLine) return { ok: false, status: 0, data: { error: 'Hors connexion : fonction IA indisponible' } };
  const { data: s } = await c.auth.getSession();
  if (!s.session) return { ok: false, status: 401, data: { error: 'Connexion requise' } };
  const r = await fetch(functionsBase() + '/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + s.session.access_token, apikey: KEY },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = await r.json();
  } catch {
    data = { error: 'Réponse illisible' };
  }
  return { ok: r.ok, status: r.status, data };
}
