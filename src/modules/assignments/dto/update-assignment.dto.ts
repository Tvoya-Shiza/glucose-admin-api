import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { AssignmentTranslationDto } from './translation.dto';

export class UpdateAssignmentDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    chapter_id?: number;

    @IsOptional()
    @IsIn(['active', 'inactive'])
    status?: 'active' | 'inactive';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    grade?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    pass_grade?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    deadline?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    attempts?: number;

    @IsOptional()
    @IsBoolean()
    check_previous_parts?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    access_after_day?: number;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => AssignmentTranslationDto)
    translations?: AssignmentTranslationDto[];
}

export class ToggleAssignmentStatusDto {
    @IsIn(['active', 'inactive'])
    status!: 'active' | 'inactive';
}
