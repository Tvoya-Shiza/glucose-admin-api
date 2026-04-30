import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * USR-03 (role-change half) — Plan 04.
 *
 * Body for `PATCH /admin-api/v1/admin/users/:id/role`. Both `role_id` and `role_name`
 * are required because admin-api validates they refer to the SAME row in `roles`
 * (T-03-31): the service does `Role.findUnique({ where: { id: role_id } })` and
 * rejects with 400 when `role.name !== role_name`.
 *
 * `confirmation` is the type-the-count-style escalation gate (T-03-32): when
 * `role_name === 'admin'`, the client must echo back `String(user_id)` so a casual
 * misclick can't promote someone to admin. Server checks this regardless of UI.
 */
export class ChangeRoleDto {
    @IsNotEmpty() @Type(() => Number) @IsInt() role_id!: number;
    @IsNotEmpty() @IsString() @IsIn(['admin', 'curator', 'teacher', 'student']) role_name!: 'admin' | 'curator' | 'teacher' | 'student';
    @IsOptional() @IsString() @MaxLength(500) reason?: string;
    /** Required when target role_name === 'admin': must equal String(user_id). T-03-32. */
    @IsOptional() @IsString() confirmation?: string;
}
