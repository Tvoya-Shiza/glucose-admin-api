import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * POST /admin-api/v1/admin/access/roles
 *
 * Always creates a non-system role (is_system=false). `code` is required and
 * must match kebab-case (lowercase letters, digits, hyphens). Forbidden codes
 * are rejected at the service layer.
 */
export class CreateRoleDto {
    @IsString()
    @Length(2, 64)
    @Matches(/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/, {
        message: 'code must be kebab-case: [a-z][a-z0-9-]{1,62}[a-z0-9]',
    })
    code!: string;

    @IsString()
    @Length(2, 64)
    name!: string;

    @IsOptional()
    @IsString()
    @Length(0, 255)
    description?: string;
}
