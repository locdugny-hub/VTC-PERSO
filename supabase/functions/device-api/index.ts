// Fonction "device-api" : appelée par le raccourci (jeton d'appareil, pas de JWT).
// verify_jwt = false dans config.toml : l'authentification est faite ici par le jeton haché.
import { handleDevice } from '../_shared/device.ts';
import { admin } from '../_shared/supabase-admin.ts';

declare const Deno: { serve(h: (r: Request) => Response | Promise<Response>): void };

Deno.serve(async (req) => {
  const db = admin();
  try {
    return await handleDevice(req, {
      now: () => new Date(),
      async resolveToken(token, scope) {
        const { data, error } = await db.rpc('resolve_device_token', { p_token: token, p_scope: scope, p_limit_per_min: 30 });
        if (error || !data || !data.length) return null;
        return { userId: data[0].user_id, tokenId: data[0].token_id, allowed: data[0].allowed };
      },
      async ingest(userId, analyses) {
        const { data, error } = await db.rpc('ingest_analyses', { p_user: userId, p_analyses: analyses });
        if (error) throw new Error('ingestion');
        return data as string[];
      },
      async latestConfig(userId) {
        const { data } = await db.from('fast_configs').select('data').eq('user_id', userId).order('published_at', { ascending: false }).limit(1);
        return data && data[0] ? data[0].data : null;
      },
    });
  } catch {
    // Pas de contenu sensible dans les journaux.
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
