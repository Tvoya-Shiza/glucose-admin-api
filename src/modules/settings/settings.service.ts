import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Key under which the ҰБТ exam date is stored in `app_settings`. */
export const UBT_EXAM_DATE_KEY = 'ubt_exam_date';

/** Fallback used when the row is missing (mirrors the legacy hardcoded client default). */
export const UBT_EXAM_DATE_DEFAULT = '2027-05-11T00:00:00+05:00';

/**
 * Read/write surface for global app settings.
 *
 *   GET   /settings/ubt-date — current ҰБТ exam date (for the admin form)
 *   PATCH /settings/ubt-date — upsert the ҰБТ exam date
 *
 * Storage is the shared `app_settings` key/value table owned by glucose-api.
 */
@Injectable()
export class SettingsService {
    constructor(private readonly prisma: PrismaService) {}

    public async getUbtDate(): Promise<{ date: string }> {
        const row = await this.prisma.appSetting.findUnique({ where: { key: UBT_EXAM_DATE_KEY } });
        return { date: row?.value ?? UBT_EXAM_DATE_DEFAULT };
    }

    public async setUbtDate(date: string): Promise<{ date: string }> {
        const nowSec = Math.floor(Date.now() / 1000);
        const row = await this.prisma.appSetting.upsert({
            where: { key: UBT_EXAM_DATE_KEY },
            create: { key: UBT_EXAM_DATE_KEY, value: date, created_at: nowSec },
            update: { value: date, updated_at: nowSec },
        });
        return { date: row.value };
    }
}
