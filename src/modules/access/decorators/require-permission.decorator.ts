import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'auth:permission';

export type PermissionRequirement = { mode: 'all' | 'any'; codes: string[] };

/**
 * Gates a handler behind one or more permission codes.
 *
 * Used together with @Roles(...) which remains the high-level role allowlist:
 *
 *   @Roles('admin', 'curator')
 *   @RequirePermission('users.create')
 *   @Audit('user.create', 'user')
 *   @Post('/users')
 *
 * RolesGuard runs first and rejects roles not in the allowlist.
 * PermissionGuard then checks the granular permission (admin always bypasses).
 *
 * Default behavior:
 *   - No @RequirePermission on the handler → PermissionGuard passes silently.
 *     This is a deliberate default-pass during migration to the new system; the
 *     RolesGuard's default-deny posture still protects un-annotated endpoints.
 */
export const RequirePermission = (...codes: string[]) =>
    SetMetadata(REQUIRE_PERMISSION_KEY, { mode: 'all', codes } satisfies PermissionRequirement);

/** Like @RequirePermission but ANY of the listed codes is enough. */
export const RequireAnyPermission = (...codes: string[]) =>
    SetMetadata(REQUIRE_PERMISSION_KEY, { mode: 'any', codes } satisfies PermissionRequirement);
