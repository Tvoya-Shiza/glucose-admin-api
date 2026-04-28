# CLAUDE.md (glucose-admin-api)

## Project

Glucose admin panel API. NestJS 11 + Prisma 6 (subset schema). Reads/writes the same MySQL as `glucose-api`.

## Critical rule: never own migrations

NEVER run `prisma migrate dev` or `prisma migrate deploy` here. Migrations live in glucose-api. Run them there, then run `npm run prisma:pull` here.

See PRISMA.md for the full workflow.

## Code style

Mirrors glucose-api:
- 4-space indents, single quotes, semis, 140-col print width.
- `noImplicitAny: false` (legacy posture; do not change without team review).
- DTO fields use snake_case (`user_id`, `school_id`) to match wire format.
- Required DTO fields use `!:` definite-assignment; optional use `?:`.
- Custom files: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.dto.ts`, `*.model.ts`, `*.guard.ts`, `*.interceptor.ts`, `*.middleware.ts`.

## BigInt convention

We always serialize BigInt as **string**. We do NOT import the global `BigInt.prototype.toJSON` patch from glucose-api. The admin-client expects strings consistently — never numbers.

Wired via `BigIntStringInterceptor` (global) in `src/main.ts`.

## apiResponse convention

- Mutation/single-resource endpoints wrap with `apiResponse(...)` from `src/common/utils/api-response.ts` (vendored verbatim from glucose-api).
- List endpoints (Phase 3+) return `{ rows, total, pageCount }` directly — TanStack Table on the admin-client consumes the raw shape.

## Security baseline

- helmet (X-Frame-Options, X-Content-Type-Options, HSTS) — global.
- CORS allowlist — NEVER `*`. `CORS_ORIGINS` env var is comma-separated.
- @nestjs/throttler — 100 req/min/IP global guard.
- ValidationPipe global with `whitelist: true, forbidNonWhitelisted: true, transform: true`.

## Prisma & migrations

Admin-api never runs migrations. See PRISMA.md for the full workflow.

Quick reference:
- Need a schema change? Make it in glucose-api, run migration there, then `npm run prisma:pull` here.
- Trying to run `npm run prisma:migrate:dev`? It will hard-fail.
- CI: `npm run ci:prisma-drift` and `npm run ci:forbid-migrations-dir` gate every PR.

## Shared types

Cross-repo TypeScript types live in `glucose-api/shared-types/` (the canonical source).
A vendored copy lives at `vendor/shared-types/` here, populated by
`scripts/sync-shared-types.sh` from the project root.

Import shared types via the path alias `@shared/*` configured in tsconfig.json.

Workflow:
1. Edit canonical types in `glucose-api/shared-types/`.
2. Run `bash ../scripts/sync-shared-types.sh` from the project root.
3. Commit canonical changes in glucose-api AND the updated `vendor/shared-types/.checksum` here.

CI runs `bash ../scripts/check-shared-types-sync.sh` to fail on drift.

DO NOT edit anything inside `vendor/shared-types/` directly. The sync script will overwrite your changes, and CI will reject any PR that touches it without a matching canonical update.

## Commands

```bash
npm install
npm run start:dev        # nest start --watch on PORT=4101
npm run build
npm run start:prod
npm run prisma:pull      # db pull + generate (only refresh path)
npm run ci:prisma-drift
npm run ci:forbid-migrations-dir
```
