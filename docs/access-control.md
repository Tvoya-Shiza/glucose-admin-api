# Access Control (RBAC)

Phase 11. Granular RBAC with a UI-managed permission matrix. Replaces the era when access was decided purely by hardcoded `@Roles('admin','curator','teacher')` on each endpoint.

## Concepts

- **Role** — a named group of users (`admin`, `curator`, `teacher`, plus optional custom roles). One user has exactly one role. Stored in `roles`. Identified at the application boundary by **`code`** (stable, kebab-case), not by `name` (human label, mutable).
- **Permission** — a granular access right named `<group>.<action>` (e.g. `users.create`, `quizzes.badges_manage`). Stored in `permissions` and grouped under `permission_groups` for the UI matrix.
- **Grant** — a row in `role_permissions(role_id, permission_id)`. Presence = grant, absence = deny. No third "explicitly revoked" state.
- **Super-admin bypass** — the role with `code = 'admin'` always passes every permission check at the code level. No rows in `role_permissions` are written for admin; they would be misleading and the API rejects attempts to set them (`cannot_modify_admin_permissions`).
- **Data scoping** is a SEPARATE layer (`src/common/scoping/*.scope.ts`). Permissions decide whether the actor can hit an endpoint; scope rules decide which rows the actor sees within an endpoint they can already reach. Both apply independently — never collapse them.

## Topology

```
HTTP request
  └─> JwtGuard                — validates Bearer + populates req.user
       └─> RolesGuard          — default-deny role allowlist from @Roles(...)
            └─> PermissionGuard — default-pass; checks @RequirePermission(...) if present
                 └─> handler
```

`PermissionGuard` is registered globally via `APP_GUARD` in `app.module.ts`. It runs AFTER `RolesGuard` (which is applied at the controller level via `@UseGuards`). Posture:

- `@Public()` → bypass.
- No `@RequirePermission` metadata → **pass**. (RolesGuard already enforced roles; permission gating is opt-in per handler so the migration to fine-grained gates can be done one endpoint at a time.)
- `role_name === 'admin'` → bypass.
- Otherwise, `PermissionsService.canAll/canAny` decides; failure → `403 insufficient_permission`.

## Cache

Redis keys, namespace `geonline-admin:*`:

- `geonline-admin:perms:role:<role_id>` — `{"v": <version>, "codes": [...]}`. TTL 600 s.
- `geonline-admin:perms:version` — monotonic counter. Bumped on any invalidate. Entries with `v < current` are ignored on read (belt-and-braces for missed `DEL` in multi-instance deploys).

Invalidation triggers:

- `PUT /admin-api/v1/admin/access/roles/:id/permissions` (server-side, automatic).
- `prisma/seeds/permissions.seed.ts` (every run, for touched roles).
- Manual: `redis-cli DEL geonline-admin:perms:role:<id>` (also bump `geonline-admin:perms:version` to be safe).

## How to add a new permission

Three steps. Each one is idempotent and CI-friendly.

1. **Add it to the catalog.** Edit [glucose-admin-api/prisma/seeds/permissions.seed.ts](../prisma/seeds/permissions.seed.ts), in the relevant `SeedGroup.permissions[]` array (or add a new group). `display_order` uses a step of 10 inside a group so you can insert between existing actions (e.g. `users.archive` at 35 between `edit=30` and `delete=40`).
2. **Run the seed.** From `glucose-admin-api/`: `npm run seed:permissions`. Upserts the catalog, removes orphans, invalidates Redis cache for any role whose grants changed.
3. **Gate the endpoint.** In the controller:

   ```ts
   @Roles('admin', 'curator')                  // high-level allowlist (RolesGuard)
   @RequirePermission('users.archive')         // granular check (PermissionGuard)
   @Audit('user.archive', 'user')
   @Post(':id/archive')
   archiveUser(...) { ... }
   ```

   Also add the code to [glucose-admin-client/src/lib/access/permission-codes.ts](../../glucose-admin-client/src/lib/access/permission-codes.ts) for client-side type-safety (`usePermission('users.archive')` gets IntelliSense). Unknown codes still work at runtime — they just don't autocomplete.

## How to add a new group

Same as above but at the group level. Pick a `display_order` with at least 50 slack from neighbors (`100, 200, ..., 1500`). Add `name_ru` + `name_kz` to the SeedGroup. After seeding, add the matching `permission?: '<group>.view'` entry to the navigation in `admin-nav.tsx` if the group should appear as a sidebar item.

## How to create a custom role

UI: `/access/roles` → "Create role" → enter `code` (kebab-case) + display name + optional description → save. Open the role's matrix drawer → tick the permissions you want → Save. Assign the role to users via the regular user management flow.

Programmatic (NOT recommended): direct INSERT into `roles` + `role_permissions`, then `redis-cli DEL geonline-admin:perms:role:<id>`. Skip the UI only for ops scripts.

## Lockout safety

The API enforces:

| Scenario | Result |
|---|---|
| DELETE a `is_system=true` role | 409 `cannot_delete_system_role` |
| DELETE a role with `user_count > 0` | 409 `role_has_users` |
| PATCH `code`/`is_system`/`is_admin` | DTO has no such field — request rejected by class-validator |
| POST a role with `code='admin'` / `'curator'` / `'teacher'` / `'student'` | 400 `role_code_reserved` |
| POST a role with a duplicate `code` | 409 `role_code_taken` |
| PUT permissions on `code='admin'` | 400 `cannot_modify_admin_permissions` |
| Remove `access.manage` from every role | admin (super-bypass) still has it. Other admins-of-access lose access — by design. |

