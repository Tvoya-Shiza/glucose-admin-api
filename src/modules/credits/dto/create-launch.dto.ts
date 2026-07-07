import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Max,
    Min,
    Validate,
    ValidationArguments,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from 'class-validator';
import type { CreditDifficulty, CreditPassType } from '@shared/credits';

/**
 * Cross-field rule (contract §launches): difficulty_template.length MUST equal
 * question_count (per-topic template, decision 5). Runs after the per-element
 * @IsIn check; question_count falls back to its default (5) when omitted.
 */
@ValidatorConstraint({ name: 'difficultyTemplateLength', async: false })
export class DifficultyTemplateLengthValidator implements ValidatorConstraintInterface {
    public validate(template: unknown, args: ValidationArguments): boolean {
        const dto = args.object as CreateLaunchDto;
        const count = typeof dto.question_count === 'number' ? dto.question_count : 5;
        return Array.isArray(template) && template.length === count;
    }

    public defaultMessage(args: ValidationArguments): string {
        const dto = args.object as CreateLaunchDto;
        const count = typeof dto.question_count === 'number' ? dto.question_count : 5;
        return `difficulty_template must contain exactly question_count (${count}) entries`;
    }
}

/** Body for POST /admin-api/v1/admin/credits/:id/launches (wizard, contract §launches). */
export class CreateLaunchDto {
    @IsArray()
    @ArrayMinSize(1)
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    student_ids!: number[];

    /** Credit-topic BigInt ids as decimal strings. */
    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    @Matches(/^\d+$/, { each: true, message: 'each topic_id must be a decimal id string' })
    topic_ids!: string[];

    /** PER TOPIC (decision 5). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    question_count?: number = 5;

    @IsArray()
    @ArrayMinSize(1)
    @IsIn(['A', 'B', 'C'], { each: true })
    @Validate(DifficultyTemplateLengthValidator)
    difficulty_template!: CreditDifficulty[];

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(60)
    @Max(14400)
    duration_sec?: number = 420;

    @IsOptional()
    @IsIn(['percent', 'points'])
    pass_type?: CreditPassType = 'percent';

    /** ≤ 100 when pass_type='percent' — enforced in the service (422). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    pass_value?: number = 50;
}
