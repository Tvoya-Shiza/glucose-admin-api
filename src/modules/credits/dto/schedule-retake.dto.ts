import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** Body for POST /admin-api/v1/admin/credit-sessions/:id/schedule-retake — unix seconds. */
export class ScheduleRetakeDto {
    @Type(() => Number)
    @IsInt()
    @Min(0)
    retake_at!: number;
}
