-- Tests d'isolation (RLS), de synchronisation et de quotas, exécutés sur PostgreSQL 16 local
-- avec des simulations minimales du schéma auth de Supabase (voir tools/test-db.sh).
-- Chaque bloc lève une exception en cas d'échec.
\set ON_ERROR_STOP on

insert into auth.users(id) values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');

-- Utilisateur A écrit
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.sync_push('[{"store":"expenses","record":{"id":"e1","updatedAt":"2026-10-08T10:00:00Z","amount":12.5,"date":"2026-10-08T09:00:00Z","category":"peage"}},
                          {"store":"trips","record":{"id":"t1","updatedAt":"2026-10-08T10:00:00Z","revenue":20,"date":"2026-10-08T09:00:00Z","status":"realisee"}}]'::jsonb);
do $$ begin
  if (select count(*) from public.expenses) <> 1 then raise exception 'A doit voir sa dépense'; end if;
  if (select amount from public.expenses where id = 'e1') <> 12.5 then raise exception 'colonne typée non remplie'; end if;
end $$;

-- Renvoi identique (coupure réseau simulée) : pas de doublon, séquence inchangée
select set_config('vtc.seq', (select server_seq::text from public.expenses where id = 'e1'), false);
select public.sync_push('[{"store":"expenses","record":{"id":"e1","updatedAt":"2026-10-08T10:00:00Z","amount":12.5,"date":"2026-10-08T09:00:00Z","category":"peage"}}]'::jsonb);
do $$ begin
  if (select count(*) from public.expenses) <> 1 then raise exception 'doublon après renvoi'; end if;
  if (select server_seq::text from public.expenses where id = 'e1') <> current_setting('vtc.seq') then raise exception 'renvoi identique a fait avancer la séquence'; end if;
end $$;
-- Configuration publiée : republication d'une ancienne version => redevient active
insert into public.fast_configs(config_id, data, published_at) values ('cfg-00000001', '{"v":1}', now() - interval '2 hours');
insert into public.fast_configs(config_id, data, published_at) values ('cfg-00000002', '{"v":2}', now() - interval '1 hour');
insert into public.fast_configs(config_id, data, published_at) values ('cfg-00000001', '{"v":1}', now())
  on conflict (user_id, config_id) do update set published_at = excluded.published_at;
do $$ begin
  if (select config_id from public.fast_configs order by published_at desc limit 1) <> 'cfg-00000001' then raise exception 'republication non prise en compte'; end if;
end $$;

-- Version plus ancienne ignorée, plus récente appliquée (LWW)
select public.sync_push('[{"store":"expenses","record":{"id":"e1","updatedAt":"2026-10-08T09:00:00Z","amount":99}}]'::jsonb);
do $$ begin
  if (select (data->>'amount')::numeric from public.expenses where id='e1') <> 12.5 then raise exception 'ancienne version appliquée'; end if;
end $$;
select public.sync_push('[{"store":"expenses","record":{"id":"e1","updatedAt":"2026-10-08T11:00:00Z","amount":13,"deleted":true}}]'::jsonb);
do $$ begin
  if not (select deleted from public.expenses where id='e1') then raise exception 'suppression non propagée'; end if;
end $$;

-- Utilisateur B : ne voit ni ne modifie les données de A
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  if (select count(*) from public.expenses) <> 0 then raise exception 'B voit les dépenses de A'; end if;
  if (select count(*) from public.trips) <> 0 then raise exception 'B voit les courses de A'; end if;
  if (select count(*) from public.sync_pull(0, 500)) <> 0 then raise exception 'B tire les données de A'; end if;
end $$;
-- Même identifiant "t1" chez B : crée une ligne distincte de B, n'écrase pas A
select public.sync_push('[{"store":"trips","record":{"id":"t1","updatedAt":"2026-10-09T10:00:00Z","revenue":1}}]'::jsonb);
update public.trips set data = '{"hack":true}'::jsonb where user_id = '11111111-1111-1111-1111-111111111111';
delete from public.trips where user_id = '11111111-1111-1111-1111-111111111111';
-- Tentative de changement de propriétaire
do $$ begin
  begin
    insert into public.expenses(user_id, id, data, updated_at) values ('11111111-1111-1111-1111-111111111111', 'x', '{}', now());
    raise exception 'insertion pour A acceptée';
  exception when insufficient_privilege then null; -- refus RLS attendu
  end;
