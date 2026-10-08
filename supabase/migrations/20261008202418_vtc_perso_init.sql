-- VTC Perso : schéma initial. Données personnelles privées, RLS sur toutes les tables exposées.
-- Chaque table métier conserve l'enregistrement complet (data jsonb, versionné côté client)
-- et quelques colonnes typées pour les requêtes et contrôles.

create extension if not exists pgcrypto with schema extensions;

create sequence if not exists public.sync_seq;
revoke all on sequence public.sync_seq from public, anon;
grant usage on sequence public.sync_seq to authenticated, service_role;

-- Fonction de déclenchement : numéro de séquence serveur à chaque écriture (tirage incrémental).
create or replace function public.tg_set_server_seq() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.server_seq := nextval('public.sync_seq');
  new.server_updated_at := now();
  return new;
end $$;

-- Gabarit commun ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vehicles','cost_profiles','thresholds','offers','trips','sessions','expenses','settings'] loop
    execute format($f$
      create table if not exists public.%I (
        user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
        id text not null check (length(id) between 1 and 128),
        data jsonb not null check (pg_column_size(data) < 200000),
        updated_at timestamptz not null,
        deleted boolean not null default false,
        server_seq bigint not null default 0,
        server_updated_at timestamptz not null default now(),
        primary key (user_id, id)
      )$f$, t);
    execute format('create index if not exists %I on public.%I (user_id, server_seq)', t || '_seq_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger set_seq before insert or update on public.%I for each row execute function public.tg_set_server_seq()', t);
    execute format('create policy own_select on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy own_insert on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy own_update on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy own_delete on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Colonnes typées utiles (remplies par sync_push / ingestion)
alter table public.offers add column if not exists captured_at timestamptz;
alter table public.offers add column if not exists platform text;
alter table public.offers add column if not exists status text;
alter table public.offers add column if not exists verdict text;
alter table public.offers add column if not exists source text;
alter table public.trips add column if not exists revenue numeric(12,2);
alter table public.trips add column if not exists trip_date timestamptz;
alter table public.trips add column if not exists status text;
alter table public.expenses add column if not exists amount numeric(12,2);
alter table public.expenses add column if not exists expense_date timestamptz;
alter table public.expenses add column if not exists category text;
alter table public.sessions add column if not exists started_at timestamptz;
alter table public.sessions add column if not exists ended_at timestamptz;

-- Synchronisation : envoi avec "dernier écrivain gagnant", exécuté avec les droits de l'appelant (RLS).
create or replace function public.sync_push(rows jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb;
  st text;
  tbl text;
  rec jsonb;
  acks jsonb := '[]'::jsonb;
  uid uuid := auth.uid();
  changed int;
  mapping constant jsonb := '{"vehicles":"vehicles","costProfiles":"cost_profiles","thresholds":"thresholds","offers":"offers","trips":"trips","sessions":"sessions","expenses":"expenses","settings":"settings"}';
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then raise exception 'invalid batch'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    st := r->>'store';
    tbl := mapping->>st;
    rec := r->'record';
    if tbl is null or rec->>'id' is null or rec->>'updatedAt' is null then raise exception 'invalid row'; end if;
    execute format($q$
      insert into public.%I as t (user_id, id, data, updated_at, deleted)
      values ($1, $2, $3, ($4)::timestamptz, coalesce(($5)::boolean, false))
      on conflict (user_id, id) do update
        set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
        where excluded.updated_at > t.updated_at
           or (excluded.updated_at = t.updated_at and excluded.deleted and not t.deleted)
    $q$, tbl) using uid, rec->>'id', rec, rec->>'updatedAt', rec->>'deleted';
    get diagnostics changed = row_count;
    -- colonnes typées, seulement si la ligne a réellement changé (un renvoi identique ne fait pas avancer la séquence)
    if changed = 0 then
      null;
    elsif tbl = 'offers' then
      update public.offers set captured_at = (rec->>'capturedAt')::timestamptz, platform = rec->>'platform', status = rec->>'status',
        verdict = coalesce(rec#>>'{corrected,verdict,verdict}', rec#>>'{original,verdict,verdict}'), source = rec->>'source'
      where user_id = uid and id = rec->>'id' and data = rec;
    elsif tbl = 'trips' then
      update public.trips set revenue = (rec->>'revenue')::numeric, trip_date = (rec->>'date')::timestamptz, status = rec->>'status'
      where user_id = uid and id = rec->>'id' and data = rec;
    elsif tbl = 'expenses' then
      update public.expenses set amount = (rec->>'amount')::numeric, expense_date = (rec->>'date')::timestamptz, category = rec->>'category'
      where user_id = uid and id = rec->>'id' and data = rec;
    elsif tbl = 'sessions' then
      update public.sessions set started_at = (rec->>'startedAt')::timestamptz, ended_at = (rec->>'endedAt')::timestamptz
      where user_id = uid and id = rec->>'id' and data = rec;
    end if;
    acks := acks || jsonb_build_object('store', st, 'id', rec->>'id', 'updatedAt', rec->>'updatedAt');
  end loop;
  return acks;
end $$;

-- Tirage incrémental : lignes de l'utilisateur dont la séquence dépasse le curseur.
create or replace function public.sync_pull(after_seq bigint, max_rows int default 200)
returns table(store text, record jsonb, server_seq bigint)
language sql stable security invoker set search_path = '' as $$
  select * from (
    select 'vehicles', data || jsonb_build_object('deleted', deleted), server_seq from public.vehicles where user_id = auth.uid() and server_seq > after_seq
    union all select 'costProfiles', data || jsonb_build_object('deleted', deleted), server_seq from public.cost_profiles where user_id = auth.uid() and server_seq > after_seq
    union all select 'thresholds', data || jsonb_build_object('deleted', deleted), server_seq from public.thresholds where user_id = auth.uid() and server_seq > after_seq
    union all select 'offers', data || jsonb_build_object('deleted', deleted), server_seq from public.offers where user_id = auth.uid() and server_seq > after_seq
    union all select 'trips', data || jsonb_build_object('deleted', deleted), server_seq from public.trips where user_id = auth.uid() and server_seq > after_seq
    union all select 'sessions', data || jsonb_build_object('deleted', deleted), server_seq from public.sessions where user_id = auth.uid() and server_seq > after_seq
    union all select 'expenses', data || jsonb_build_object('deleted', deleted), server_seq from public.expenses where user_id = auth.uid() and server_seq > after_seq
    union all select 'settings', data || jsonb_build_object('deleted', deleted), server_seq from public.settings where user_id = auth.uid() and server_seq > after_seq
  ) s(store, record, server_seq)
  order by server_seq
  limit least(greatest(max_rows, 1), 500);
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
revoke all on function public.sync_pull(bigint, int) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, int) to authenticated;

-- Configuration publiée pour la variante serveur du raccourci ------------------
create table if not exists public.fast_configs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  config_id text not null,
  data jsonb not null check (pg_column_size(data) < 20000),
  created_at timestamptz not null default now(),
  -- Date de (re)publication : la variante serveur utilise la configuration publiée en dernier,
  -- y compris si l'utilisateur revient à une configuration plus ancienne.
  published_at timestamptz not null default now(),
  primary key (user_id, config_id)
);
alter table public.fast_configs enable row level security;
create policy fc_select on public.fast_configs for select to authenticated using (user_id = (select auth.uid()));
create policy fc_insert on public.fast_configs for insert to authenticated with check (user_id = (select auth.uid()));
create policy fc_update on public.fast_configs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.fast_configs from anon;
grant select, insert, update on public.fast_configs to authenticated;

-- Jetons d'appareil (raccourci) : révocables, limités, stockés hachés ---------------
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null check (length(label) between 1 and 60),
  token_hash text not null unique,
  scopes text[] not null default array['ingest','analyze'],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default now() + interval '1 year'
);
alter table public.device_tokens enable row level security;
create policy dt_select on public.device_tokens for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.device_tokens from anon, authenticated;
-- Le hachage n'est jamais lisible par le navigateur.
grant select (id, label, scopes, created_at, last_used_at, revoked_at, expires_at) on public.device_tokens to authenticated;

