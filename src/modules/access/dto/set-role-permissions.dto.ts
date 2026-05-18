import { ArrayMaxSize, ArrayUnique, IsArray, IsString, Length } from 'class-validator';

/**
 * PUT /admin-api/v1/admin/access/roles/:id/permissions
 *
 * Atomic replacement: the role's set of grants becomes exactly `codes`.
 * Unknown codes are silently dropped at the service (logged) — the DTO only
 * enforces shape and an upper bound so a malicious client can't push 100k entries.
 */
export class SetRolePermissionsDto {
    @IsArray()
    @ArrayUnique()
    @ArrayMaxSize(500)
    @IsString({ each: true })
    @Length(1, 96, { each: true })
    codes!: string[];
}