end $$;
do $$ begin
  begin
    update public.trips set user_id = '11111111-1111-1111-1111-111111111111' where id = 't1';
    raise exception 'changement de propriétaire accepté';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Jetons d'appareil : hachage illisible par le client
select set_config('vtc.tok', public.create_device_token('iPhone B'), false); -- jeton transmis aux blocs suivants
do $$ begin
  begin
    perform token_hash from public.device_tokens;
    raise exception 'hachage lisible';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$ begin
  begin
    perform public.resolve_device_token('x', 'ingest', 30);
    raise exception 'resolve accessible au client';
  exception when insufficient_privilege then null;
  end;
end $$;
do $$ begin
  begin
    perform public.consume_ai_quota(auth.uid(), 1000, 1000);
    raise exception 'quota IA modifiable par le client';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Retour en A : ses données sont intactes
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  if (select (data->>'revenue')::numeric from public.trips where id='t1') <> 20 then raise exception 'données de A modifiées par B'; end if;
  if (select count(*) from public.sync_pull(0, 500)) <> 2 then raise exception 'tirage A incorrect'; end if;
end $$;

-- Anonyme : aucun accès
reset role;
set role anon;
do $$ begin
  begin
    perform count(*) from public.trips;
    raise exception 'anon lit les courses';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.sync_pull(0, 10);
    raise exception 'anon exécute sync_pull';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Rôle service : jeton, débit, ingestion idempotente, quotas IA
reset role;
set role service_role;
do $$
declare r record; ids text[];
begin
  select * into r from public.resolve_device_token(current_setting('vtc.tok'), 'ingest', 2);
  if r.user_id <> '22222222-2222-2222-2222-222222222222' or not r.allowed then raise exception 'jeton non résolu'; end if;
  select * into r from public.resolve_device_token(current_setting('vtc.tok'), 'ingest', 2);
  select * into r from public.resolve_device_token(current_setting('vtc.tok'), 'ingest', 2);
  if r.allowed then raise exception 'limite de débit non appliquée'; end if;
  select * into r from public.resolve_device_token('vtcd_faux', 'ingest', 30);
  if r.user_id is not null then raise exception 'faux jeton accepté'; end if;
  ids := public.ingest_analyses('22222222-2222-2222-2222-222222222222', '[{"id":"req-1","capturedAt":"2026-10-08T10:00:00Z","analyzedAt":"2026-10-08T10:00:00.3Z","source":"shortcut","offer":{"platform":{"value":"uber"}},"verdict":{"verdict":"limite"}}]');
  ids := public.ingest_analyses('22222222-2222-2222-2222-222222222222', '[{"id":"req-1","capturedAt":"2026-10-08T10:00:00Z","analyzedAt":"2026-10-08T10:00:00.3Z","source":"shortcut","offer":{"platform":{"value":"uber"}},"verdict":{"verdict":"limite"}}]');
  if (select count(*) from public.offers where id = 'req-1') <> 1 then raise exception 'ingestion non idempotente'; end if;
  if (select verdict from public.offers where id = 'req-1') <> 'limite' then raise exception 'verdict non stocké'; end if;
  -- Quotas : limite utilisateur 3, globale 4
  for i in 1..3 loop
    if not public.consume_ai_quota('11111111-1111-1111-1111-111111111111', 3, 4) then raise exception 'quota refusé trop tôt'; end if;
  end loop;
  if public.consume_ai_quota('11111111-1111-1111-1111-111111111111', 3, 4) then raise exception 'quota utilisateur dépassé'; end if;
  if not public.consume_ai_quota('22222222-2222-2222-2222-222222222222', 3, 4) then raise exception 'quota global refusé trop tôt'; end if;
  if public.consume_ai_quota('22222222-2222-2222-2222-222222222222', 3, 4) then raise exception 'quota global dépassé'; end if;
end $$;

-- Révocation
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.revoke_device_token((select id from public.device_tokens limit 1));
reset role;
set role service_role;
do $$ declare r record; begin
  select * into r from public.resolve_device_token(current_setting('vtc.tok'), 'ingest', 30);
  if r.user_id is not null then raise exception 'jeton révoqué encore accepté'; end if;
end $$;

-- B tire l'offre ingérée
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  if (select count(*) from public.sync_pull(0, 500) where store = 'offers') <> 1 then raise exception 'offre ingérée non tirée'; end if;
end $$;

select 'RLS_TESTS_OK' as result;
