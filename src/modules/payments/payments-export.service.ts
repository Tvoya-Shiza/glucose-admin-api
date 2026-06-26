import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportPaymentsDto } from './dto/export-payments.dto';
import { PaymentsListService } from './payments-list.service';
import { KASPI_SCOPE_RULES } from './payments.scope';

/**
 * PAY-04 — export the filtered Kaspi payments list to CSV or XLSX (Plan 02 Task 2).
 *
 * Synchronous inline export on admin-api — capped at MAX_ROWS rows per call. Mirrors
 * Phase 3 Plan 07 (UsersExportService) verbatim including BOM + formula-injection
 * defense + spreadsheetml Content-Type contract. Worker offload to
 * `geonline-api-export` is deferred to a phase-9 follow-up.
 *
 * Scope (D-18, T-09-02-01): same `KASPI_SCOPE_RULES` as the list endpoint —
 * governed at runtime by @RequirePermission('payments.export'). No per-row
 * narrowing applies; any granted role exports all matching KaspiPayment rows.
 *
 * Filter parity: `fetchRows` reuses `PaymentsListService.buildFilterWhere` so
 * filters applied to the list page round-trip exactly into the export.
 *
 * Field selection (D-04 / D-09): exports are intentionally NARROW — id, txn_id,
 * txn_date, account, sum, status. `data1..data10` are NOT exported (huge Text
 * payloads; available in detail drawer only). 6 columns total.
 *
 * CSV: UTF-8 BOM (﻿) prepended for Excel auto-detection. Cells starting with
 * `=`, `+`, `-`, `@` are prefixed with `'` to defuse Excel/Calc formula evaluation
 * on open (OWASP CSV-injection defense, T-09-02-05 mitigation).
 *
 * XLSX: built via exceljs; controller sets the spreadsheetml Content-Type so the
 * BigIntStringInterceptor sidesteps the binary buffer (per CLAUDE.md note).
 */
interface ExportRow {
    id: number;
    txn_id: string;
    txn_date: number | null;
    account: number;
    sum: string;
    status: number | null;
}

@Injectable()
export class PaymentsExportService {
    private readonly logger = new Logger(PaymentsExportService.name);

    /** 50k row cap. Filtered counts greater than this should be narrowed by the caller. */
    public static readonly MAX_ROWS = 50_000;

    public static readonly COLUMNS: Array<{ key: keyof ExportRow; header: string }> = [
        { key: 'id', header: 'id' },
        { key: 'txn_id', header: 'txn_id' },
        { key: 'txn_date', header: 'txn_date' },
        { key: 'account', header: 'account' },
        { key: 'sum', header: 'sum' },
        { key: 'status', header: 'status' },
    ];

    constructor(
        private readonly prisma: PrismaService,
        private readonly listService: PaymentsListService,
    ) {}

    /**
     * Resolve filter + scope predicates and fetch up to MAX_ROWS rows.
     * Order matches list endpoint (default txn_date desc + id tie-breaker).
     */
    public async fetchRows(actor: ScopeActor, dto: ExportPaymentsDto): Promise<ExportRow[]> {
        const filterWhere = this.listService.buildFilterWhere(dto);
        const scopeWhere = buildScopeWhere(actor, KASPI_SCOPE_RULES);
        const where: any = { ...filterWhere, ...scopeWhere };

        const sort = dto.sort ?? 'txn_date';
        const order: 'asc' | 'desc' = dto.order ?? 'desc';
        const orderBy: any =
            sort === 'id'
                ? { id: order }
                : sort === 'sum'
                ? { sum: order }
                : { txn_date: order };

        const raw: any[] = await this.prisma.kaspiPayment.findMany({
            where,
            select: {
                id: true,
                txn_id: true,
                txn_date: true,
                account: true,
                sum: true,
                status: true,
            },
            orderBy: [orderBy, { id: order }],
            take: PaymentsExportService.MAX_ROWS,
        });

        return raw.map((r) => ({
            id: Number(r.id),
            txn_id: typeof r.txn_id === 'bigint' ? r.txn_id.toString() : String(r.txn_id),
            txn_date: r.txn_date ?? null,
            account: Number(r.account),
            sum: r.sum?.toString() ?? '0',
            status: r.status ?? null,
        }));
    }

    /**
     * Render rows to a UTF-8 (BOM-prefixed) CSV string. Cells starting with one of
     * `=`, `+`, `-`, `@` are prefixed with a leading apostrophe to defuse Excel/Calc
     * formula evaluation on open (OWASP CSV-injection defense, T-09-02-05 mitigation).
     */
    public toCsv(rows: ExportRow[]): string {
        const escape = (v: string | number | null | undefined): string => {
            if (v === null || v === undefined) return '';
            let s = String(v);
            // CSV-injection defense: defuse leading formula triggers.
            if (s.length > 0 && (s[0] === '=' || s[0] === '+' || s[0] === '-' || s[0] === '@')) {
                s = "'" + s;
            }
            if (/[",\n\r]/.test(s)) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        };

        const lines: string[] = [];
        lines.push(PaymentsExportService.COLUMNS.map((c) => c.header).join(','));
        for (const r of rows) {
            lines.push(
                PaymentsExportService.COLUMNS.map((c) => escape(r[c.key] as string | number | null)).join(','),
            );
        }
        // Prepend UTF-8 BOM so Excel detects encoding correctly when opening the .csv.
        return '﻿' + lines.join('\n');
    }

    /**
     * Render rows to an XLSX Buffer via exceljs. Controller sets the spreadsheetml
     * Content-Type before send so the BigIntStringInterceptor sidesteps the binary.
     */
    public async toXlsx(rows: ExportRow[]): Promise<Buffer> {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('payments');
        ws.columns = PaymentsExportService.COLUMNS.map((c) => ({
            header: c.header,
            key: String(c.key),
            width: 18,
        }));
        for (const r of rows) {
            ws.addRow(r);
        }
        ws.getRow(1).font = { bold: true };
        const arrBuf = await wb.xlsx.writeBuffer();
        return Buffer.from(arrBuf as ArrayBuffer);
    }
}
