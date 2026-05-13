/**
 * Response shape for `GET /admin-api/v1/admin/courses/categories`.
 *
 * Read-only surface used by the create-course / change-category dialogs to populate
 * the category picker. Translation rows are flattened RU + KZ to match the bilingual
 * convention from `BlogCategoryListRow` (see `blog-categories.service.ts`).
 */
export class CourseCategoryRowDto {
    id!: number;
    parent_id!: number | null;
    slug!: string;
    icon!: string | null;
    title_ru!: string | null;
    title_kz!: string | null;
}

export class CourseCategoryListResponseDto {
    rows!: CourseCategoryRowDto[];
    total!: number;
}
