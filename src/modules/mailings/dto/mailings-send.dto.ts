import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { AudienceShapeDto } from '../../audience/dto/audience-preview.dto';

/**
 * Phase 8 Plan 05 — MailingsSendDto (PSH-05).
 *
 * Wire shape mirrored client-side at glucose-admin-client/src/lib/mailings/types.ts (MailingSendInput).
 *
 * Validation contract:
 *   - subject: required, ≤ 255 chars (T-08-05-02 SMTP header injection — class-validator
 *     @IsString does not permit raw CR/LF and nodemailer escapes header values).
 *   - html:    required, ≤ 100_000 chars. NOT sanitized in v1 — admin is trusted (T-08-05-04).
 *   - text:    optional plain-text fallback. When omitted, MailerService strips HTML.
 *   - category: enum (D-15 MailingLog.category column).
 *   - audience: AudienceShape — server forces exclude_no_email=true regardless of input.
 *   - broadcast_id: optional UUID — used to keep attempt_id stable across retries.
 *
 * Global ValidationPipe (whitelist:true, forbidNonWhitelisted:true, transform:true)
 * strips/rejects extras.
 */

const CATEGORIES = ['marketing', 'transactional', 'reminder', 'system'] as const;
type MailingCategory = (typeof CATEGORIES)[number];

export class MailingSendDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    subject!: string;

    /**
     * HTML body. Server forwards to SMTP as-is — recipient mail clients sanitize at
     * render time. v1 acceptance per T-08-05-04: admin user is trusted (TFA-protected
     * staff). Phase 9+ may add a server-side sanitizer once attack surface is reviewed.
     */
    @IsString()
    @IsNotEmpty()
    @MaxLength(100_000)
    html!: string;

    /** Optional plain-text fallback. When omitted, MailerService strips HTML tags. */
    @IsOptional()
    @IsString()
    @MaxLength(100_000)
    text?: string;

    @IsIn(CATEGORIES as readonly string[])
    category!: MailingCategory;

    @ValidateNested()
    @Type(() => AudienceShapeDto)
    audience!: AudienceShapeDto;

    /**
     * Optional caller-provided broadcast_id — used to keep `attempt_id` stable
     * across retries. When omitted, the service generates a fresh UUID per request.
     * Must be a UUID — guards against caller-driven attempt_id collision attempts
     * (parity with PushBroadcastDto.broadcast_id, T-08-03-02 mitigation).
     */
    @IsOptional()
    @IsUUID()
    broadcast_id?: string;
}
