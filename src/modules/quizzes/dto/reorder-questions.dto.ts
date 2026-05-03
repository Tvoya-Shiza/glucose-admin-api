import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Min, ValidateNested } from 'class-validator';

/**
 * QZ-04 reorder-questions payload.
 *
 * Phase 6 Plan 01 — locked contract surface (D-10 + D-11).
 * Consumed by Plan 05 questions service.
 *
 * Endpoint (Plan 05): PATCH /admin-api/v1/admin/quizzes/:id/questions/reorder
 *
 * D-11 — REORDER IS NOT DESTRUCTIVE. Service does NOT bump Quizzes.version on
 * this path. No force_confirm_token needed; in-flight QuizResult rows are
 * unaffected by question order (the grader uses question IDs, not positions).
 *
 * Service commits in a single prisma.$transaction; UI uses TanStack Query
 * optimistic mutation with rollback on failure (mirrors Plan 5 chapter reorder).
 *
 * Cap: 2000 questions per quiz — defends against pathological payloads.
 *
 * Schema-truth note: QuizQuestion.order is `Int? @db.UnsignedInt` (line 567)
 * → accepted as ≥0 here.
 */
export class ReorderQuestionsItem {
    @IsInt()
    @Min(1)
    id!: number;

    @IsInt()
    @Min(0)
    order!: number;
}

export class ReorderQuestionsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2000)
    @ValidateNested({ each: true })
    @Type(() => ReorderQuestionsItem)
    items!: ReorderQuestionsItem[];
}
