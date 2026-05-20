import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

const toNullableInt = ({ value }: { value: unknown }) => {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : value;
};

/**
 * Stat row for (university_specialty, year). All metrics nullable — early imports
 * may have only one of {grants, threshold, threshold_rural} known. On update, missing
 * fields preserve current value (service-side `undefined` discard).
 */
export class UpsertAdmissionStatDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    university_specialty_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(2000)
    @Max(2100)
    year?: number;

    @IsOptional()
    @Transform(toNullableInt)
    @IsInt()
    @Min(0)
    grants_count?: number | null;

    @IsOptional()
    @Transform(toNullableInt)
    @IsInt()
    @Min(0)
    @Max(150)
    threshold?: number | null;

    @IsOptional()
    @Transform(toNullableInt)
    @IsInt()
    @Min(0)
    @Max(150)
    threshold_rural?: number | null;
}
