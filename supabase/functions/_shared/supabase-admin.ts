// Client serveur (Deno). La clé secrète vient des variables d'environnement de Supabase,
// jamais du navigateur ni du raccourci.
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

declare const Deno: { env: { get(k: string): string | undefined } };

export function secretKey(): string {
  const dict = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (dict) {
    try {
      const o = JSON.parse(dict) as Record<string, string>;
      if (o.default) return o.default;
      const first = Object.values(o)[0];
      if (first) return first;
    } catch { /* format inattendu : repli */ }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('Clé secrète Supabase absente');
  return legacy;
}

export function publishableKey(): string {
  const dict = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (dict) {
    try {
      const o = JSON.parse(dict) as Record<string, string>;
      return o.default ?? Object.values(o)[0];
    } catch { /* repli */ }
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? '';
}

export function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}
