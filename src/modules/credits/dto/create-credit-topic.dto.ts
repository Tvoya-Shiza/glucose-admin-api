import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/**
 * Body for POST /admin-api/v1/admin/credit-topics.
 * `parent_id` is a credit-domain BigInt id → decimal STRING on the wire (or null for a root topic).
 */
export class CreateCreditTopicDto {
    @IsOptional()
    @IsString()
    @Matches(/^\d+$/, { message: 'parent_id must be a decimal id string' })
    parent_id?: string | null;

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name!: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    position?: number;
}
