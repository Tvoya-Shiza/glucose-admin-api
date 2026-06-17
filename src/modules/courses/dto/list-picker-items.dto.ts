import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const PICKER_ITEM_KINDS = ['lesson', 'quiz', 'assignment', 'file'] as const;
export type PickerItemKind = (typeof PICKER_ITEM_KINDS)[number];

export const PICKER_ITEM_SCOPES = ['course', 'all'] as const;
export type PickerItemScope = (typeof PICKER_ITEM_SCOPES)[number];

/**
 * Query DTO for GET /admin-api/v1/admin/courses/:id/picker-items.
 *
 * Used by two consumers: the schedules editor (pick an item already in the
 * course to schedule it) and the course-content editor (pick an entity to
 * attach as a chapter item). Discriminates on `kind` and returns a uniform
 * `{rows, total, page, page_size}` shape per glucose-admin-api list
 * conventions. Server resolves the per-kind Prisma query and flattens
 * translations to {title_kz, title_ru} so the client doesn't have to know
 * about WebinarChapter vs Files vs Quizzes vs WebinarAssignment.
 *
 * `scope` only affects `kind='quiz'` (quizzes have no `webinar_id` — they are
 * global entities linked to a course only via WebinarChapterItem rows):
 *   - 'course' (default): quizzes already attached to this course. Right for
 *     the schedules editor, where you can only schedule existing course items.
 *   - 'all': the whole quiz catalog. Right for the course-content editor, where
 *     you attach a NEW quiz — anything else is a chicken-and-egg dead end.
 * lesson/file/assignment have their own `webinar_id` and stay course-scoped
 * regardless of `scope`.
 */
export class ListPickerItemsDto {
    @IsIn(PICKER_ITEM_KINDS as unknown as string[])
    kind!: PickerItemKind;

    @IsOptional()
    @IsIn(PICKER_ITEM_SCOPES as unknown as string[])
    scope?: PickerItemScope;

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
