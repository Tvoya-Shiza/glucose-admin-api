#!/usr/bin/env bash
# glucose-admin-api/scripts/ci-forbid-migrations-dir.sh
# Per FND-02 success criterion 3: CI fails any PR that creates prisma/migrations/.
set -euo pipefail

if [[ -d prisma/migrations ]]; then
  echo "FAIL: glucose-admin-api/prisma/migrations/ exists." >&2
  echo "Migrations live in glucose-api. Delete the directory and re-run 'npm run prisma:pull'." >&2
  ls -la prisma/migrations >&2
  exit 1
fi

if [[ -d prisma/_migrations ]]; then
  echo "FAIL: glucose-admin-api/prisma/_migrations/ exists (likely a Prisma fork)." >&2
  exit 1
fi

echo "OK: no prisma/migrations directory present."
