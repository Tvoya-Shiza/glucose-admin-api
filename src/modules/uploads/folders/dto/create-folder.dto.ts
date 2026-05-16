import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Body for `POST /admin-api/v1/admin/folders`.
 *
 * `parent_id` omitted or null → create at root. Service derives a slug from
 * `name` (lowercased + ASCII fold) and rejects duplicates within the same parent.
 */
export class CreateFolderDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    parent_id?: number | null;
}
