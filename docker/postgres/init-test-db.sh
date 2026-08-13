#!/bin/bash
set -euo pipefail

# Creates the second database used by the integration and e2e suites.
#
# Runs only once, when Postgres initialises an empty data directory. To recreate
# it later:  docker compose down -v && docker compose up -d postgres
#
# The name MUST end in `_test` — tests/setup/db-guard.ts refuses to run against
# anything else (CLAUDE.md invariant 10).

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE agency_test OWNER $POSTGRES_USER;
EOSQL

echo "[init] created database agency_test"
