import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

/** One motivational-text percent range (mirrors CreditResultTextRange from @shared/credits). */
export class CreditResultTextRangeDto {
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100)
    min!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100)
    max!: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(1000)
    text_kz!: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    text_ru?: string;
}

/**
 * Body for PATCH /admin-api/v1/admin/credit-settings/result-texts.
 * Exactly 4 contiguous ranges covering 0–100 (0-25 / 26-50 / 51-75 / 76-100) —
 * contiguity is validated in the service (422 credits.invalid_result_texts).
 */
export class UpdateResultTextsDto {
    @IsArray()
    @ArrayMinSize(4)
    @ArrayMaxSize(4)
    @ValidateNested({ each: true })
    @Type(() => CreditResultTextRangeDto)
    ranges!: CreditResultTextRangeDto[];
}
