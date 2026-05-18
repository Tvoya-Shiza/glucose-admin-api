# CLAUDE.md (glucose-admin-api)

## Project

Glucose admin panel API. NestJS 11 + Prisma 6 (subset schema). Reads/writes the same MySQL as `glucose-api`.

## Critical rule: never own migrations

NEVER run `prisma migrate dev` or `prisma migrate deploy` here. Migrations live in glucose-api. Run them there, then run `npm run prisma:pull` here.

See PRISMA.md for the full workflow.

## RBAC (Phase 11)

Permissions are managed at runtime through `/access/roles` UI. Three core roles (`admin`/`curator`/`teacher`) plus optional custom roles. `code='admin'` is super-bypass — `PermissionsService.can()` returns true unconditionally for admins, no `role_permissions` rows are written for them.

Gating an endpoint:
```ts
@Roles('admin', 'curator')
@RequirePermission('users.create')          // optional; default-pass if omitted
@Audit('user.create', 'user')
```

Full reference + how-to: [docs/access-control.md](./docs/access-control.md).

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

## Auth + RBAC + Audit (Phase 2)

### Auth flow

Staff log in via `POST /admin-api/auth/login` with `{ email, password }`. The handler:
- Defensively `findMany`s on `User.email` (HARD-13 unique constraint blocked); rejects ambiguous matches with `auth.ambiguous`.
- Verifies bcryptjs.compare against `User.password`.
- Enforces `STAFF_ROLES.includes(role_name)` (admin / curator / teacher; student is rejected).
- Issues a 15-min access JWT and a 7-day refresh JWT (HS256, kid='admin-v1').
- Writes the refresh `jti` to Redis at `geonline-admin:refresh:<jti>` (TTL 604800s).
- Sets `Set-Cookie: glc_admin_at` and `glc_admin_rt` (HttpOnly, SameSite=Lax, Secure in prod).

`POST /admin-api/auth/refresh` rotates the jti atomically via Redis MULTI/EXEC.
`POST /admin-api/auth/logout` deletes the jti (idempotent) and is `@Audit`-logged.
`GET /admin-api/auth/me` returns `{ user_id, email, role_name }`.

Throttler: `/login` and `/refresh` are capped at 5 requests / 15 minutes / IP.

### RBAC

Every controller method MUST carry either `@Roles('admin', 'curator', 'teacher')` (or a subset) or `@Public()`. `RolesGuard` default-denies handlers without `@Roles()` to fail closed.

Scope helpers live at `src/common/scoping/scope.helper.ts`. Phase 3+ feature modules ship per-feature `*.scope.ts` files implementing `ScopeRules` (admin sees all by default; curator/teacher narrow via Prisma `where` fragment). Call sites spread the result:

```ts
prisma.user.findMany({
    where: { ...filters, ...buildScopeWhere(actor, USER_SCOPE_RULES) },
});
```

### Audit log

Every non-GET controller method MUST carry `@Audit(action, entity)` from `src/common/audit/audit.decorator.ts` — or `@SkipAudit('non-empty reason')` to opt out. The CI lint at `scripts/ci-audit-decorator-check.cjs` (run via `npm run ci:audit-required`) walks every `src/modules/**/*.controller.ts` via the TypeScript Compiler API and exits 1 on missing decorators or empty skip reasons.

Note: `@Public()` is NOT recognized by the audit lint — public POST endpoints (e.g. `/auth/login`, `/auth/refresh`) MUST still carry `@SkipAudit('public auth endpoint — no authenticated actor at this stage')` to satisfy the lint, even though no actor is available to log.

The interceptor writes one NDJSON line per mutation to `logs/admin-audit.log` (5MB × 10 rotate). Shape locked to `{ ts, actor_id, action, entity, entity_id, ip, ua, before?, after?, meta? }` so the eventual replay into `AdminAuditLog` (when SCH-01 lands) is a straight insert.

### Files (Phase 2)

- `src/common/audit/{audit.decorator,audit.interceptor,audit.logger,audit.types}.ts`
- `src/common/scoping/{scope.helper,scope.types}.ts`
- `src/modules/auth/auth.{module,controller,service}.ts`
- `src/modules/auth/jwt/{jwt.module-config,jwt.strategy}.ts`
- `src/modules/auth/guards/{jwt.guard,roles.guard}.ts`
- `src/modules/auth/decorators/{roles.decorator,current-user.decorator}.ts`
- `src/modules/auth/dto/{login.dto,refresh.dto,logout.dto}.ts`
- `src/modules/auth/refresh-token.repo.ts`
- `src/modules/redis/redis.module.ts`
- `scripts/ci-audit-decorator-check.cjs` + `scripts/__fixtures__/`

## Commands

```bash
npm install
npm run start:dev        # nest start --watch on PORT=4101
npm run build
npm run start:prod
npm run prisma:pull      # db pull + generate (only refresh path)
npm run ci:prisma-drift
npm run ci:audit-required
npm run ci:forbid-migrations-dir
```
