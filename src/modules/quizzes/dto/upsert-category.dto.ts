import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsInt,
    IsOptional,
    Min,
    ValidateNested,
} from 'class-validator';
import { TranslationDto } from './translation.dto';

/**
 * QZ-04 upsert-quiz-category payload (single create/update).
 *
 * Phase 6 Plan 01 — locked contract surface (D-15..D-16).
 * Consumed by Plan 03 quiz-categories controller/service.
 *
 * Schema-truth notes:
 *   - QuizCategory has NO `name` column (line 504-510) — display name lives in
 *     QuizCategoryTranslation.title per locale. Reflected here: no `name` field.
 *   - QuizCategory.parent_id is `Int?` (line 506) — self-FK; null = root.
 *   - QuizCategory has NO `order` column — sibling order is by id ASC for v1.
 *     dnd-kit reorder for the tree is therefore NOT persisted in v1 (deferred).
 *   - QuizCategory.subject_id is `Int?` (line 507) — optional FK to QuizSubject.
 *
 * Cycle protection (Plan 03 service responsibility):
 *   When updating parent_id, service must walk up the parent chain to detect
 *   cycles (A→B→C→A). Detection failure → 400 with i18n key `cycle_detected`.
 *
 * Cascade-delete protection (D-16, Plan 03 service):
 *   DELETE returns 409 when the category has quiz children unless `?force=true`.
 *   The `force` flag is a query parameter, NOT in this DTO.
 */
export class UpsertCategoryDto {
    /** Omit on create. Required on update. */
    @IsOptional()
    @IsInt()
    @Min(1)
    id?: number;

    /** null = root category. */
    @IsOptional()
    @IsInt()
    @Min(1)
    parent_id?: number | null;

    @IsOptional()
    @IsInt()
    @Min(1)
    subject_id?: number | null;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => TranslationDto)
    translations!: TranslationDto[];
}
