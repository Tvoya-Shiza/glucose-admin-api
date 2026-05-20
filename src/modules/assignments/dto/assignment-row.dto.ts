export type AssignmentRowLocale = 'kz' | 'ru';

export interface AssignmentRowDto {
    id: number;
    title_ru: string | null;
    title_kz: string | null;
    status: 'active' | 'inactive';
    webinar_id: number;
    webinar_title_ru: string | null;
    chapter_id: number;
    deadline: number | null;
    attempts: number | null;
    pass_grade: number | null;
    grade: number | null;
    attachment_count: number;
    submission_count: number;
    pending_review_count: number;
    translation_completeness: 'complete' | 'incomplete';
    missing_locales: AssignmentRowLocale[];
    created_at: string;
}

export interface AssignmentListResponseDto {
    rows: AssignmentRowDto[];
    total: number;
    page: number;
    page_size: number;
}
