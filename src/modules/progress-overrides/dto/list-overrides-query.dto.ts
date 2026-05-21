import { Type } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';

/**
 * Phase 19 — GET /admin-api/v1/admin/courses/:courseId/overrides
 *
 * Lists overrides for a single (target × course). Pagination is intentionally
 * absent — a course typically has < 200 overrides per target. Adding it later
 * is straightforward.
 */
export class ListOverridesQueryDto {
    @IsIn(['user', 'group'])
    target_kind!: 'user' | 'group';

    @Type(() => Number)
    @IsInt()
    @Min(1)
    target_id!: number;
}
