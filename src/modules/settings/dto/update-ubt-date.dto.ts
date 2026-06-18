import { IsISO8601, IsNotEmpty, IsString } from 'class-validator';

/**
 * Body for PATCH /admin-api/v1/admin/settings/ubt-date.
 *
 * `date` is an ISO-8601 string. The admin-client sends a full datetime carrying
 * the Almaty offset (`YYYY-MM-DDT00:00:00+05:00`) so the stored value preserves
 * the timezone convention the countdown timer relies on. A plain `YYYY-MM-DD`
 * date is also accepted.
 */
export class UpdateUbtDateDto {
    @IsString()
    @IsNotEmpty()
    @IsISO8601()
    date!: string;
}
