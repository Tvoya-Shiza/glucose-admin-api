import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const PICKER_ITEM_KINDS = ['lesson', 'quiz', 'assignment', 'file'] as const;
export type PickerItemKind = (typeof PICKER_ITEM_KINDS)[number];

/**
 * Query DTO for GET /admin-api/v1/admin/courses/:id/picker-items.
 *
 * Used by the schedules editor picker — discriminates on `kind` and returns a
 * uniform `{rows, total, page, page_size}` shape per glucose-admin-api list
 * conventions. Server resolves the per-kind Prisma query and flattens
 * translations to {title_kz, title_ru} so the client doesn't have to know
 * about WebinarChapter vs Files vs Quizzes vs WebinarAssignment.
 */
export class ListPickerItemsDto {
    @IsIn(PICKER_ITEM_KINDS as unknown as string[])
    kind!: PickerItemKind;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    q?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    page_size?: number;
}

export interface PickerItemRow {
    id: number;
    title_kz: string | null;
    title_ru: string | null;
}

export interface PickerItemsResponseDto {
    rows: PickerItemRow[];
    total: number;
    page: number;
    page_size: number;
}
