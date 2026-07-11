import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { CREDIT_RESULT_TEXTS_DEFAULT, CREDIT_RESULT_TEXTS_KEY, type CreditResultTextRange } from '@shared/credits';
import { UpdateResultTextsDto } from './dto/update-result-texts.dto';
import { nowSec } from './utils/time';

/**
 * Motivational result texts (contract §settings, decision 13).
 *
 * Stored as JSON under app_settings key `credit_result_texts`. Defaults come
 * from CREDIT_RESULT_TEXTS_DEFAULT in shared-types and are NEVER seeded into
 * the DB — code falls back when the key is absent (or unparseable).
 */
@Injectable()
export class CreditsSettingsService {
    private readonly logger = new Logger(CreditsSettingsService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async getResultTexts() {
        const ranges = await this.readRanges();
        return apiResponse(1, 'retrieved', 'admin.credits.result_texts_retrieved', { ranges });
    }

    /**
     * Motivational text for a score percent, from the admin-editable ranges.
     * Percent is clamped into [0, 100]; ranges use inclusive bounds; KZ text is
     * preferred with RU fallback. Misconfigured ranges (no match) → ''.
     * Used by the conduct console + student result to show a per-student message.
     */
    public async resolveMotivationalText(percent: number): Promise<string> {
        const ranges = await this.readRanges();
        const clamped = Math.min(100, Math.max(0, percent));
        const range = ranges.find((r) => clamped >= r.min && clamped <= r.max);
        return range ? range.text_kz || range.text_ru || '' : '';
    }

    public async updateResultTexts(dto: UpdateResultTextsDto) {
        this.assertContiguous(dto.ranges);

        const value: CreditResultTextRange[] = dto.ranges.map((r) => ({
            min: r.min,
            max: r.max,
            text_kz: r.text_kz.trim(),
            ...(r.text_ru !== undefined ? { text_ru: r.text_ru.trim() } : {}),
        }));

        const now = nowSec();
        await this.prisma.appSetting.upsert({
            where: { key: CREDIT_RESULT_TEXTS_KEY },
            create: { key: CREDIT_RESULT_TEXTS_KEY, value: JSON.stringify(value), created_at: now },
            update: { value: JSON.stringify(value), updated_at: now },
        });

        return apiResponse(1, 'updated', 'admin.credits.result_texts_updated', { ranges: value });
    }

    // -------------------------------------------------------------- helpers

    private async readRanges(): Promise<CreditResultTextRange[]> {
        const row = await this.prisma.appSetting.findUnique({ where: { key: CREDIT_RESULT_TEXTS_KEY } });
        if (!row?.value) return CREDIT_RESULT_TEXTS_DEFAULT;
        try {
            const parsed = JSON.parse(row.value);
            if (Array.isArray(parsed) && parsed.length === 4) return parsed as CreditResultTextRange[];
            this.logger.warn(`app_settings.${CREDIT_RESULT_TEXTS_KEY} has unexpected shape — falling back to defaults`);
            return CREDIT_RESULT_TEXTS_DEFAULT;
        } catch {
            this.logger.warn(`app_settings.${CREDIT_RESULT_TEXTS_KEY} is not valid JSON — falling back to defaults`);
            return CREDIT_RESULT_TEXTS_DEFAULT;
        }
    }

    /**
     * Exactly 4 contiguous ranges covering 0–100 (0-25 / 26-50 / 51-75 / 76-100):
     * first.min=0, last.max=100, each next.min = prev.max + 1, min ≤ max, and a
     * non-empty text_kz on every range (DTO enforces presence; trim-empty caught here).
     */
    private assertContiguous(ranges: UpdateResultTextsDto['ranges']): void {
        const fail = (detail: string): never => {
            throw new UnprocessableEntityException({
                code: 'credits.invalid_result_texts',
                message: 'credits.invalid_result_texts',
                detail,
            });
        };

        const sorted = [...ranges].sort((a, b) => a.min - b.min);
        if (sorted.length !== 4) fail('exactly 4 ranges required');
        if (sorted[0].min !== 0) fail('first range must start at 0');
        if (sorted[sorted.length - 1].max !== 100) fail('last range must end at 100');
        for (let i = 0; i < sorted.length; i++) {
            const r = sorted[i];
            if (r.min > r.max) fail(`range ${i}: min > max`);
            if (i > 0 && r.min !== sorted[i - 1].max + 1) fail(`range ${i}: not contiguous with the previous range`);
            if (r.text_kz.trim().length === 0) fail(`range ${i}: text_kz must not be empty`);
        }
    }
}
