import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { USER_SCOPE_RULES } from './users.scope';
import { normalizeKzPhone } from './utils/normalize-phone';
import { ExportUsersDto } from './dto/export-users.dto';
import { UsersDetailService } from './users-detail.service';
import { UsersQuizzesService } from './users-quizzes.service';

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

    constructor(
        private readonly prisma: PrismaService,
        private readonly detailService: UsersDetailService,
        private readonly quizzesService: UsersQuizzesService,
    ) {}

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

    /**
     * Per-user audit report combining profile + course access + quiz access +
     * recent payments. Uses `UsersDetailService.detail` + `UsersQuizzesService.list`
     * (same scope check those services already enforce — out-of-scope ids return 404).
     */
    public async fetchUserDetailBundle(actor: ScopeActor, userId: number): Promise<UserDetailBundle> {
        const [detail, quizzes] = await Promise.all([
            this.detailService.detail(actor, userId),
            this.quizzesService.list(actor, userId),
        ]);
        return { detail, quizzes };
    }

    public detailToCsv(bundle: UserDetailBundle): string {
        const out: string[] = [];
        const { detail, quizzes } = bundle;

        // --- Section: Profile (key/value rows) ---
        out.push('# Section: Profile');
        out.push(['field', 'value'].map(csvEscape).join(','));
        for (const [k, v] of profilePairs(detail)) {
            out.push([csvEscape(k), csvEscape(v)].join(','));
        }
        out.push('');

        // --- Section: Courses ---
        out.push('# Section: Courses');
        out.push(
            ['sale_id', 'webinar_id', 'webinar_name', 'manual_added', 'access_days', 'created_at', 'refund_at']
                .map(csvEscape)
                .join(','),
        );
        for (const c of detail.course_access) {
            out.push(
                [
                    c.sale_id,
                    c.webinar_id ?? '',
                    c.webinar_name ?? '',
                    c.manual_added ? 'true' : 'false',
                    c.access_days ?? '',
                    c.created_at,
                    c.refund_at ?? '',
                ]
                    .map(csvEscape)
                    .join(','),
            );
        }
        out.push('');

        // --- Section: Tests (access) ---
        out.push('# Section: Tests — access');
        out.push(
            ['sale_id', 'kind', 'quiz_id', 'quiz_badge_id', 'quiz_name', 'manual_added', 'access_days', 'created_at']
                .map(csvEscape)
                .join(','),
        );
        for (const t of quizzes.access) {
            out.push(
                [
                    t.sale_id,
                    t.kind,
                    t.quiz_id ?? '',
                    t.quiz_badge_id ?? '',
                    t.quiz_name ?? '',
                    t.manual_added ? 'true' : 'false',
                    t.access_days ?? '',
                    t.created_at,
                ]
                    .map(csvEscape)
                    .join(','),
            );
        }
        out.push('');

        // --- Section: Tests (results) ---
        out.push('# Section: Tests — results');
        out.push(['result_id', 'quiz_id', 'quiz_name', 'status', 'user_grade', 'created_at'].map(csvEscape).join(','));
        for (const r of quizzes.results) {
            out.push(
                [r.id, r.quiz_id, r.quiz_name ?? '', r.status, r.user_grade ?? '', r.created_at]
                    .map(csvEscape)
                    .join(','),
            );
        }
        out.push('');

        // --- Section: Payments ---
        out.push('# Section: Payments');
        out.push(['sale_id', 'amount', 'total_amount', 'created_at', 'refund_at'].map(csvEscape).join(','));
        for (const p of detail.recent_payments) {
            out.push(
                [p.id, p.amount, p.total_amount ?? '', p.created_at, p.refund_at ?? ''].map(csvEscape).join(','),
            );
        }

        return '﻿' + out.join('\n');
    }

    public async detailToXlsx(bundle: UserDetailBundle): Promise<Buffer> {
        const { detail, quizzes } = bundle;
        const wb = new ExcelJS.Workbook();

        const profileWs = wb.addWorksheet('Profile');
        profileWs.columns = [
            { header: 'field', key: 'field', width: 22 },
            { header: 'value', key: 'value', width: 48 },
        ];
        for (const [k, v] of profilePairs(detail)) {
            profileWs.addRow({ field: k, value: v });
        }
        profileWs.getRow(1).font = { bold: true };

        const coursesWs = wb.addWorksheet('Courses');
        coursesWs.columns = [
            { header: 'sale_id', key: 'sale_id', width: 12 },
            { header: 'webinar_id', key: 'webinar_id', width: 12 },
            { header: 'webinar_name', key: 'webinar_name', width: 40 },
            { header: 'manual_added', key: 'manual_added', width: 14 },
            { header: 'access_days', key: 'access_days', width: 12 },
            { header: 'created_at', key: 'created_at', width: 14 },
            { header: 'refund_at', key: 'refund_at', width: 14 },
        ];
        for (const c of detail.course_access) {
            coursesWs.addRow({
                sale_id: c.sale_id,
                webinar_id: c.webinar_id ?? '',
                webinar_name: c.webinar_name ?? '',
                manual_added: c.manual_added,
                access_days: c.access_days ?? '',
                created_at: c.created_at,
                refund_at: c.refund_at ?? '',
            });
        }
        coursesWs.getRow(1).font = { bold: true };

        const testsWs = wb.addWorksheet('Tests');
        testsWs.columns = [
            { header: 'section', key: 'section', width: 14 },
            { header: 'id', key: 'id', width: 12 },
            { header: 'kind', key: 'kind', width: 12 },
            { header: 'quiz_id', key: 'quiz_id', width: 12 },
            { header: 'quiz_badge_id', key: 'quiz_badge_id', width: 14 },
            { header: 'quiz_name', key: 'quiz_name', width: 40 },
            { header: 'status', key: 'status', width: 12 },
            { header: 'manual_added', key: 'manual_added', width: 14 },
            { header: 'access_days', key: 'access_days', width: 12 },
            { header: 'user_grade', key: 'user_grade', width: 12 },
            { header: 'created_at', key: 'created_at', width: 14 },
        ];
        for (const t of quizzes.access) {
            testsWs.addRow({
                section: 'access',
                id: t.sale_id,
                kind: t.kind,
                quiz_id: t.quiz_id ?? '',
                quiz_badge_id: t.quiz_badge_id ?? '',
                quiz_name: t.quiz_name ?? '',
                status: '',
                manual_added: t.manual_added,
                access_days: t.access_days ?? '',
                user_grade: '',
                created_at: t.created_at,
            });
        }
        for (const r of quizzes.results) {
            testsWs.addRow({
                section: 'result',
                id: r.id,
                kind: 'quiz',
                quiz_id: r.quiz_id,
                quiz_badge_id: '',
                quiz_name: r.quiz_name ?? '',
                status: r.status,
                manual_added: '',
                access_days: '',
                user_grade: r.user_grade ?? '',
                created_at: r.created_at,
            });
        }
        testsWs.getRow(1).font = { bold: true };

        const paymentsWs = wb.addWorksheet('Payments');
        paymentsWs.columns = [
            { header: 'sale_id', key: 'sale_id', width: 12 },
            { header: 'amount', key: 'amount', width: 16 },
            { header: 'total_amount', key: 'total_amount', width: 16 },
            { header: 'created_at', key: 'created_at', width: 14 },
            { header: 'refund_at', key: 'refund_at', width: 14 },
        ];
        for (const p of detail.recent_payments) {
            paymentsWs.addRow({
                sale_id: p.id,
                amount: p.amount,
                total_amount: p.total_amount ?? '',
                created_at: p.created_at,
                refund_at: p.refund_at ?? '',
            });
        }
        paymentsWs.getRow(1).font = { bold: true };

        const arrBuf = await wb.xlsx.writeBuffer();
        return Buffer.from(arrBuf as ArrayBuffer);
    }
}

interface UserDetailBundle {
    detail: Awaited<ReturnType<UsersDetailService['detail']>>;
    quizzes: Awaited<ReturnType<UsersQuizzesService['list']>>;
}

function profilePairs(detail: UserDetailBundle['detail']): Array<[string, string | number | boolean | null]> {
    return [
        ['id', detail.id],
        ['full_name', detail.full_name],
        ['email', detail.email],
        ['mobile', detail.mobile],
        ['role_name', detail.role_name],
        ['role_id', detail.role_id],
        ['status', detail.status],
        ['verified', detail.verified],
        ['about', detail.about],
        ['country_id', detail.country_id],
        ['province_id', detail.province_id],
        ['city_id', detail.city_id],
        ['school_id', detail.school_id],
        ['last_activity', detail.last_activity],
        ['created_at', detail.created_at],
        ['updated_at', detail.updated_at],
    ];
}

/** Shared CSV escape with formula-injection defense (T-03-65). */
function csvEscape(v: string | number | boolean | null | undefined): string {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (s.length > 0 && (s[0] === '=' || s[0] === '+' || s[0] === '-' || s[0] === '@')) {
        s = "'" + s;
    }
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}
