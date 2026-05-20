import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListAssignmentsDto } from './dto/list-assignments.dto';
import type { AssignmentListResponseDto, AssignmentRowDto, AssignmentRowLocale } from './dto/assignment-row.dto';
import type { AssignmentDetailDto } from './dto/assignment-detail.dto';
import type { AssignmentAnalyticsDto, AssignmentSparklinePoint } from './dto/analytics-response.dto';
import { ASSIGNMENT_SCOPE_RULES } from './assignments.scope';

/**
 * Read surface for WebinarAssignment.
 *
 * Endpoints fulfilled:
 *   GET /assignments              — paginated list + counts (used by list page + picker)
 *   GET /assignments/:id          — full detail with translations + attachments + counts
 *   GET /assignments/analytics    — dashboard cards for the list page
 *
 * Schema-truth notes:
 *   - status enum: WebinarAssignmentStatus = active | inactive
 *   - status enum: WebinarAssignmentHistoryStatus = pending | passed | not_passed | not_submitted
 *   - created_at is BigInt @db.UnsignedBigInt — convert to string at the boundary
 *     per CLAUDE.md "BigInt as string" rule. The DTOs expose unix-seconds-as-string.
 *
 * Scope: admin/teacher see all; curator default-deny on the edit surface (the picker
 * + list page are blocked for curators — they only see submissions in their groups).
 */
