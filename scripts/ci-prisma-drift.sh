#!/usr/bin/env bash
# glucose-admin-api/scripts/ci-prisma-drift.sh
# Per FND-03: fails CI if the curated subset schema diverges from the live DB.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set for drift check" >&2
  exit 2
fi

echo "Running Prisma drift check (admin-api subset vs shared MySQL)..."

# --exit-code: 0 = no diff; 2 = diff found
if npx prisma migrate diff \
     --from-schema-datamodel prisma/schema.prisma \
     --to-schema-datasource "$DATABASE_URL" \
     --exit-code; then
  echo "OK: admin-api schema matches the live DB."
  exit 0
else
  echo ""
  echo "FAIL: admin-api/prisma/schema.prisma is out of sync with the live DB." >&2
  echo "Either:"
  echo "  1. The DB changed (glucose-api ran a migration). Run 'npm run prisma:pull' here, then re-trim to the subset."
  echo "  2. The subset schema was edited by hand. That is forbidden - only db pull is allowed."
  exit 1
fi
