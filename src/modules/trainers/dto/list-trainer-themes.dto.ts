import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ListTrainerThemesDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page_size?: number;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    q?: string;

    /** 'true' — только активные. Без параметра список отдаёт и скрытые темы. */
    @IsOptional()
    @IsBooleanString()
    active_only?: string;
}
