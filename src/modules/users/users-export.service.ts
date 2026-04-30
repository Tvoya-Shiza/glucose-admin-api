import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { USER_SCOPE_RULES } from './users.scope';
import { normalizeKzPhone } from './utils/normalize-phone';
import { ExportUsersDto } from './dto/export-users.dto';

/**
 * USR-07 — export the filtered users list to CSV or XLSX (Plan 07).
 *
 * Synchronous inline export on admin-api — capped at MAX_ROWS rows per call. Worker
 * offload to `geonline-api-export` (port 4003) is documented as a Phase 9 follow-up
 * (CONTEXT D-19); Phase 3 ships inline for code-complete.
 *
 * Scope (D-21): same `USER_SCOPE_RULES` as the list endpoint — curators/teachers can
 * only export users they could see in the list (T-03-60 mitigation).
 *
 * Field selection: explicit Prisma `select` excludes `password` (T-03-61 mitigation).
 *
 * CSV: UTF-8 BOM (﻿) prepended for Excel auto-detection. Cells starting with
 * `=`, `+`, `-`, `@` are prefixed with `'` to defuse Excel/Calc formula evaluation
 * on open (OWASP CSV-injection defense, T-03-65 mitigation).
 *
 * XLSX: built via exceljs; controller sets the spreadsheetml Content-Type so the
 * BigIntStringInterceptor sidesteps the binary buffer (per CLAUDE.md note).
 */
interface ExportRow {
    id: number;
    full_name: string | null;
    email: string | null;
    mobile: string | null;
    role_name: string;
    status: string;
    group_count: number;
    last_activity: number | null;
    created_at: number;
    country_id: number | null;
    province_id: number | null;
    city_id: number | null;
    school_id: number | null;
}

@Injectable()
export class UsersExportService {
    private readonly logger = new Logger(UsersExportService.name);

    /** 50k row cap. Filtered counts greater than this should be narrowed by the caller. */
    public static readonly MAX_ROWS = 50_000;

    public static readonly COLUMNS: Array<{ key: keyof ExportRow; header: string }> = [
        { key: 'id', header: 'id' },
        { key: 'full_name', header: 'full_name' },
        { key: 'email', header: 'email' },
        { key: 'mobile', header: 'mobile' },
        { key: 'role_name', header: 'role_name' },
        { key: 'status', header: 'status' },
        { key: 'group_count', header: 'group_count' },
        { key: 'last_activity', header: 'last_activity' },
        { key: 'created_at', header: 'created_at' },
        { key: 'country_id', header: 'country_id' },
        { key: 'province_id', header: 'province_id' },
        { key: 'city_id', header: 'city_id' },
        { key: 'school_id', header: 'school_id' },
    ];

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Resolve filter + scope + soft-delete predicates and fetch up to MAX_ROWS rows.
     * Order matches list endpoint (default created_at desc + id tie-breaker).
     */
    public async fetchRows(actor: ScopeActor, dto: ExportUsersDto): Promise<ExportRow[]> {
        const filterWhere: any = {};
        if (dto.role_name) filterWhere.role_name = dto.role_name;
        if (dto.status) filterWhere.status = dto.status;
        if (typeof dto.region_id === 'number') {
            filterWhere.OR = [
                { city_id: dto.region_id },
                { province_id: dto.region_id },
                { country_id: dto.region_id },
                { school_id: dto.region_id },
            ];
        }
        if (dto.q && dto.q.trim().length > 0) {
            const raw = dto.q.trim();
            const phoneNorm = normalizeKzPhone(raw);
            const search: any[] = [
                { full_name: { contains: raw } },
                { email: { contains: raw } },
                { mobile: { contains: phoneNorm ?? raw } },
            ];
            if (filterWhere.OR) {
                filterWhere.AND = [{ OR: filterWhere.OR }, { OR: search }];
                delete filterWhere.OR;
            } else {
                filterWhere.OR = search;
            }
        }

        const scopeWhere = buildScopeWhere(actor, USER_SCOPE_RULES);
        const where: any = { ...filterWhere, ...scopeWhere, deleted_at: null };

        const sort = dto.sort ?? 'created_at';
        const order: 'asc' | 'desc' = dto.order ?? 'desc';
        const orderBy: any =
            sort === 'full_name'
                ? { full_name: order }
                : sort === 'last_activity'
                ? { last_activity: order }
                : { created_at: order };

        const raw: any[] = await this.prisma.user.findMany({
            where,
            select: {
                id: true,
                full_name: true,
                email: true,
                mobile: true,
                role_name: true,
                status: true,
                last_activity: true,
                created_at: true,
                country_id: true,
                province_id: true,
                city_id: true,
                school_id: true,
                _count: { select: { group_users: true } },
            },
            orderBy: [orderBy, { id: order }],
            take: UsersExportService.MAX_ROWS,
        });

        return raw.map((r) => ({
            id: Number(r.id),
            full_name: r.full_name ?? null,
            email: r.email ?? null,
            mobile: r.mobile ?? null,
            role_name: r.role_name,
            status: r.status,
            group_count: r._count?.group_users ?? 0,
            last_activity: r.last_activity ? Math.floor(new Date(r.last_activity).getTime() / 1000) : null,
            created_at: Number(r.created_at),
            country_id: r.country_id ?? null,
            province_id: r.province_id ?? null,
            city_id: r.city_id ?? null,
            school_id: r.school_id ?? null,
        }));
    }

    /**
     * Render rows to a UTF-8 (BOM-prefixed) CSV string. Cells starting with one of
     * `=`, `+`, `-`, `@` are prefixed with a leading apostrophe to defuse Excel/Calc
     * formula evaluation on open (OWASP CSV-injection defense, T-03-65 mitigation).
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
        lines.push(UsersExportService.COLUMNS.map((c) => c.header).join(','));
        for (const r of rows) {
            lines.push(
                UsersExportService.COLUMNS.map((c) => escape(r[c.key] as string | number | null)).join(','),
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
        const ws = wb.addWorksheet('users');
        ws.columns = UsersExportService.COLUMNS.map((c) => ({
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
