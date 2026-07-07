import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * Body for POST /admin-api/v1/admin/rating-journal/columns — a curator-created
 * column. Only `custom` and `attendance` kinds are creatable here (module/credit
 * columns are auto-managed by sync / the finalize adapter). Value type is always
 * a score (TZ 2.3: «тип значения — только балл»).
 */
export class CreateColumnDto {
    /** Journal to add the column to (BigInt id as decimal string). */
    @IsString()
    @Matches(/^\d+$/, { message: 'journal_id must be a decimal id string' })
    journal_id!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    title!: string;

    /** Only manual kinds. Defaults to `custom`. */
    @IsOptional()
    @IsIn(['custom', 'attendance'])
    source_kind?: 'custom' | 'attendance';

    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100000)
    max_score!: number;

    /** Optional module attribution (display grouping) → webinar_chapters.id. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    chapter_id?: number;

    /** Insert position; appended to the end when omitted. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    position?: number;
}
