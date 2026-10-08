#!/usr/bin/env bash
# Exécute la migration et les tests RLS sur un PostgreSQL 16 local jetable,
# avec une simulation minimale du schéma "auth" et des rôles de Supabase.
# Ce n'est pas un projet Supabase : la vérification finale se fait aussi sur le projet réel (docs/INSTALLATION.md).
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=$(mktemp -d)
PORT=${PORT:-54329}
cleanup() { "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; chown -R postgres "$DIR"; else RUN=""; fi
$RUN "$PGBIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL="$RUN psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema extensions;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
SQL
$PSQL -d postgres -f "$(dirname "$0")/../supabase/migrations/20261008202418_vtc_perso_init.sql"
$PSQL -d postgres -c "grant all on all tables in schema public to service_role; grant usage on all sequences in schema public to authenticated, service_role;"
cp "$(dirname "$0")/../supabase/tests/rls_test.sql" "$DIR/t.sql"
chmod 644 "$DIR/t.sql"
$PSQL -d postgres -f "$DIR/t.sql"
# Appels simultanés : 20 connexions parallèles pour une limite de 10 => exactement 10 acceptés.
$PSQL -d postgres -c "insert into auth.users(id) values ('33333333-3333-3333-3333-333333333333')"
for i in $(seq 1 20); do
  ($RUN psql -h "$DIR" -p "$PORT" -U postgres -d postgres -tAq -c "set role service_role; select public.consume_ai_quota('33333333-3333-3333-3333-333333333333', 10, 1000)" > "$DIR/q$i" 2>&1) &
done
wait
OK=$(cat "$DIR"/q* | grep -c '^t$' || true)
echo "Quota concurrent : $OK appels acceptés sur 20 (limite 10)"
[ "$OK" = "10" ] || { echo "ECHEC quota concurrent"; exit 1; }
echo CONCURRENCY_OK
