import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export type AssignmentStatusFilter = 'active' | 'inactive';
export type AssignmentSortField = 'created_at' | 'deadline' | 'title';
export type SortOrder = 'asc' | 'desc';

/**
 * Query DTO for GET /admin-api/v1/admin/assignments.
 *
 * Mirrors ListQuizzesDto's shape — paginated, filterable, searchable.
 * The course-content picker (Phase 7) hits this with status=active &
 * q=<typed-text>; analytics widgets hit it with status filter only.
 */
export class ListAssignmentsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    page_size?: number;

    @IsOptional()
    @IsIn(['active', 'inactive'])
    status?: AssignmentStatusFilter;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    webinar_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    chapter_id?: number;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'deadline', 'title'])
    sort?: AssignmentSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
