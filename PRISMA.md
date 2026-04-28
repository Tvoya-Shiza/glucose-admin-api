# Prisma Discipline (admin-api)

Admin-api shares MySQL with glucose-api but **never owns migrations**.
The student API's `glucose-api/prisma/schema.prisma` is the single
source of truth for the database schema.

## Workflow

When the shared schema needs to change:

1. Land the change in `glucose-api/prisma/schema.prisma` and run
   `npx prisma migrate dev --name <description>` from `glucose-api/`.
2. After the migration is applied to MySQL, run from `glucose-admin-api/`:
   ```bash
   npm run prisma:pull
   ```
   This runs `prisma db pull && prisma generate`, syncing
   admin-api's curated subset schema with the live DB.
3. If `db pull` brought in models you don't want exposed in admin-api,
   trim them out manually. Re-run `npx prisma validate` and
   `npm run prisma:generate`.

## What is forbidden

- `npm run prisma:migrate*` — these scripts hard-fail with a guidance
  message (`scripts/forbid-migrate.cjs`).
- `npx prisma migrate *` invoked directly — works at the binary level
  but CI catches it via:
    - `scripts/ci-prisma-drift.sh` — runs `prisma migrate diff` against
      the live DB and fails on drift.
    - `scripts/ci-forbid-migrations-dir.sh` — fails if
      `prisma/migrations/` exists.
- Editing `prisma/schema.prisma` by hand — the only legitimate edits
  are removing models you do not need (curated subset). All structural
  changes must come from `db pull`.

## Connection-pool budget

`DATABASE_URL` carries `?connection_limit=5` (per FND-04) so admin-api's
Prisma pool stays small. Cluster total: glucose-api (4 instances × ~10
each) + admin-api (1 × 5) = ~45 connections. If you change this number,
coordinate with glucose-api's deploy and update PRISMA.md.

## CI integration

Run in any CI provider:
```bash
npm run ci:prisma-drift              # exits 1 on schema-DB drift
npm run ci:forbid-migrations-dir     # exits 1 if migrations/ exists
```
Both scripts also run as part of the standard CI pipeline; see your
CI provider config (GitHub Actions / GitLab / Drone / etc.).
