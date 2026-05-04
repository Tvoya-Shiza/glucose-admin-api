import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

/**
 * QZ-05 reorder-badge-items payload (Phase 6 Plan 06).
 *
 * Endpoint: PATCH /admin-api/v1/admin/quiz-badges/:badgeId/items/reorder
 *
 * Per D-18 — QuizBadgeItem HAS an `order` column on schema (Int? @db.UnsignedInt,
 * line 675), so reorder IS persisted (unlike question/answer reorder which is
 * id-ASC only in v1). Single $tx batched updates; UI uses optimistic mutation
 * with rollback on failure (mirror Phase 5 chapter-tree-editor pattern).
 *
 * Cap: 500 items per badge — generous defense against pathological payloads
 * (T-06-74 DoS mitigation).
 */
export class ReorderBadgeItemsEntry {
    @IsInt()
    @Min(1)
    id!: number;

    @IsInt()
    @Min(0)
    order!: number;
}

export class ReorderBadgeItemsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => ReorderBadgeItemsEntry)
    items!: ReorderBadgeItemsEntry[];
}
