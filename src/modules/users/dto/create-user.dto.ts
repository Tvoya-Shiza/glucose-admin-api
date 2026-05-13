import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /admin-api/v1/admin/users — admin-only single-user creation.
 *
 * Mirrors the import row contract (see `import-users.dto.ts`) but for a single record:
 *   - email or mobile (or both) — at least one is required as the idempotency key.
 *     Cross-field check is performed in `users-create.service.ts` (DTO-level "one of"
 *     would require a custom validator; service-side keeps the rule co-located with the
 *     conflict-detection logic).
 *   - role_name is REQUIRED here (defaulted to 'student' on the import path because
 *     CSVs commonly omit it; admin-driven single creates should be explicit about role).
 *   - password is OPTIONAL — when omitted, the User.password column stays NULL and
 *     the operator-created user logs in via the SMS-code flow (parity with public
 *     student registration).
 */
export class CreateUserDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    full_name?: string;

    @IsOptional()
    @IsEmail()
    @MaxLength(255)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    mobile?: string;

    @IsOptional()
    @IsString()
    @MinLength(6)
    @MaxLength(72)
    password?: string;

    @IsIn(['admin', 'curator', 'teacher', 'student'])
    role_name!: 'admin' | 'curator' | 'teacher' | 'student';

    @IsOptional()
    @IsIn(['active', 'inactive', 'pending'])
    status?: 'active' | 'inactive' | 'pending';
}
