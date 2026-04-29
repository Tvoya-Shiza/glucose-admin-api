import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '@shared/roles';

export const ROLES_METADATA_KEY = 'auth:roles';

/**
 * Restricts a controller method (or class) to the listed staff roles.
 * Use with @UseGuards(JwtGuard, RolesGuard).
 *
 * Per CONTEXT.md: only 'admin' | 'curator' | 'teacher' should ever be passed —
 * 'student' is the existing student-app role and admin-api never honors it.
 * The TS argument type still admits 'student' (RoleName); the lint convention
 * is "don't pass 'student'", and RolesGuard would reject it at request time
 * because no admin-api login flow ever sets role_name='student'.
 */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_METADATA_KEY, roles);
