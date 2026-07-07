import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import type { CreditBankStatus } from '@shared/credits';

/**
 * Body for PATCH /admin-api/v1/admin/credit-topics/:id.
 * `parent_id: null` re-roots the topic; a non-null value triggers the ancestor cycle check.
 */
export class UpdateCreditTopicDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\d+$/, { message: 'parent_id must be a decimal id string' })
    parent_id?: string | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    position?: number;

    @IsOptional()
    @IsIn(['active', 'archived'])
    status?: CreditBankStatus;
}
