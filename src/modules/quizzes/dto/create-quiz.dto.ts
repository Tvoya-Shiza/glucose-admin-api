import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNumberString,
    IsOptional,
    Min,
    ValidateNested,
} from 'class-validator';
import { TranslationDto } from './translation.dto';

/**
 * QZ-03 create-quiz payload.
 *
 * Phase 6 Plan 01 — locked contract surface (D-04..D-05 from CONTEXT).
 * Consumed by Plan 02 mutations service.
 *
 * Schema-truth notes:
 *   - Quizzes.pass_mark is `Int` (line 465) — NOT NULL on schema; required here.
 *   - Quizzes.certificate is `Boolean` (line 466) — NOT NULL on schema; defaults
 *     to false in this DTO so create payloads don't have to spell it out.
 *   - Quizzes.time is `Int? @default(0)` — null|0 means "no limit". DTO accepts null.
 *   - Quizzes.attempt is `Int?` — null means "unlimited". DTO accepts null.
 *   - Quizzes.creator_id does NOT exist on schema — there is no creator FK on
 *     Quizzes; @Audit captures actor_id at the audit layer instead.
 *   - At least 1 translation; max 2 (ru + kz). Single-locale create is allowed
 *     but the row badges as 'incomplete'.
 *   - subject_id / category_id are nullable FKs — DTO leaves both optional.
 *
 * Pricing fields (Phase 22):
 *   - is_listed defaults to true on schema; explicit false hides quiz from
 *     public catalog (still usable inside courses + badges).
 *   - is_paid defaults to false. When true, service enforces
 *     price > 0 AND access_days > 0.
 *   - price is sent as a decimal string (matches Prisma's Decimal contract;
 *     BigInt-as-string convention applied to admin-api responses too).
 *
 * Excluded fields (NOT writable from this DTO):
 *   - total_mark (server-computed from questions[].grade SUM)
 *   - version (server-only — Phase 1.08 versioning)
 */
export type CreateQuizStatus = 'active' | 'inactive';

export class CreateQuizDto {
    @IsOptional()
    @IsIn(['active', 'inactive'])
    status?: CreateQuizStatus;

    @IsOptional()
    @IsInt()
    @Min(1)
    category_id?: number | null;

    @IsOptional()
    @IsInt()
    @Min(1)
    subject_id?: number | null;

    /** Seconds. null or 0 = no time limit. */
    @IsOptional()
    @IsInt()
    @Min(0)
    time?: number | null;

    @IsInt()
    @Min(0)
    pass_mark!: number;

    /** null = unlimited attempts. */
    @IsOptional()
    @IsInt()
    @Min(1)
    attempt?: number | null;

    @IsOptional()
    @IsBoolean()
    certificate?: boolean;

    @IsOptional()
    @IsBoolean()
    display_questions_randomly?: boolean;

    @IsOptional()
    @IsInt()
    @Min(0)
    expiry_days?: number | null;

    /** Phase 22 — controls public-catalog visibility. Default true on schema. */
    @IsOptional()
    @IsBoolean()
    is_listed?: boolean;

    /** Phase 22 — when true, service requires price > 0 AND access_days > 0. */
    @IsOptional()
    @IsBoolean()
    is_paid?: boolean;

    /** Phase 22 — decimal string (Decimal(15,3)). Ignored unless is_paid=true. */
    @IsOptional()
    @IsNumberString({ no_symbols: false })
    price?: string | null;

    /** Phase 22 — days of access after purchase. Ignored unless is_paid=true. */
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
