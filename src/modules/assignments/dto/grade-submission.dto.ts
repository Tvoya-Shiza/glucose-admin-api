import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class GradeSubmissionDto {
    @IsIn(['pending', 'passed', 'not_passed', 'not_submitted'])
    status!: 'pending' | 'passed' | 'not_passed' | 'not_submitted';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    grade?: number;

    /**
     * Optional inline curator note posted alongside the grade.
     * When present, a new WebinarAssignmentHistoryMessage row is created
     * (sender_id = current curator/admin, no file_path) — the polymorphic
     * comment-thread design (no schema change).
     */
    @IsOptional()
    @IsString()
    @MaxLength(4000)
    comment?: string;
}
