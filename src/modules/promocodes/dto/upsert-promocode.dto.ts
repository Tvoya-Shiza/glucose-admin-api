import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';

/**
 * PRM-01 — upsert-promocode DTO (Phase 7 Plan 05).
 *
 * Single shape used for both POST (create) and PATCH (update). The service
 * differentiates create vs update at the call site, not via DTO shape.
 *
 * Schema-truth (Plan 01 lock):
 *   - Promocode.code @unique varchar(255) — service catches Prisma P2002 → 409
 *     'code_already_exists'. Even on update, swapping code can collide.
 *   - Promocode.discount_type is plain VARCHAR — DTO @IsIn enforces 'percentage'|'fixed'.
 *   - Promocode.discount_value Decimal(10,2) — DTO accepts as string with regex
 *     `^\d{1,8}(\.\d{1,2})?$`; Prisma decodes to Decimal at the boundary.
 *   - max_discount_amount / minimum_order_amount Decimal(15,2) — same posture.
 *   - applicable_to is `Json?` — service validates the discriminated union shape
 *     `{type:'global'} | {type:'course', course_ids:number[]}`. Defensive normalization
 *     drops course_ids when type==='global' (T-07-05-06).
 *   - start_date / expires_at are unix seconds; service additionally validates
 *     expires_at > start_date.
 *   - course_ids capped @ArrayMaxSize(500) (T-07-05-10 DoS mitigation).
 *
 * All wire field names are snake_case per CLAUDE.md.
 */
export class ApplicableToDto {
    @IsIn(['global', 'course'])
    type!: 'global' | 'course';

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(500)
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    course_ids?: number[];
}

export class UpsertPromocodeDto {
    @IsString()
    @MinLength(2)
    @MaxLength(255)
    @Matches(/^[A-Z0-9_-]+$/, { message: 'code_format_invalid' })
    code!: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    title?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    @IsIn(['percentage', 'fixed'])
    discount_type!: 'percentage' | 'fixed';

    /** Decimal(10,2) on schema; admin-client sends as string. */
    @IsString()
    @Matches(/^\d{1,8}(\.\d{1,2})?$/, { message: 'discount_value_format_invalid' })
    discount_value!: string;

    @IsOptional()
    @IsString()
    @Matches(/^\d{1,13}(\.\d{1,2})?$/, { message: 'max_discount_amount_format_invalid' })
    max_discount_amount?: string | null;

    @IsOptional()
    @IsString()
    @Matches(/^\d{1,13}(\.\d{1,2})?$/, { message: 'minimum_order_amount_format_invalid' })
    minimum_order_amount?: string | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    usage_limit?: number | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    usage_limit_per_user?: number | null;

    @IsBoolean()
    is_active!: boolean;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    start_date!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    expires_at!: number;

    @IsOptional()
    @ValidateNested()
    @Type(() => ApplicableToDto)
    applicable_to?: ApplicableToDto | null;

    @IsOptional()
    @IsBoolean()
    first_purchase_only?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    region_id?: number | null;
}