create or replace function public.create_device_token(p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  tok text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtext('device_tokens:' || uid::text)); -- limite fiable même en appels simultanés
  if (select count(*) from public.device_tokens where user_id = uid and revoked_at is null) >= 5 then
    raise exception 'Trop de jetons actifs (5 maximum) : révoquez-en un.';
  end if;
  tok := 'vtcd_' || translate(encode(extensions.gen_random_bytes(30), 'base64'), '+/=', '-_');
  insert into public.device_tokens(user_id, label, token_hash)
  values (uid, left(coalesce(nullif(trim(p_label), ''), 'iPhone'), 60), encode(extensions.digest(tok, 'sha256'), 'hex'));
  return tok; -- affiché une seule fois
end $$;

create or replace function public.revoke_device_token(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.device_tokens set revoked_at = now() where id = p_id and user_id = auth.uid() and revoked_at is null;
end $$;

revoke all on function public.create_device_token(text) from public, anon;
revoke all on function public.revoke_device_token(uuid) from public, anon;
grant execute on function public.create_device_token(text) to authenticated;
grant execute on function public.revoke_device_token(uuid) to authenticated;

-- Résolution d'un jeton + limitation de débit (appelée UNIQUEMENT par la fonction serveur, rôle service).
create table if not exists public.device_rate (
  token_id uuid not null references public.device_tokens(id) on delete cascade,
  minute timestamptz not null,
  n int not null default 0,
  primary key (token_id, minute)
);
alter table public.device_rate enable row level security; -- aucune politique : inaccessible aux clients

create or replace function public.resolve_device_token(p_token text, p_scope text, p_limit_per_min int default 30)
returns table(user_id uuid, token_id uuid, allowed boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  t record;
  cnt int;
begin
  select dt.id, dt.user_id into t from public.device_tokens dt
  where dt.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and dt.revoked_at is null and dt.expires_at > now() and p_scope = any(dt.scopes);
  if not found then return; end if;
  insert into public.device_rate(token_id, minute, n) values (t.id, date_trunc('minute', now()), 1)
  on conflict (token_id, minute) do update set n = public.device_rate.n + 1
  returning n into cnt;
  update public.device_tokens set last_used_at = now() where id = t.id;
  delete from public.device_rate where minute < now() - interval '1 hour';
  return query select t.user_id, t.id, cnt <= p_limit_per_min;
end $$;
revoke all on function public.resolve_device_token(text, text, int) from public, anon, authenticated;
grant execute on function public.resolve_device_token(text, text, int) to service_role;

-- Ingestion des analyses du raccourci (rôle service, après résolution du jeton).
create or replace function public.ingest_analyses(p_user uuid, p_analyses jsonb) returns text[]
language plpgsql security definer set search_path = '' as $$
declare a jsonb; ids text[] := '{}'; now_ts timestamptz := now();
begin
  if jsonb_typeof(p_analyses) <> 'array' or jsonb_array_length(p_analyses) > 100 then raise exception 'invalid batch'; end if;
  for a in select * from jsonb_array_elements(p_analyses) loop
    if a->>'id' is null or a->>'capturedAt' is null then continue; end if;
    begin
    insert into public.offers(user_id, id, data, updated_at, deleted, captured_at, platform, status, verdict, source)
    values (p_user, a->>'id',
      jsonb_build_object('id', a->>'id', 'updatedAt', a->>'analyzedAt', 'capturedAt', a->>'capturedAt',
        'platform', coalesce(a#>>'{offer,platform,value}', 'unknown'), 'source', a->>'source', 'original', a,
        'corrected', null, 'corrections', '[]'::jsonb, 'status', 'analysee',
        'statusHistory', jsonb_build_array(jsonb_build_object('status','analysee','at', a->>'analyzedAt')),
        'sessionId', null, 'tripId', null, 'timing', null),
      (a->>'analyzedAt')::timestamptz, false, (a->>'capturedAt')::timestamptz,
      coalesce(a#>>'{offer,platform,value}', 'unknown'), 'analysee', a#>>'{verdict,verdict}', a->>'source')
    on conflict (user_id, id) do nothing; -- idempotent : un renvoi ne crée pas de doublon et n'écrase pas une offre déjà modifiée
    ids := ids || (a->>'id');
    exception when others then
      null; -- une ligne invalide (date illisible...) n'empêche pas l'ingestion des autres
    end;
  end loop;
  return ids;
end $$;
revoke all on function public.ingest_analyses(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_analyses(uuid, jsonb) to service_role;

-- Quotas IA : compteurs atomiques (sûrs en appels simultanés), par utilisateur et global.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
create table if not exists public.ai_usage_global (day date primary key, n int not null default 0);
alter table public.ai_usage enable row level security;
alter table public.ai_usage_global enable row level security;
create policy ai_usage_select on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
revoke all on public.ai_usage_global from anon, authenticated;

create or replace function public.consume_ai_quota(p_user uuid, p_user_limit int, p_global_limit int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare u int; g int; d date := (now() at time zone 'America/Los_Angeles')::date; -- même remise à zéro que les quotas Gemini (minuit, heure du Pacifique)
begin
  insert into public.ai_usage_global(day, n) values (d, 1)
  on conflict (day) do update set n = public.ai_usage_global.n + 1 where public.ai_usage_global.n < p_global_limit
  returning n into g;
  if g is null then return false; end if;
  insert into public.ai_usage(user_id, day, n) values (p_user, d, 1)
  on conflict (user_id, day) do update set n = public.ai_usage.n + 1 where public.ai_usage.n < p_user_limit
  returning n into u;
  if u is null then
    update public.ai_usage_global set n = n - 1 where day = d; -- rend l'unité globale non utilisée
    return false;
  end if;
  return true;
end $$;
revoke all on function public.consume_ai_quota(uuid, int, int) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, int, int) to service_role;
