import { Type } from 'class-transformer';
import { IsIn, IsInt, Min, ValidateNested } from 'class-validator';

/**
 * Phase 19 — discriminated target for progress-override operations.
 *
 * Either:
 *   { kind: 'user',  user_id: number }
 *   { kind: 'group', group_id: number }
 *
 * The xor invariant is enforced at the service layer (the discriminator means
 * one of user_id / group_id is always undefined). The DB rejects sales with
 * both fields set via the application guards in course-access.service.ts; for
 * overrides the same is true — see CourseContentOverride model docstring.
 */
export class OverrideTargetDto {
    @IsIn(['user', 'group'])
    kind!: 'user' | 'group';

    @Type(() => Number)
    @IsInt()
    @Min(1)
    target_id!: number;
}

/** Embedded wrapper — class-validator's @ValidateNested requires this shape. */
export class WithTarget {
    @ValidateNested()
    @Type(() => OverrideTargetDto)
    target!: OverrideTargetDto;
}
