import { IsOptional, IsString, Length } from 'class-validator';

/**
 * PATCH /admin-api/v1/admin/access/roles/:id
 *
 * Only `name` and `description` are editable. `code`, `is_system`, and
 * `is_admin` are NOT in this DTO on purpose — they are not mutable from the API.
 */
export class UpdateRoleDto {
    @IsOptional()
    @IsString()
    @Length(2, 64)
    name?: string;

    @IsOptional()
    @IsString()
    @Length(0, 255)
    description?: string;
}
