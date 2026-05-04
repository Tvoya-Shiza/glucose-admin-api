import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
} from 'class-validator';

/**
 * BAN-03 — bulk-status toggle DTO (Phase 7 Plan 03 / D-08).
 *
 * Mirrors Plan 02 (Stories) BulkStatusDto exactly, with `banner_ids` (not story_ids)
 * as the wire field — service maps to `prisma.advertisement.update`.
 *
 *   - Single endpoint serves both dry-run preview and commit (mode discriminates).
 *   - banner_ids capped at 1000 per request (T-07-03-06 DoS mitigation).
 *   - confirmed_count gates commits >50 affected (T-07-03-02 mitigation).
 *   - bulk_op_id propagated from client when regex-shaped, otherwise minted server-side.
 *
 * Status taxonomy: 'pending' | 'publish' (BlogStatus enum). HARD delete is row-level.
 */
export class BulkStatusDto {
    @IsIn(['dry_run', 'commit'])
    mode!: 'dry_run' | 'commit';

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(1000)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    banner_ids!: number[];

    @IsIn(['pending', 'publish'])
    status!: 'pending' | 'publish';

    /** Optional client-supplied UUID-shaped id; when missing server mints one. */
    @IsOptional()
    @IsString()
    @Matches(/^[0-9a-f-]{8,40}$/i)
    bulk_op_id?: string;

    /** When mode='commit' AND affected > 50, MUST equal computed `affected`. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    confirmed_count?: number;

    /** Optional free-form note that lands in audit meta. */
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}
