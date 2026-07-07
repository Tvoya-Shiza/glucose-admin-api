import { BadRequestException } from '@nestjs/common';

/**
 * Parses a rating-journal-domain id (BigInt on the wire as a decimal string)
 * into a BigInt. These ids must NEVER go through Number() — beyond 2^53 they
 * silently lose precision. Route params and DTO id strings all funnel here.
 */
export function parseBigIntId(raw: string | undefined | null, label = 'id'): bigint {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
        throw new BadRequestException({ code: 'rating_journal.invalid_id', message: `rating_journal.invalid_id: ${label}` });
    }
    return BigInt(raw);
}
