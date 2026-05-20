import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { AssignmentTranslationDto } from './translation.dto';

export class CreateAssignmentDto {
    /**
     * Optional course/chapter binding. When omitted the assignment is created as a
     * standalone "global" entity; the binding is established later when the
     * assignment is attached to a chapter via WebinarChapterItem (the service
     * back-fills webinar_id + chapter_id on the assignment row at that moment).
     */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    webinar_id?: number;

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

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => AssignmentTranslationDto)
    translations!: AssignmentTranslationDto[];
}
