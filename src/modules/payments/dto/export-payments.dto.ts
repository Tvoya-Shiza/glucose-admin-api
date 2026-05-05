import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsNumberString, IsOptional, IsString, Min } from 'class-validator';

/**
 * PAY-04 — export-payments body DTO. Mirrors `ListPaymentsDto` (Plan 02 Task 1)
 * for filter shape so URL state from the list page round-trips into the export
 * call exactly. `format` is the only required field; everything else is optional
 * and matches the list contract.
 *
 * `page` / `page_size` / `cursor` are intentionally omitted — exports respect
 * filters + scope, but never paginate (50k server-side cap enforced in service).
 *
 * Mirrors ExportUsersDto (Phase 3 Plan 07) shape so the CSV/XLSX export pattern
 * is identical across modules.
 */
export class ExportPaymentsDto {
    @IsIn(['csv', 'xlsx'])
    @IsNotEmpty()
    format!: 'csv' | 'xlsx';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    status?: number;

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
    @IsNumberString()
    amount_min?: string;

    @IsOptional()
    @IsNumberString()
    amount_max?: string;

    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @IsIn(['txn_date', 'id', 'sum'])
    sort?: 'txn_date' | 'id' | 'sum';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';
}
