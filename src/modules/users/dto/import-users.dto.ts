import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsEmail,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';

/**
 * USR-06 — Plan 06 CSV import DTOs.
 *
 * One file holds both ImportRowDto and ImportUsersDto per glucose-api convention
 * (multiple related DTOs may co-locate when they form a single endpoint contract).
 *
 * `mode='dry_run'` runs the IDENTICAL classification logic as commit but skips
 * the writes — predicate symmetry is the same guarantee as Plan 05 (D-13/D-16).
 *
 * `rows` capped at 10_000 (T-03-52 DoS mitigation; mirrors browser cap of 10k rows
 * declared client-side in `lib/users/csv.ts`). `row_id` <= 64 chars: client-side
 * dedupe key, never sent to DB.
 *
 * `bulk_op_id` — UUID-shaped; client supplies on `commit` to match the `dry_run`
 * preview; server mints when absent.
 *
 * `confirmed_count` REQUIRED on commit when `affected > 50` AND must equal computed
 * affected (server-side gate, T-03-42 — independent of UI).
 */

export class ImportRowDto {
    @IsString()
    @MaxLength(64)
    row_id!: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    full_name?: string;

    @IsOptional()
    @IsEmail()
    @MaxLength(255)
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    mobile?: string;

    @IsOptional()
    @IsIn(['admin', 'curator', 'teacher', 'student'])
    role_name?: 'admin' | 'curator' | 'teacher' | 'student';

    @IsOptional()
    @IsIn(['active', 'inactive', 'pending'])
    status?: 'active' | 'inactive' | 'pending';
}

export class ImportUsersDto {
    @IsIn(['dry_run', 'commit'])
    mode!: 'dry_run' | 'commit';

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(10000)
    @ValidateNested({ each: true })
    @Type(() => ImportRowDto)
    rows!: ImportRowDto[];

    /** UUID emitted by client for traceability between dry-run + commit; server mints when absent. */
    @IsOptional()
    @IsString()
    bulk_op_id?: string;

    /** When mode='commit' AND affected > 50, MUST equal computed `affected`. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    confirmed_count?: number;
}
