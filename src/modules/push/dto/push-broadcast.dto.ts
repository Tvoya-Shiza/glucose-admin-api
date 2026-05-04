import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AudienceShapeDto } from '../../audience/dto/audience-preview.dto';

/**
 * Phase 8 Plan 03 — push compose DTOs.
 *
 * - PushPayloadDto: shared title/body/category/deep_link shape used by both
 *   ad-hoc broadcast and test-to-me; reused by Plan 04 schedule.
 * - PushBroadcastDto: full broadcast (audience + payload + optional broadcast_id).
 * - PushTestDto: test-to-me payload only (audience is implicit = actor.id).
 *
 * Validation contract (D-05):
 *   - title_ru / title_kz: 1..64 chars
 *   - body_ru  / body_kz : 1..240 chars
 *   - category enum
 *   - deep_link optional, max 512 chars
 *
 * Admin-client mirror types live in glucose-admin-client/src/lib/push/types.ts.
 */

const CATEGORIES = ['info', 'promo', 'reminder', 'system'] as const;
type NotificationCategory = (typeof CATEGORIES)[number];

export class PushPayloadDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    title_ru!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    title_kz!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(240)
    body_ru!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(240)
    body_kz!: string;

    @IsIn(CATEGORIES as readonly string[])
    category!: NotificationCategory;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    deep_link?: string;
}

export class PushBroadcastDto {
    @ValidateNested()
    @Type(() => PushPayloadDto)
    payload!: PushPayloadDto;

    @ValidateNested()
    @Type(() => AudienceShapeDto)
    audience!: AudienceShapeDto;

    /**
     * Optional caller-provided broadcast_id — used to keep `attempt_id` stable
     * across retries (rare). When omitted, the controller generates a fresh UUID
     * per request. Must be a UUID — guards against caller-driven attempt_id
     * collision attempts (T-08-03-02).
     */
    @IsOptional()
    @IsUUID()
    broadcast_id?: string;
}

export class PushTestDto {
    @ValidateNested()
    @Type(() => PushPayloadDto)
    payload!: PushPayloadDto;
}
