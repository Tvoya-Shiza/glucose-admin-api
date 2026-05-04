import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsPositive,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';

/**
 * Phase 8 Plan 02 — AudienceShape DTO with discriminated-union per-kind validation.
 *
 * class-validator does NOT support TS discriminated unions natively, so each
 * per-kind field is gated by `@ValidateIf((o) => o.kind === '...')`. The field
 * becomes implicitly required for that kind because `@IsArray()` / `@IsInt()`
 * fail on `undefined` when the gate is open. Other kinds skip the validator.
 *
 * Global ValidationPipe (whitelist:true, forbidNonWhitelisted:true, transform:true)
 * strips/rejects extras (T-08-02-04 mitigation).
 */

const REGION_FIELDS = ['country_id', 'province_id', 'city_id', 'district_id', 'school_id'] as const;
type RegionField = (typeof REGION_FIELDS)[number];

const ROLES = ['student', 'teacher', 'curator', 'admin'] as const;
type AudienceRole = (typeof ROLES)[number];

const STATUSES = ['active', 'pending', 'inactive'] as const;
type AudienceUserStatus = (typeof STATUSES)[number];

const COHORT_TYPES = ['completed_course', 'inactive_days', 'status'] as const;
type CohortType = (typeof COHORT_TYPES)[number];

export class CohortPredicateDto {
    @IsIn(COHORT_TYPES as readonly string[])
    type!: CohortType;

    @ValidateIf((o) => o.type === 'completed_course')
    @IsInt()
    @IsPositive()
    webinar_id?: number;

    @ValidateIf((o) => o.type === 'inactive_days')
    @IsInt()
    @Min(1)
    days?: number;

    @ValidateIf((o) => o.type === 'status')
    @IsIn(STATUSES as readonly string[])
    status?: AudienceUserStatus;
}

export class AudienceFilterDto {
    @IsIn(['group', 'role', 'region', 'cohort'])
    kind!: 'group' | 'role' | 'region' | 'cohort';

    // group
    @ValidateIf((o) => o.kind === 'group')
    @IsArray()
    @ArrayMinSize(1)
    @IsInt({ each: true })
    @IsPositive({ each: true })
    group_ids?: number[];

    // role
    @ValidateIf((o) => o.kind === 'role')
    @IsArray()
    @ArrayMinSize(1)
    @IsIn(ROLES as readonly string[], { each: true })
    roles?: AudienceRole[];

    // region
    @ValidateIf((o) => o.kind === 'region')
    @IsIn(REGION_FIELDS as readonly string[])
    field?: RegionField;

    @ValidateIf((o) => o.kind === 'region')
    @IsArray()
    @ArrayMinSize(1)
    @IsInt({ each: true })
    @IsPositive({ each: true })
    region_ids?: number[];

    // cohort
    @ValidateIf((o) => o.kind === 'cohort')
    @ValidateNested()
    @Type(() => CohortPredicateDto)
    predicate?: CohortPredicateDto;
}

export class AudienceShapeDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => AudienceFilterDto)
    filters!: AudienceFilterDto[];

    @IsOptional()
    @IsBoolean()
    exclude_no_fcm?: boolean;

    @IsOptional()
    @IsBoolean()
    exclude_no_email?: boolean;

    @IsOptional()
    @IsBoolean()
    exclude_unsubscribed?: boolean;
}
