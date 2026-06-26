import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportSalesDto } from './dto/export-sales.dto';
import { SalesListService } from './sales-list.service';
import { SALE_SCOPE_RULES } from './sales.scope';

/**
 * PAY-04 — export the filtered Sale list to CSV or XLSX (Plan 03 Task 3).
 *
 * Synchronous inline export on admin-api — capped at MAX_ROWS rows per call.
 * Mirrors Phase 9 Plan 02 (PaymentsExportService) verbatim including BOM +
 * formula-injection defense + spreadsheetml Content-Type contract. Worker
 * offload to `geonline-api-export` is deferred.
 *
 * Scope (D-18, D-20): same `SALE_SCOPE_RULES` as the list endpoint — access is
 * governed at runtime by @RequirePermission('sales.export'); any admitted role
 * holding the grant exports all rows (SALE_SCOPE_RULES omits all roles -> {}).
 *
 * Filter parity: `fetchRows` reuses `SalesListService.buildFilterWhere` so
 * filters applied to the list page round-trip exactly into the export.
 *
 * Field selection (D-09): exports include id + buyer denormalized columns +
 * type + payment_method + amount + total_amount + manual_added + created_at +
 * refund_at + product ids + product_label. 16 columns total.
 *
 * CSV: UTF-8 BOM (﻿) prepended for Excel auto-detection. Cells starting with
 * `=`, `+`, `-`, `@` are prefixed with `'` to defuse Excel/Calc formula
 * evaluation on open (OWASP CSV-injection defense, T-09-03-07 mitigation).
 *
 * XLSX: built via exceljs; controller sets the spreadsheetml Content-Type so
 * the BigIntStringInterceptor sidesteps the binary buffer (per CLAUDE.md note).
 */
interface ExportRow {
    id: number;
    /**
     * Phase 18 — discriminator:
     *   - 'user'  → direct (per-user) sale; buyer_* populated, group_id NULL.
     *   - 'group' → group-scoped grant; group_id populated, buyer_* NULL.
     */
    target_type: 'user' | 'group';
    /** Synthetic display label: buyer full_name (or fallback) for users, group.name for groups. */
    target_label: string | null;
    buyer_id: number | null;
    buyer_full_name: string | null;
    buyer_email: string | null;
    buyer_mobile: string | null;
    group_id: number | null;
    type: 'webinar' | 'quiz' | 'quiz_badge' | null;
    payment_method: 'credit' | 'payment_channel' | 'subscribe' | 'group_access' | null;
    amount: string;
    total_amount: string | null;
    manual_added: boolean;
    created_at: number;
    refund_at: number | null;
    webinar_id: number | null;
    quiz_id: number | null;
    quiz_badge_id: number | null;
    product_label: string | null;
}

@Injectable()
export class SalesExportService {
    private readonly logger = new Logger(SalesExportService.name);

    /** 50k row cap. Filtered counts greater than this should be narrowed by the caller. */
    public static readonly MAX_ROWS = 50_000;

    public static readonly COLUMNS: Array<{ key: keyof ExportRow; header: string }> = [
        { key: 'id', header: 'id' },
        { key: 'target_type', header: 'target_type' },
        { key: 'target_label', header: 'target_label' },
        { key: 'buyer_id', header: 'buyer_id' },
        { key: 'buyer_full_name', header: 'buyer_full_name' },
        { key: 'buyer_email', header: 'buyer_email' },
        { key: 'buyer_mobile', header: 'buyer_mobile' },
        { key: 'group_id', header: 'group_id' },
        { key: 'type', header: 'type' },
        { key: 'payment_method', header: 'payment_method' },
        { key: 'amount', header: 'amount' },
        { key: 'total_amount', header: 'total_amount' },
        { key: 'manual_added', header: 'manual_added' },
        { key: 'created_at', header: 'created_at' },
        { key: 'refund_at', header: 'refund_at' },
        { key: 'webinar_id', header: 'webinar_id' },
        { key: 'quiz_id', header: 'quiz_id' },
        { key: 'quiz_badge_id', header: 'quiz_badge_id' },
        { key: 'product_label', header: 'product_label' },
    ];

    constructor(
        private readonly prisma: PrismaService,
        private readonly listService: SalesListService,
    ) {}

