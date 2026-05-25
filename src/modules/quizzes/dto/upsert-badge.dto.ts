import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsNumberString,
    IsOptional,
    Min,
    ValidateNested,
} from 'class-validator';
import { TranslationDto } from './translation.dto';

/**
 * QZ-05 upsert-quiz-badge payload (single create/update).
 *
 * Phase 6 Plan 01 — locked contract surface (D-17..D-19).
 * Consumed by Plan 06 quiz-badges controller/service.
 *
 * QuizBadge is the "Пробное ЕНТ" model (CONTEXT D-17 — chosen over QuizCategory
 * tree for explicit ordering and existing QuizBadgeResult aggregation).
 *
 * Schema-truth notes:
 *   - QuizBadge.is_active is `Boolean @default(true)` (line 641) — defaults true here.
 *   - QuizBadge.quiz_category_id is `Int?` (line 642) — optional FK linking the badge to a
 *     hub category for browsing.
 *   - QuizBadge.created_at is `DateTime @default(now())` (line 643) — NOT Unix Int.
 *     Reflected on the response side: lib/quizzes/types.ts QuizBadge.created_at = string (ISO 8601).
 *   - QuizBadgeTranslation.title is `String @db.VarChar(255)` (line 661).
 *
 * Member quizzes are NOT in this DTO — they're managed via UpsertBadgeItemDto on a
 * separate endpoint. Keep CRUD on the badge entity itself decoupled from membership.
 */
export class UpsertBadgeDto {
    /** Omit on create. Required on update. */
    @IsOptional()
    @IsInt()
    @Min(1)
    id?: number;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    quiz_category_id?: number | null;

    /** Phase 23 — controls public-catalog visibility. Default true on schema. */
    @IsOptional()
    @IsBoolean()
    is_listed?: boolean;

    /** Phase 23 — when true, service requires price > 0 AND access_days > 0. */
    @IsOptional()
    @IsBoolean()
    is_paid?: boolean;

    /** Phase 23 — decimal string (Decimal(15,3)). Ignored unless is_paid=true. */
    @IsOptional()
    @IsNumberString({ no_symbols: false })
    price?: string | null;

    /** Phase 23 — days of access after purchase. Ignored unless is_paid=true. */
    @IsOptional()
    @IsInt()
    @Min(1)
    access_days?: number | null;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => TranslationDto)
    translations!: TranslationDto[];
}
