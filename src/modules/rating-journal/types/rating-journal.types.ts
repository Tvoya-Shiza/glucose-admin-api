import type { RatingJournalSourceKind, UserStatus } from '../../../../generated/prisma';

/**
 * Wire shapes for the «Рейтинг-журнал» grid (Block 1 of the platform TZ).
 * BigInt ids are serialized as decimal STRINGS by the global BigIntStringInterceptor —
 * every id field below is a string on the wire. student_id / chapter_id stay numbers
 * (signed INT users.id / webinar_chapters.id).
 */

export interface JournalColumnDto {
    id: string;
    title: string;
    source_kind: RatingJournalSourceKind;
    source_ref_id: string | null;
    chapter_id: number | null;
    max_score: number;
    position: number;
    is_hidden: boolean;
    /** module_quiz / module_assignment / credit — auto-managed by sync, cells still overridable. */
    is_auto: boolean;
    /** custom columns can be renamed / re-maxed / deleted; auto columns only hidden. */
    is_custom: boolean;
}

export interface JournalCellDto {
    column_id: string;
    value: number | null;
    is_manual_override: boolean;
}

export interface JournalRowDto {
    student_id: number;
    full_name: string | null;
    /** Account status (active/pending/inactive) — drives the optional roster status filter (TZ 2.2). */
    status: UserStatus;
    /** keyed by column_id (string). Absent column = ungraded cell. */
    cells: Record<string, JournalCellDto>;
    /** Σ of visible (non-hidden) cell values, null → 0. */
    total: number;
}

export interface JournalMetaDto {
    id: string;
    group_id: number;
    course_id: number;
    title: string;
}

export interface JournalGridDto {
    journal: JournalMetaDto;
    columns: JournalColumnDto[];
    rows: JournalRowDto[];
    /** Σ of visible column max_scores (the «ЖАЛПЫ (140)» header). */
    max_total: number;
}

export interface JournalCellHistoryRow {
    id: string;
    column_id: string;
    student_id: number;
    old_value: number | null;
    new_value: number | null;
    source: string;
    changed_by: number | null;
    changed_at: number;
}
