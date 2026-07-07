import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Min, ValidateIf } from 'class-validator';

/**
 * Body for PATCH /admin-api/v1/admin/rating-journal/cells — inline autosave of
 * one cell. A manual edit sets is_manual_override=true so sync never clobbers it.
 * `reset:true` clears the override and re-derives the value from the source
 * (module grade / credit result); `value` is ignored when reset is set.
 */
export class UpsertCellDto {
    @IsString()
    @Matches(/^\d+$/, { message: 'column_id must be a decimal id string' })
    column_id!: string;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    student_id!: number;

    /** 0..column.max_score, or null to clear. Required unless reset=true. */
    @ValidateIf((o) => !o.reset)
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    value?: number | null;

    @IsOptional()
    @IsBoolean()
    reset?: boolean;
}
