import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PAY-03 — refund body. Reason is required (D-08 — UI rhf+zod also enforces;
 * server is the source of truth). Stored only in the audit-log meta — Sale has
 * no `reason` column (schema fact, prisma/schema.prisma:715-746).
 *
 * @MinLength(3)/@MaxLength(500) bound the reason so log spam is bounded
 * (T-09-03-04 mitigation). class-validator's global ValidationPipe rejects
 * payloads with extra fields (whitelist + forbidNonWhitelisted set in main.ts).
 */
export class RefundSaleDto {
    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    @MaxLength(500)
    refund_reason!: string;
}
