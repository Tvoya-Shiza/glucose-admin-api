import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * `parent_id` null → move to root. Service rejects cycles and self-reference.
 */
export class MoveFolderDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    parent_id?: number | null;
}
