import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * USR-04 + USR-05 — Plan 05 bulk provision DTO.
 *
 * Single endpoint POST /admin-api/v1/admin/users/bulk-provision serves both dry-run
 * preview and commit; `mode` discriminates. user_ids capped at 1000 and webinar_ids
 * at 50 per request (T-03-43 DoS mitigation — max 50_000 row pairs).
 *
 * `confirmed_count` MUST equal computed `affected` when commit && affected > 50;
 * mismatch -> 400 confirmation_required (server-side gate, T-03-42 — UI is best-effort).
 *
 * `bulk_op_id` is optional — server mints UUIDv4 when absent. Used for traceability
 * across the response, audit row, and (future) Sale.bulk_op_id schema column.
 *
 * Locked shape: Phase 7 reuses this exact pattern (mode, ids[], confirmed_count,
 * bulk_op_id) for stories/banners/blogs/promocodes bulk-status changes — re-skin
 * the field names but keep the discriminator + cap + confirmation gate.
 */
export class BulkProvisionDto {
    @IsIn(['dry_run', 'commit'])
    mode!: 'dry_run' | 'commit';

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(1000)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    user_ids!: number[];

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(50)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    webinar_ids!: number[];

    /** Days of access. null/undefined = perpetual. Capped at 3650 (10 years). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(3650)
    access_days?: number;

    /** UUID emitted by client for idempotency; if absent, server mints. */
    @IsOptional()
    @IsString()
    bulk_op_id?: string;

    /** When mode='commit' AND affected > 50, MUST equal computed `affected`. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    confirmed_count?: number;

    /** Optional free-form note that lands in audit meta. */
    @IsOptional()
    @IsString()
    reason?: string;
}
