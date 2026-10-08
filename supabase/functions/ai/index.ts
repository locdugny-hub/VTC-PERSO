// Fonction "ai" : appels Gemini protégés. Clé Gemini uniquement dans les secrets Supabase (GEMINI_API_KEY).
// verify_jwt = false dans config.toml : le JWT utilisateur est vérifié ici (getClaims, clés de signature asymétriques).
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { handleAi, DEFAULT_AI_CONFIG } from '../_shared/ai.ts';
import { admin, publishableKey } from '../_shared/supabase-admin.ts';

declare const Deno: { serve(h: (r: Request) => Response | Promise<Response>): void; env: { get(k: string): string | undefined } };

const KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://vtc-perso-lolo.netlify.app';
const num = (k: string, d: number) => {
  const v = Number(Deno.env.get(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};
const CFG = {
  ...DEFAULT_AI_CONFIG,
  model: Deno.env.get('GEMINI_MODEL') ?? DEFAULT_AI_CONFIG.model,
  userDailyLimit: num('AI_USER_DAILY_LIMIT', DEFAULT_AI_CONFIG.userDailyLimit),
  globalDailyLimit: num('AI_GLOBAL_DAILY_LIMIT', DEFAULT_AI_CONFIG.globalDailyLimit),
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors: Record<string, string> = ORIGIN && origin === ORIGIN
    ? { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'origin' }
    : {};
  const db = admin();
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { auth: { persistSession: false } });
  try {
    return await handleAi(req, {
      hasKey: KEY.length > 0,
      async verifyUser(authorization) {
        const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
        if (!token) return null;
        const { data, error } = await authClient.auth.getClaims(token);
        const sub = data?.claims?.sub;
        if (error || !sub || data?.claims?.role !== 'authenticated') return null;
        return { userId: sub };
      },
      async consumeQuota(userId, u, g) {
        const { data, error } = await db.rpc('consume_ai_quota', { p_user: userId, p_user_limit: u, p_global_limit: g });
        return !error && data === true;
      },
      async callGemini(model, body, signal) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
          body: JSON.stringify(body),
          signal,
        });
        return { status: r.status, json: r.ok ? await r.json() : null };
      },
    }, CFG, cors);
  } catch {
    return new Response(JSON.stringify({ error: 'Erreur serveur' }), { status: 500, headers: { 'content-type': 'application/json', ...cors } });
  }
});
