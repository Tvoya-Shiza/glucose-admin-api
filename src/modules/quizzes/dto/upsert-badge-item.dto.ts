import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * QZ-05 add/update QuizBadgeItem (a single quiz inside a Пробное ЕНТ badge).
 *
 * Phase 6 Plan 01 — locked contract surface (D-18).
 * Consumed by Plan 06 badge-items endpoints.
 *
 * Schema-truth notes:
 *   - QuizBadgeItem.quiz_badge_id is `Int` (line 673) — REQUIRED FK.
 *   - QuizBadgeItem.quiz_id is `Int` (line 674) — REQUIRED FK.
 *   - QuizBadgeItem.order is `Int? @db.UnsignedInt` (line 675) — optional (server auto-assigns
 *     to MAX(order)+1 when omitted on create). Persistent — survives reload (vs question/answer
 *     where order is currently transient/by-id-ASC).
 *
 * Reorder uses a separate batch endpoint (Plan 06: PATCH .../badges/:id/items/reorder)
 * — not via this DTO. Single-item reorder via update path is supported but discouraged;
 * batch is the canonical UX (dnd-kit drop event commits the whole list).
 */
export class UpsertBadgeItemDto {
    /** Omit on create. Required on update. */
    @IsOptional()
    @IsInt()
    @Min(1)
    id?: number;

    @IsInt()
    @Min(1)
    quiz_badge_id!: number;

    @IsInt()
    @Min(1)
    quiz_id!: number;

    /** Optional on create — server assigns MAX(order)+1 when missing. */
    @IsOptional()
    @IsInt()
    @Min(0)
    order?: number;
}
