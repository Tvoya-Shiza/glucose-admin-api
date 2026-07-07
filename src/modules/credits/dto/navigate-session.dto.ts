import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** Body for PATCH /admin-api/v1/admin/credit-sessions/:id/current — upper bound (N) checked in the service. */
export class NavigateSessionDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    position!: number;
}