@Injectable()
export class AssignmentsListService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListAssignmentsDto): Promise<AssignmentListResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            AssignmentsListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? AssignmentsListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        const filterWhere: any = {};
        if (query.status) filterWhere.status = query.status;
        if (typeof query.webinar_id === 'number') filterWhere.webinar_id = query.webinar_id;
        if (typeof query.chapter_id === 'number') filterWhere.chapter_id = query.chapter_id;
        if (query.q && query.q.trim().length > 0) {
            const needle = query.q.trim();
            filterWhere.translations = { some: { title: { contains: needle } } };
        }

        const scopeWhere = buildScopeWhere(actor, ASSIGNMENT_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        let orderBy: any;
        if (sort === 'deadline') {
            orderBy = { deadline: order };
        } else if (sort === 'title') {
            // Prisma can't orderBy on 1:N relation field; fall back to created_at.
            orderBy = { created_at: order };
        } else {
            orderBy = { created_at: order };
        }

        const skip = (page - 1) * page_size;

        const [total, rowsRaw] = await this.prisma.$transaction([
            this.prisma.webinarAssignment.count({ where }),
            this.prisma.webinarAssignment.findMany({
                where,
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
                select: {
                    id: true,
                    webinar_id: true,
                    chapter_id: true,
                    status: true,
                    grade: true,
                    pass_grade: true,
                    deadline: true,
                    attempts: true,
                    created_at: true,
                    webinar: {
                        select: { id: true, translations: { select: { locale: true, title: true } } },
                    },
                    translations: { select: { locale: true, title: true } },
                    attachments: { select: { id: true } },
                    history: { select: { id: true, status: true, messages: { select: { sender_id: true } } } },
                },
            }),
        ]);

        const rows: AssignmentRowDto[] = (rowsRaw as any[]).map((r: any) => this.mapRow(r));
        return { rows, total, page, page_size };
    }

    public async detail(actor: ScopeActor, id: number): Promise<AssignmentDetailDto> {
        const scopeWhere = buildScopeWhere(actor, ASSIGNMENT_SCOPE_RULES);
        const where: any = { id, ...(scopeWhere as object) };

        const row = await this.prisma.webinarAssignment.findFirst({
            where,
            select: {
                id: true,
                webinar_id: true,
                chapter_id: true,
                creator_id: true,
                status: true,
                grade: true,
                pass_grade: true,
                deadline: true,
                attempts: true,
                check_previous_parts: true,
                access_after_day: true,
                created_at: true,
                translations: { select: { locale: true, title: true, description: true } },
                attachments: { select: { id: true, title: true, attach: true } },
                history: { select: { id: true, status: true, messages: { select: { sender_id: true } } } },
            },
        });
        if (!row) {
            throw new NotFoundException({
                message: 'assignment.not_found',
                trans: 'admin.assignments.not_found',
            });
        }

        const submission_count = row.history.length;
        const pending_review_count = row.history.filter(
            (h: any) => h.status === 'pending' && h.messages.length === 0,
        ).length;

        return {
            id: Number(row.id),
            webinar_id: Number(row.webinar_id),
            chapter_id: Number(row.chapter_id),
            creator_id: Number(row.creator_id),
            status: row.status as 'active' | 'inactive',
            grade: row.grade == null ? null : Number(row.grade),
            pass_grade: row.pass_grade == null ? null : Number(row.pass_grade),
            deadline: row.deadline == null ? null : Number(row.deadline),
            attempts: row.attempts == null ? null : Number(row.attempts),
            check_previous_parts: !!row.check_previous_parts,
            access_after_day: row.access_after_day == null ? null : Number(row.access_after_day),
            translations: (row.translations ?? []).map((t: any) => ({
                locale: t.locale as 'ru' | 'kz',
                title: t.title ?? '',
                description: t.description ?? '',
            })),
            attachments: (row.attachments ?? []).map((a: any) => ({
                id: Number(a.id),
                title: a.title,
                attach: a.attach,
            })),
            submission_count,
            pending_review_count,
            created_at: String(row.created_at),
        };
    }

    public async analytics(actor: ScopeActor, assignmentId?: number): Promise<AssignmentAnalyticsDto> {
        const scopeWhere = buildScopeWhere(actor, ASSIGNMENT_SCOPE_RULES);
        const baseWhere: any = { ...(scopeWhere as object) };
        if (typeof assignmentId === 'number') baseWhere.id = assignmentId;

        const [activeAssignments, inactiveAssignments, assignmentIds] = await this.prisma.$transaction([
            this.prisma.webinarAssignment.count({ where: { ...baseWhere, status: 'active' } }),
            this.prisma.webinarAssignment.count({ where: { ...baseWhere, status: 'inactive' } }),
            this.prisma.webinarAssignment.findMany({
                where: baseWhere,
                select: { id: true },
            }),
        ]);

        const ids = assignmentIds.map((r: any) => Number(r.id));
        if (ids.length === 0) {
            return this.emptyAnalytics(activeAssignments, inactiveAssignments);
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const thirtyDaysAgo = nowSec - 30 * 24 * 60 * 60;

        const history = await this.prisma.webinarAssignmentHistory.findMany({
            where: { assignment_id: { in: ids } },
            select: {
                id: true,
                assignment_id: true,
                status: true,
                grade: true,
                created_at: true,
                messages: { select: { sender_id: true, created_at: true } },
                assignment: { select: { deadline: true } },
            },
        });

        const submissions_total = history.length;
        const submissions_30d = history.filter((h: any) => Number(h.created_at) >= thirtyDaysAgo).length;

        const passed = history.filter((h: any) => h.status === 'passed').length;
        const not_passed = history.filter((h: any) => h.status === 'not_passed').length;
        const denom = passed + not_passed;
        const completion_rate = denom === 0 ? null : passed / denom;

        const grades = history.filter((h: any) => h.status === 'passed' && h.grade != null).map((h: any) => Number(h.grade));
        const avg_grade = grades.length === 0 ? null : grades.reduce((a, b) => a + b, 0) / grades.length;

        const pending_review_count = history.filter(
            (h: any) => h.status === 'pending' && h.messages.length === 0,
        ).length;

        const deadline_missed_count = history.filter((h: any) => {
            const dl = h.assignment?.deadline;
            return h.status === 'not_submitted' && typeof dl === 'number' && dl > 0 && dl < nowSec;
        }).length;

        const ttgs: number[] = [];
        for (const h of history) {
            const firstCuratorReply = (h.messages ?? [])
                .map((m: any) => Number(m.created_at))
                .sort((a, b) => a - b)[0];
            if (firstCuratorReply == null) continue;
            const submitSec = Number(h.created_at);
            const deltaHours = (firstCuratorReply - submitSec) / 3600;
            if (deltaHours >= 0) ttgs.push(deltaHours);
        }
        const time_to_grade_median_hours = ttgs.length === 0 ? null : median(ttgs);

        const sparkline: AssignmentSparklinePoint[] = this.buildSparkline(history, nowSec, 30);

        return {
            active_count: activeAssignments,
            inactive_count: inactiveAssignments,
            submissions_total,
            submissions_30d,
            pending_review_count,
            completion_rate,
            avg_grade,
            deadline_missed_count,
            time_to_grade_median_hours,
            sparkline,
        };
    }

    private mapRow(r: any): AssignmentRowDto {
        const tr: Array<{ locale: string; title: string | null }> = r.translations ?? [];
        const ru = tr.find((t) => t.locale === 'ru')?.title?.trim() ?? '';
        const kz = tr.find((t) => t.locale === 'kz')?.title?.trim() ?? '';
        const missing_locales: AssignmentRowLocale[] = [];
        if (kz.length === 0) missing_locales.push('kz');
        if (ru.length === 0) missing_locales.push('ru');

        const webinarTr: Array<{ locale: string; title: string | null }> = r.webinar?.translations ?? [];
        const webinarTitleRu = webinarTr.find((t) => t.locale === 'ru')?.title ?? null;

        const submission_count = r.history?.length ?? 0;
        const pending_review_count = (r.history ?? []).filter(
            (h: any) => h.status === 'pending' && (h.messages ?? []).length === 0,
        ).length;

        return {
            id: Number(r.id),
            title_ru: ru.length > 0 ? ru : null,
            title_kz: kz.length > 0 ? kz : null,
            status: r.status,
            webinar_id: Number(r.webinar_id),
            webinar_title_ru: webinarTitleRu,
            chapter_id: Number(r.chapter_id),
            deadline: r.deadline == null ? null : Number(r.deadline),
            attempts: r.attempts == null ? null : Number(r.attempts),
            pass_grade: r.pass_grade == null ? null : Number(r.pass_grade),
            grade: r.grade == null ? null : Number(r.grade),
            attachment_count: r.attachments?.length ?? 0,
            submission_count,
            pending_review_count,
            translation_completeness: missing_locales.length === 0 ? 'complete' : 'incomplete',
            missing_locales,
            created_at: String(r.created_at),
        };
    }

    private buildSparkline(history: any[], nowSec: number, days: number): AssignmentSparklinePoint[] {
        const dayLen = 24 * 60 * 60;
        const todayBucket = Math.floor(nowSec / dayLen) * dayLen;
        const earliest = todayBucket - (days - 1) * dayLen;
        const buckets: Record<number, number> = {};
        for (let i = 0; i < days; i += 1) {
            buckets[earliest + i * dayLen] = 0;
        }
        for (const h of history) {
            const sec = Number(h.created_at);
            if (sec < earliest) continue;
            const b = Math.floor(sec / dayLen) * dayLen;
            if (b in buckets) buckets[b] += 1;
        }
        return Object.entries(buckets)
            .map(([bucket, submissions]) => ({ bucket: Number(bucket), submissions }))
            .sort((a, b) => a.bucket - b.bucket);
    }

    private emptyAnalytics(active: number, inactive: number): AssignmentAnalyticsDto {
        const nowSec = Math.floor(Date.now() / 1000);
        return {
            active_count: active,
            inactive_count: inactive,
            submissions_total: 0,
            submissions_30d: 0,
            pending_review_count: 0,
            completion_rate: null,
            avg_grade: null,
            deadline_missed_count: 0,
            time_to_grade_median_hours: null,
            sparkline: this.buildSparkline([], nowSec, 30),
        };
    }
}

function median(nums: number[]): number {
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
