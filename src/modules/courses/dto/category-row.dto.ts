/**
 * Response shape for `GET /admin-api/v1/admin/courses/categories`.
 *
 * Read-only surface used by the create-course / change-category dialogs to populate
 * the category picker. Surface is KZ-only.
 */
export class CourseCategoryRowDto {
    id!: number;
    parent_id!: number | null;
    slug!: string;
    icon!: string | null;
    title_kz!: string | null;
}

export class CourseCategoryListResponseDto {
    rows!: CourseCategoryRowDto[];
    total!: number;
}
