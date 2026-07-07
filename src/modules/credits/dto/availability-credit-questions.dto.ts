import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * Query DTO for GET /admin-api/v1/admin/credit-questions/availability.
 * `topic_ids` is a comma-separated list of decimal id strings, e.g. `?topic_ids=1,2,3`.
 */
export class AvailabilityCreditQuestionsDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^\d+(,\d+)*$/, { message: 'topic_ids must be a comma-separated list of decimal ids' })
    topic_ids!: string;
}
