import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/**
 * PAY-04 — export-sales body DTO. Mirrors `ListSalesDto` (Plan 03 Task 1) for
 * filter shape so URL state from the list page round-trips into the export call
 * exactly. `format` is the only required field; everything else is optional and
 * matches the list contract.
 *
 * `page` / `page_size` / `cursor` are intentionally omitted — exports respect
 * filters + scope, but never paginate (50k server-side cap enforced in service).
 *
 * Mirrors ExportPaymentsDto (Phase 9 Plan 02) shape so the CSV/XLSX export
 * pattern is identical across modules.
 */
export class ExportSalesDto {
    @IsIn(['csv', 'xlsx'])
    @IsNotEmpty()
    format!: 'csv' | 'xlsx';

    @IsOptional()
    @IsIn(['webinar', 'quiz', 'quiz_badge'])
    type?: 'webinar' | 'quiz' | 'quiz_badge';

    @IsOptional()
    @IsIn(['credit', 'payment_channel', 'subscribe', 'group_access'])
    payment_method?: 'credit' | 'payment_channel' | 'subscribe' | 'group_access';

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    only_refunded?: boolean;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    only_manual?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_from?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_to?: number;

    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'id', 'amount'])
    sort?: 'created_at' | 'id' | 'amount';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';
}
