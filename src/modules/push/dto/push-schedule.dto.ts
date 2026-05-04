import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsPositive, Min, ValidateNested } from 'class-validator';
import { AudienceShapeDto } from '../../audience/dto/audience-preview.dto';
import { PushPayloadDto } from './push-broadcast.dto';

/**
 * Phase 8 Plan 04 — schedule + scheduled-list DTOs.
 *
 * D-07: schedule body = audience + payload + scheduled_at (Unix UTC; admin UI shows Asia/Almaty).
 * Server validates scheduled_at > now+30s (a small buffer to absorb clock skew + cron tick latency).
 */

const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled', 'failed'] as const;
type ScheduledPushStatusFilter = (typeof STATUSES)[number];

export class PushScheduleDto {
    @ValidateNested()
    @Type(() => PushPayloadDto)
    payload!: PushPayloadDto;

    @ValidateNested()
    @Type(() => AudienceShapeDto)
    audience!: AudienceShapeDto;

    /** Unix seconds, UTC. Server rejects values <= now+30s. */
    @IsInt()
    @Min(0)
    scheduled_at!: number;
}

export class PushScheduledListQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @IsPositive()
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @IsPositive()
    page_size?: number;

    @IsOptional()
    @IsIn(STATUSES as readonly string[])
    status?: ScheduledPushStatusFilter;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @IsPositive()
    creator_id?: number;

    @IsOptional()
    @IsIn(['scheduled_at', 'created_at'])
    sort?: 'scheduled_at' | 'created_at';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';

    // Reserved for future filters; currently ignored. Kept on the DTO so
    // forbidNonWhitelisted does not strip an empty string from a UI placeholder.
    @IsOptional()
    @IsBoolean()
    include_cancelled?: boolean;
}
