export type ScheduleStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type ScheduleItemKind = 'lesson' | 'quiz' | 'assignment' | 'file';

export interface ScheduleItemDto {
    id: number;
    kind: ScheduleItemKind;
    ref_id: number;
    position: number;
    title_ru: string | null;
    title_kz: string | null;
    resolved: boolean;
}

export interface ScheduleRowDto {
    id: number;
    curator_id: number;
    curator_name: string | null;
    /** Phase 32 — null for a GENERAL schedule (not bound to a specific group). */
    group_id: number | null;
    group_name: string | null;
    course_id: number | null;
    course_title_ru: string | null;
    course_title_kz: string | null;
    start_at: number;
    end_at: number;
    description: string | null;
    status: ScheduleStatus;
    /** Phase 32 — independent access-gate toggles. */
    block_before_start: boolean;
    block_after_end: boolean;
    item_count: number;
    items: ScheduleItemDto[];
    created_by: number;
    created_at: number;
    updated_at: number | null;
}

export interface ScheduleListResponseDto {
    rows: ScheduleRowDto[];
    total: number;
    page: number;
    page_size: number;
}

export interface ScheduleCalendarResponseDto {
    rows: ScheduleRowDto[];
    from: number;
    to: number;
}

export interface ScheduleAnalyticsDto {
    total: number;
    by_status: Record<ScheduleStatus, number>;
    by_kind: Record<ScheduleItemKind, number>;
    upcoming_7d: number;
    overdue_count: number;
    top_curators: Array<{ curator_id: number; curator_name: string | null; count: number }>;
    sparkline: Array<{ bucket: number; count: number }>;
}
