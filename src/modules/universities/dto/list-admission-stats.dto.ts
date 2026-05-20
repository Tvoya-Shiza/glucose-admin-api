import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListAdmissionStatsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(500)
    page_size?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    university_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    specialty_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(2000)
    @Max(2100)
    year?: number;
}
