export interface AssignmentAttachmentDto {
    id: number;
    title: string;
    attach: string;
}

export interface AssignmentTranslationView {
    locale: 'ru' | 'kz';
    title: string;
    description: string;
}

export interface AssignmentDetailDto {
    id: number;
    webinar_id: number;
    chapter_id: number;
    creator_id: number;
    status: 'active' | 'inactive';
    grade: number | null;
    pass_grade: number | null;
    deadline: number | null;
    attempts: number | null;
    check_previous_parts: boolean;
    access_after_day: number | null;
    translations: AssignmentTranslationView[];
    attachments: AssignmentAttachmentDto[];
    submission_count: number;
    pending_review_count: number;
    created_at: string;
}
