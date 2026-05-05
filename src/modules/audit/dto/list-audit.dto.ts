import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Query DTO for GET /admin-api/v1/admin/audit/log (AUD-01 / AUD-02 / AUD-03).
 *
 * - All numeric fields use @Type(() => Number) so `?page=2` (string) coerces correctly,
 *   matching Phase 3 list DTO pattern (config/dto/pagination.dto.ts).
 * - page_size capped at 200 server-side (T-10-04 DoS mitigation, mirrors Phase 3).
 * - ts_from/ts_to are Unix seconds — same convention as AuditEntry.ts (Phase 2 Plan 01).
 * - entity_id is a STRING because AdminAuditLog.entity_id is VARCHAR(64) (works for
 *   BigInt + Int + composite ids).
 */
export class ListAuditDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    page_size?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    actor_id?: number;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    action?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    entity?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    entity_id?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    ts_from?: number; // Unix seconds inclusive

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    ts_to?: number; // Unix seconds inclusive
}
