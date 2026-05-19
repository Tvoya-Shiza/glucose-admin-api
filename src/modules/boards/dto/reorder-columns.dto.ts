import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

/**
 * PUT /admin-api/v1/admin/boards/:id/columns/reorder — atomic bulk position update.
 * Body shape: `{ items: [{ id, position }, ...] }`. The server validates that every
 * column ID belongs to the same board, then writes positions inside a single tx.
 */
export class ColumnPositionDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    id!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    position!: number;
}

export class ReorderColumnsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => ColumnPositionDto)
    items!: ColumnPositionDto[];
}
