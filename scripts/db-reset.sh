#!/usr/bin/env bash
# Local only: drops and recreates the database, applies every migration, loads demo data.
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="psql -q -v ON_ERROR_STOP=1"
run() { su postgres -c "$*" 2>/dev/null || bash -c "$*"; }
run "$PSQL -d postgres -c 'drop database if exists meraghar with (force)' -c 'create database meraghar'"
for f in supabase/local/*.sql supabase/migrations/*.sql; do
  echo "applying $f"
  run "$PSQL -d meraghar -f $PWD/$f"
done
run "$PSQL -d meraghar -c 'grant anon, authenticated, service_role to meraghar_app' -c 'grant usage on schema auth to meraghar_app'"
node scripts/seed.mjs
