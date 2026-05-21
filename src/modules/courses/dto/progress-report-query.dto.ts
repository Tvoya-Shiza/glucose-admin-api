import { Type } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';

/**
 * Phase 19 / Feature B2 — GET /admin-api/v1/admin/courses/:courseId/progress query.
 *
 * Reports completion status for ONE (target × course). The target is either a
 * single user (per-item status) or a single group (per-item ratio across members).
 */
export class ProgressReportQueryDto {
    @IsIn(['user', 'group'])
    target_kind!: 'user' | 'group';

    @Type(() => Number)
    @IsInt()
    @Min(1)
    target_id!: number;
}
