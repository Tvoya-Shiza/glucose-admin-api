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
 * BLG-04 — bulk-status toggle DTO (Phase 7 Plan 04 / D-12).
 *
 * Mirrors Plan 02 Stories BulkStatusDto verbatim; field name swapped from `story_ids`
 * to `blog_ids`. Status taxonomy 'pending' | 'publish'. HARD delete is row-level only.
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
    blog_ids!: number[];

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
