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
 * STY-03 — bulk-status toggle DTO (Phase 7 Plan 02 / D-07).
 *
 * Mirrors the Phase 3 Plan 05 BulkProvisionDto shape:
 *   - Single endpoint serves both dry-run preview and commit (mode discriminates).
 *   - story_ids capped at 1000 per request (T-07-02-06 DoS mitigation).
 *   - confirmed_count gates commits >50 affected (T-03-42 / T-07-02-02 mitigation).
 *   - bulk_op_id propagated from client when regex-shaped, otherwise minted server-side.
 *
 * Status taxonomy: 'pending' | 'publish' (BlogStatus enum). Toggling between these is
 * the only supported bulk operation; HARD delete is row-level only (NOT in bulk).
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
    story_ids!: number[];

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
