# Prisma Discipline (admin-api)

Admin-api shares MySQL with glucose-api but **never owns migrations**.
The student API's `glucose-api/prisma/schema.prisma` is the single
source of truth for the database schema.

## `prisma db pull` is forbidden here

`npm run prisma:pull` has already broken production once — see commit
`84e840f`. The admin panel started returning 500 on the trainers list with
`Unknown field 'translations' for include on model 'QuizCategory'`.

The reason it is not safe here, and will not become safe: **many of these
tables have no physical foreign keys** (legacy schema). Prisma cannot infer a
relation it cannot see, so `db pull` silently deletes every hand-declared
`@relation` — 219 of them that time — and leaves a schema that still validates
and still generates. Nothing fails until a request hits one of the dropped
includes at runtime.

So the rule is inverted from the usual Prisma advice:

- **Editing `prisma/schema.prisma` by hand is the normal path.** Mirror the
  change from glucose-api's schema manually.
- **`npm run prisma:pull` is a last resort** that requires diffing the result
  against `HEAD` before committing, specifically checking that no `@relation`
  disappeared:
  ```bash
  git diff --stat prisma/schema.prisma
  git diff prisma/schema.prisma | grep '^-.*@relation' | head -50
  ```
  If that grep prints anything, the pull ate relations — throw the result away.

## Workflow

When the shared schema needs to change:

1. Land the change in `glucose-api/prisma/schema.prisma` and run the migration
   from `glucose-api/` (hand-written idempotent `phase-NN-*.sql` — see that
   repo's migration notes).
2. Mirror the same model/field change by hand in `glucose-admin-api/prisma/schema.prisma`,
   keeping the curated subset curated (only the models admin-api actually uses).
3. Run `npx prisma validate && npm run prisma:generate`.
4. Run `npm run ci:prisma-drift` — this is what proves your hand edit matches
   the live database.

## What is forbidden

- `npm run prisma:migrate*` — these scripts hard-fail with a guidance
  message (`scripts/forbid-migrate.cjs`).
- `npx prisma migrate *` invoked directly — works at the binary level
  but CI catches it via:
    - `scripts/ci-prisma-drift.sh` — runs `prisma migrate diff` against
      the live DB and fails on drift.
    - `scripts/ci-forbid-migrations-dir.sh` — fails if
      `prisma/migrations/` exists.
- `npm run prisma:pull` without the relation diff described above.

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
