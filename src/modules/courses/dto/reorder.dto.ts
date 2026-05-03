import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsInt,
    IsOptional,
    Min,
    ValidateNested,
    ValidateIf,
} from 'class-validator';

/**
 * CRS-07 reorder-tree payload.
 *
 * Phase 5 Plan 01 locked contract surface (D-07 / D-08 from CONTEXT).
 *
 * Endpoint (Plan 05): PATCH /admin-api/v1/admin/courses/:id/reorder
 *
 * Both arrays optional individually but at least ONE must be non-empty —
 * enforced via class-level @ValidateIf (Plan 05's controller has a fallback
 * 400 with i18n key admin.courses.reorder.empty if both arrays are missing).
 *
 * Plan 05 service commits all updates in a single prisma.$transaction; on
 * any failure UI rolls back via TanStack-Query optimistic mutation (toast
 * shows "Reorder failed — restoring previous order").
 *
 * Caps: 200 chapters, 2000 items — defends against pathological payloads.
 *
 * Schema-truth note: WebinarChapter.order and WebinarChapterItem.order are
 * `Int @db.UnsignedInt` (nullable) — accepted as positive integers here.
 */
export class ReorderChapterEntry {
    @IsInt()
    @Min(1)
    id!: number;

    @IsInt()
    @Min(0)
    order!: number;
}

export class ReorderItemEntry {
    @IsInt()
    @Min(1)
    id!: number;

    @IsInt()
    @Min(1)
    chapter_id!: number;

    @IsInt()
    @Min(0)
    order!: number;
}

export class ReorderDto {
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => ReorderChapterEntry)
    chapters?: ReorderChapterEntry[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(2000)
    @ValidateNested({ each: true })
    @Type(() => ReorderItemEntry)
    items?: ReorderItemEntry[];

    /**
     * Class-level guard: ensure at least one of chapters/items is non-empty.
     * @ValidateIf returns true → continue validating; the dummy field below
     * is required when BOTH arrays are missing/empty, which forces validation
     * to fail with a clear message.
     */
    @ValidateIf((o: ReorderDto) => {
        const noChapters = !o.chapters || o.chapters.length === 0;
        const noItems = !o.items || o.items.length === 0;
        return noChapters && noItems;
    })
    @IsInt({ message: 'reorder payload must include at least one of `chapters` or `items` (non-empty array)' })
    private __at_least_one?: number;
}
