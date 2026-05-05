/**
 * Audit-read response shapes (locked contract — Plans 02 + 03 consume verbatim).
 *
 * Mirrors AdminAuditLog row (Phase 1 Plan 08) with BigInt id cast to Number at the
 * boundary. Phase 3 Plan 03 user-activity uses the same pattern (UserActivityRowDto).
 */

export interface AuditRowDto {
    id: number;
    ts: number; // Unix seconds
    actor_id: number | null;
    action: string;
    entity: string;
    entity_id: string | null;
    ip: string | null;
    ua: string | null;
    before: unknown | null;
    after: unknown | null;
    meta: Record<string, unknown> | null;
    bulk_op_id: string | null;
    request_id: string | null;
}

export interface AuditListResponseDto {
    rows: AuditRowDto[];
    total: number;
    page: number;
    page_size: number;
}

export interface DistinctValuesDto {
    values: string[];
}
