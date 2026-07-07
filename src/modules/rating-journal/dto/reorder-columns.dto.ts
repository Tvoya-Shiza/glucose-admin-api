import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, Matches, Min, ValidateNested } from 'class-validator';

export class ReorderColumnItem {
    @IsString()
    @Matches(/^\d+$/, { message: 'id must be a decimal id string' })
    id!: string;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    position!: number;
}

/**
 * Body for PATCH /admin-api/v1/admin/rating-journal/columns/reorder — drag-drop
 * reorder. All ids must belong to the same journal (guarded in-service).
 */
export class ReorderColumnsDto {
    @IsArray()
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => ReorderColumnItem)
    order!: ReorderColumnItem[];
}
