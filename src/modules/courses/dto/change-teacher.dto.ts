import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * CRS-06 change-teacher payload.
 *
 * Phase 5 Plan 01 locked contract surface (D-22 from CONTEXT).
 *
 * - admin-only at controller layer (Plan 03 enforces via @Roles('admin')).
 * - service layer validates target user exists AND has role_name='teacher' before update.
 * - Plan 03 commits the change in a single $transaction with a `courses.change_teacher`
 *   audit row (mirrors Phase 4 GroupsSupervisor pattern).
 * - `reason` is free-text, optional; written into the audit row's meta.
 */
export class ChangeTeacherDto {
    @IsInt()
    @Min(1)
    teacher_id!: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}
