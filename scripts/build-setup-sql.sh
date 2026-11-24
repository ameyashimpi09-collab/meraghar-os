#!/usr/bin/env bash
# Rebuilds supabase/setup.sql (fresh install) and supabase/release2.sql from the migrations.
set -euo pipefail
cd "$(dirname "$0")/.."
{ echo "-- MERAGHAR OS — DATABASE SETUP (run once in Supabase → SQL Editor). Generated from supabase/migrations."
  for f in supabase/migrations/*.sql; do echo; echo "-- >>> $f"; cat "$f"; done; } > supabase/setup.sql
cp supabase/migrations/0004_release2.sql supabase/release2.sql
