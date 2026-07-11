import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

/**
 * Query for POST /admin-api/v1/admin/credit-questions/import — the whole uploaded
 * batch is tagged to ONE target: EXACTLY ONE of `topic_id` (a custom bank topic)
 * or `chapter_item_id` (a course lesson). The service enforces the XOR.
 */
export class ImportCreditQuestionsDto {
    @IsOptional()
    @IsString()
    @Matches(/^\d+$/, { message: 'topic_id must be a decimal id string' })
    topic_id?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    chapter_item_id?: number;
}