    /**
     * Resolve filter + scope predicates and fetch up to MAX_ROWS rows.
     * Order matches list endpoint (default created_at desc + id tie-breaker).
     */
    public async fetchRows(actor: ScopeActor, dto: ExportSalesDto): Promise<ExportRow[]> {
        const filterWhere = this.listService.buildFilterWhere(dto);
        const scopeWhere = buildScopeWhere(actor, SALE_SCOPE_RULES);
        const where: any = { ...filterWhere, ...scopeWhere };

        const sort = dto.sort ?? 'created_at';
        const order: 'asc' | 'desc' = dto.order ?? 'desc';
        const orderBy: any =
            sort === 'id'
                ? { id: order }
                : sort === 'amount'
                ? { amount: order }
                : { created_at: order };

        const raw: any[] = await this.prisma.sale.findMany({
            where,
            select: {
                id: true,
                buyer_id: true,
                seller_id: true,
                type: true,
                payment_method: true,
                amount: true,
                total_amount: true,
                manual_added: true,
                created_at: true,
                refund_at: true,
                webinar_id: true,
                quiz_id: true,
                quiz_badge_id: true,
                buyer: { select: { full_name: true, email: true, mobile: true } },
                group_id: true,
                group: { select: { name: true } },
                webinar: {
                    select: {
                        translations: {
                            where: { locale: 'kz' },
                            select: { title: true },
                            take: 1,
                        },
                    },
                },
                quiz: {
                    select: {
                        translations: {
                            where: { locale: 'kz' },
                            select: { title: true },
                            take: 1,
                        },
                    },
                },
                quiz_badge: {
                    select: {
                        translations: {
                            where: { locale: 'kz' },
                            select: { title: true },
                            take: 1,
                        },
                    },
                },
            },
            orderBy: [orderBy, { id: order }],
            take: SalesExportService.MAX_ROWS,
        });

        return raw.map((r) => {
            const target_type: 'user' | 'group' = r.group_id !== null && r.group_id !== undefined ? 'group' : 'user';
            const target_label =
                target_type === 'group'
                    ? r.group?.name ?? null
                    : r.buyer?.full_name ?? r.buyer?.email ?? r.buyer?.mobile ?? null;
            return {
                id: Number(r.id),
                target_type,
                target_label,
                buyer_id: r.buyer_id ?? null,
                buyer_full_name: r.buyer?.full_name ?? null,
                buyer_email: r.buyer?.email ?? null,
                buyer_mobile: r.buyer?.mobile ?? null,
                group_id: r.group_id ?? null,
                type: r.type ?? null,
                payment_method: r.payment_method ?? null,
                amount: r.amount?.toString() ?? '0',
                total_amount: r.total_amount?.toString() ?? null,
                manual_added: !!r.manual_added,
                created_at: Number(r.created_at),
                refund_at: r.refund_at ?? null,
                webinar_id: r.webinar_id ?? null,
                quiz_id: r.quiz_id ?? null,
                quiz_badge_id: r.quiz_badge_id ?? null,
                product_label: this.listService.deriveProductLabel(r),
            };
        });
    }

    /**
     * Render rows to a UTF-8 (BOM-prefixed) CSV string. Cells starting with one
     * of `=`, `+`, `-`, `@` are prefixed with a leading apostrophe to defuse
     * Excel/Calc formula evaluation on open (OWASP CSV-injection defense,
     * T-09-03-07 mitigation).
     */
    public toCsv(rows: ExportRow[]): string {
        const escape = (v: string | number | boolean | null | undefined): string => {
            if (v === null || v === undefined) return '';
            let s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
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
        lines.push(SalesExportService.COLUMNS.map((c) => c.header).join(','));
        for (const r of rows) {
            lines.push(
                SalesExportService.COLUMNS.map((c) =>
                    escape(r[c.key] as string | number | boolean | null),
                ).join(','),
            );
        }
        // Prepend UTF-8 BOM so Excel detects encoding correctly when opening the .csv.
        return '﻿' + lines.join('\n');
    }

    /**
     * Render rows to an XLSX Buffer via exceljs. Controller sets the
     * spreadsheetml Content-Type before send so the BigIntStringInterceptor
     * sidesteps the binary.
     */
    public async toXlsx(rows: ExportRow[]): Promise<Buffer> {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('sales');
        ws.columns = SalesExportService.COLUMNS.map((c) => ({
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
