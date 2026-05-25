import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export type SubmissionStatusFilter = 'pending' | 'passed' | 'not_passed' | 'not_submitted';

export class ListSubmissionsDto {
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
    @IsIn(['pending', 'passed', 'not_passed', 'not_submitted'])
    status?: SubmissionStatusFilter;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'grade'])
    sort?: 'created_at' | 'grade';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';
}

export interface SubmissionRowDto {
    history_id: number;
    student_id: number;
    student_name: string | null;
    status: SubmissionStatusFilter;
    grade: number | null;
    submitted_at: string;
    files_count: number;
    has_curator_reply: boolean;
}

export interface SubmissionListResponseDto {
    rows: SubmissionRowDto[];
    total: number;
    page: number;
    page_size: number;
}

export interface SubmissionMessageView {
    id: number;
    sender_id: number;
    sender_name: string | null;
    sender_role: string | null;
    message: string;
    /** Legacy column. New curator replies use a polymorphic message row instead. */
    curator_comment: string | null;
    /** Display name (RFC 5987-safe; mojibake-normalized). */
    file_title: string | null;
    /**
     * Stable admin-api URL of the attached file (`/v1/admin/assignments/.../messages/:id/file`).
     * Clients hit it through the BFF proxy. null when message has no attachment.
     *
     * Replaces the legacy `file_path` field which exposed a raw relative storage
     * path that 404'd when the browser tried to resolve it against the current page.
     */
    file_url: string | null;
    created_at: string;
}

export interface SubmissionDetailDto {
    history_id: number;
    assignment_id: number;
    student_id: number;
    student_name: string | null;
    instructor_id: number;
    status: SubmissionStatusFilter;
    grade: number | null;
    submitted_at: string;
    messages: SubmissionMessageView[];
}
