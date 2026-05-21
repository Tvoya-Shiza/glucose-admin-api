/**
 * Phase 19 — response shapes for the progress-overrides surface.
 * Mirrors glucose-admin-client/src/lib/progress-overrides/types.ts.
 */

export class OverrideGrantedByRefDto {
    id!: number;
    full_name!: string | null;
}

export class OverrideRowDto {
    id!: number;
    item_id!: number;
    /** Resolved item type ('file' | 'quiz' | 'assignment') from WebinarChapterItem.type. */
    item_type!: string;
    /** Chapter the item belongs to (resolved server-side for grouping in UI). */
    chapter_id!: number;
    /** Optional admin note. */
    note!: string | null;
    granted_at!: number;
    expires_at!: number | null;
    granted_by!: OverrideGrantedByRefDto | null;
}

export class OverrideListResponseDto {
    rows!: OverrideRowDto[];
    total!: number;
}

/** Returned by POST /overrides — granted count + per-item ids that were created (excludes skipped duplicates). */
export class BulkGrantResultDto {
    created!: number;
    skipped!: number;
    created_item_ids!: number[];
}

/** Returned by DELETE /overrides. */
export class BulkRevokeResultDto {
    deleted!: number;
}
