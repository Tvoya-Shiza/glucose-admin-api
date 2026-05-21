import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsInt,
    Min,
    ValidateNested,
} from 'class-validator';
import { OverrideTargetDto } from './target.dto';

/**
 * Phase 19 — DELETE /admin-api/v1/admin/courses/:courseId/overrides
 *
 * Bulk-revoke per-item content unlocks. Targets a single (target × course)
 * pair and revokes the listed items in one transaction.
 *
 * Uses DELETE-with-body (NestJS supports @Body() on @Delete handlers). If a
 * proxy rejects body-on-DELETE in the future, the path can be re-shaped to
 * `POST /overrides/revoke` without changing the service.
 */
export class BulkRevokeOverridesDto {
    @ValidateNested()
    @Type(() => OverrideTargetDto)
    target!: OverrideTargetDto;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    item_ids!: number[];
}