**NOT enforced by this module:** "you cannot demote the last active user with `role_name='admin'`". That guard belongs in the users module (already in place there). Mentioned here so reviewers don't expect it in `AccessService.deleteRole`.

## Bootstrapping a fresh database

1. Apply [glucose-api/prisma/migrations/phase-11-rbac-permissions.draft.sql](../../glucose-api/prisma/migrations/phase-11-rbac-permissions.draft.sql) to shared MySQL. (See the MANUAL recipe-card next to it.)
2. `cd glucose-admin-api && npm run prisma:pull` — sync the curated schema. **Caveat:** Prisma `db pull` is destructive in heavily-curated subset schemas: it can erase hand-added relations and rename PascalCase models to snake_case. If your `git diff prisma/schema.prisma` shows hundreds of deleted lines after pull, revert with `git checkout prisma/schema.prisma` and hand-merge ONLY the new tables instead. The Phase-11 tables are documented in this file's section above.
3. `npm run seed:permissions` — populate the catalog + create the 3 core roles.
4. `npm run ci:prisma-drift` — should pass.

## Running seed on prod

The seed is **safe to re-run on every deploy** in its default mode. It is idempotent and never overwrites manual edits made through the `/access/roles` UI. Behavior breakdown:

| Seed action | Re-runnable? | Overrides UI edits? |
|---|---|---|
| Upsert `permission_groups.{name_ru, name_kz, display_order}` | yes | only label/order, not grants |
| Upsert `permissions.{name_ru, name_kz, action, display_order, description}` | yes | only metadata |
| Create core roles (`admin`/`curator`/`teacher`) | yes (skip if exists) | no |
| Update existing core roles' `name`/`description`/`is_system`/`display_order` | yes | yes (these are seed-owned) |
| Write `default_grants` for a core role | **only when that role has zero grants** | no |
| Delete orphan permissions / groups | **only when `--prune` flag passed** | no (orphans only) |

What this means for prod:

- **No, it does not "reset" grants.** Once a role has any grants, the seed never touches `role_permissions` for it. Manual matrix edits in `/access/roles` survive every re-run.
- **First-deploy backfill** still works: if you SQL-applied the migration and the existing `curator`/`teacher` rows have empty grants, the seed will populate the defaults exactly once.
- **Orphans default to logging, not deleting.** If a permission code is removed from the seed catalog, the next seed run logs a warning instead of dropping it. To actually prune, run `npm run seed:permissions -- --prune` from an ops shell. This protects prod from a careless catalog edit silently revoking grants.
- **Catalog metadata (labels, sort order, descriptions) IS overwritten each run.** Translations live in the seed file, not the DB, so the catalog and the code stay in sync.

### Recommended prod wiring

Two acceptable patterns; pick whichever fits your deploy story:

1. **Run inside the deploy pipeline, after the migration step.**
   ```bash
   # in your deploy job, after applying the SQL migration:
   cd glucose-admin-api && npm run seed:permissions
   ```
   Idempotent + automatic; new permissions become live the moment the app boots. Use this if you trust your deploy automation and have rollback ready.

2. **Manual `kubectl exec` (or equivalent) after a deploy.** Run when you're rolling out a new permission. Removes the risk of an accidental `--prune` ever ending up in a pipeline.

**Don't** run `--prune` from automation. It's a one-off ops command; gate it behind a runbook so a permission removal is always a conscious, reviewed action (re-apply grants for the *renamed* code via the UI before pruning the old one).

### Cache invalidation in prod

The seed itself bumps `geonline-admin:perms:version` and `DEL`s per-role cache keys for every role it touches. So changes propagate to running app instances within ~10 minutes max (TTL), usually instantly via DEL. No need to restart the app.

If Redis is unreachable, the seed logs a warning and continues; PermissionsService falls back to the DB on read and re-populates the cache on the next request.

## Default grants

Set ONCE when `permissions.seed.ts` first creates a core role. Subsequent seed runs leave existing `role_permissions` untouched, so manual matrix edits made through the UI survive a re-seed.

- **admin** — none (super-bypass).
- **curator** — `dashboard.view`, `users.view/export`, `groups.*`, `courses.view/edit`, `quizzes.view/results_view`, `files.view/create`.
- **teacher** — `dashboard.view`, `users.view`, `courses.view/create/edit/publish`, `quizzes.view/create/edit/publish/results_view`, `files.view/create`.

## Migration debt

`PermissionGuard` is **default-pass** by design — every handler without `@RequirePermission(...)` is gated only by its `@Roles(...)` decorator. Backfilling `@RequirePermission` across all mutation endpoints is intentional follow-up work, not blocking for MVP. When adding new mutation endpoints, write the decorator from day one; when touching existing ones, add it opportunistically.

Per-component cleanup of `role_name === 'admin'` checks on the client is also incremental. The four files listed in the phase plan (`users-list-client.tsx`, `blogs-list-client.tsx`, `sale-detail-client.tsx`, `teacher-change-dialog.tsx`) are done; the remaining ~14 hits across `courses/`, `groups/`, `quizzes/`, `stories/`, `banners/`, `promocodes/` should migrate to `usePermission(code)` when the relevant module is next touched.

## See also

- [glucose-api/prisma/migrations/phase-11-rbac-permissions.MANUAL.sql.md](../../glucose-api/prisma/migrations/phase-11-rbac-permissions.MANUAL.sql.md) — schema rationale.
- [glucose-admin-api/PRISMA.md](../PRISMA.md) — why migrations live in glucose-api.
- [glucose-admin-api/src/modules/access/](../src/modules/access/) — module source.
- [glucose-admin-client/src/lib/access/](../../glucose-admin-client/src/lib/access/) — client helpers.
