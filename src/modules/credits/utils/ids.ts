import { BadRequestException } from '@nestjs/common';

/**
 * Parses a credit-domain id (BigInt on the wire as a decimal string) into a BigInt.
 * Credit-domain ids must NEVER go through Number() — beyond 2^53 they silently lose
 * precision. Route params and DTO id strings all funnel through here.
 */
export function parseBigIntId(raw: string | undefined | null, label = 'id'): bigint {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
        throw new BadRequestException({ code: 'credits.invalid_id', message: `credits.invalid_id: ${label}` });
    }
    return BigInt(raw);
}
