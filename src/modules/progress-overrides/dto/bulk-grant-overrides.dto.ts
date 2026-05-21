import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { OverrideTargetDto } from './target.dto';

/**
 * Phase 19 — POST /admin-api/v1/admin/courses/:courseId/overrides
 *
 * Bulk-grant per-item content unlocks for either a user OR a group.
 *
 * Semantics:
 *   - Each `item_id` becomes one row in `course_content_overrides`
 *     (user_id XOR group_id set per target, item_id, webinar_id=:courseId).
 *   - Duplicates (same target × course × item already granted) are silently
 *     skipped (`skipDuplicates: true`); the response reports created vs.
 *     skipped counts.
 *   - `expires_at` and `note` apply uniformly to every granted item in this
 *     batch. Heterogeneous batches require multiple POSTs.
 *
 * Hard cap of 500 items per call — admin operators rarely unlock more in one
 * gesture, and the upper bound bounds the audit-log row size + Prisma payload.
 */
export class BulkGrantOverridesDto {
    @ValidateNested()
    @Type(() => OverrideTargetDto)
    target!: OverrideTargetDto;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    item_ids!: number[];

    /** Unix sec; null/omitted = perpetual unlock (no expiry). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    expires_at?: number | null;

    /** Free-form admin note, surfaced in the overrides list for context. */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    note?: string;
}
