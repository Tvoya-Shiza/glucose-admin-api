import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListSchedulesDto } from './dto/list-schedules.dto';
import { CalendarSchedulesDto } from './dto/calendar-schedules.dto';
import { AnalyticsSchedulesDto } from './dto/analytics-schedules.dto';
import type {
    ScheduleAnalyticsDto,
    ScheduleCalendarResponseDto,
    ScheduleItemDto,
    ScheduleItemKind,
    ScheduleListResponseDto,
    ScheduleRowDto,
    ScheduleStatus,
} from './dto/schedule-row.dto';
import { SCHEDULE_SCOPE_RULES } from './schedules.scope';

/**
 * Read surface for LessonSchedule.
 *
 *   GET /schedules                — paginated list with filters + scope
 *   GET /schedules/calendar       — events intersecting [from, to] (no pagination)
 *   GET /schedules/analytics      — dashboard counts + sparkline + top curators
 *   GET /schedules/:id            — full detail with resolved item titles
 *
 * Item title resolution: each schedule has 0..N items where (kind, ref_id) points
 * at one of four tables. We batch-load all referenced rows + translations and
 * project a title_ru / title_kz pair per item. Items whose ref row is missing
 * (deleted content) surface with `resolved=false` so the UI can show a
 * "deleted content" placeholder rather than a broken link.
 */
@Injectable()
export class SchedulesListService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListSchedulesDto): Promise<ScheduleListResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            SchedulesListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? SchedulesListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'start_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        const where: any = this.buildBaseWhere(actor, {
            status: query.status,
            curator_id: query.curator_id,
            group_id: query.group_id,
            course_id: query.course_id,
            from: query.from,
            to: query.to,
            kind: query.kind,
            q: query.q,
        });

        const skip = (page - 1) * page_size;
        const orderBy: any = sort === 'created_at' ? { created_at: order } : { start_at: order };

        const [total, raw] = await this.prisma.$transaction([
            this.prisma.lessonSchedule.count({ where }),
            this.prisma.lessonSchedule.findMany({
                where,
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
                select: this.rowSelect(),
            }),
        ]);

        const rows = await this.mapRows(raw as any[]);
        return { rows, total, page, page_size };
    }

    public async calendar(actor: ScopeActor, query: CalendarSchedulesDto): Promise<ScheduleCalendarResponseDto> {
        const where: any = this.buildBaseWhere(actor, {
            status: query.status,
            curator_id: query.curator_id,
            group_id: query.group_id,
            course_id: query.course_id,
            from: query.from,
            to: query.to,
        });

        const raw = await this.prisma.lessonSchedule.findMany({
            where,
            orderBy: [{ start_at: 'asc' }, { id: 'asc' }],
            take: 500,
            select: this.rowSelect(),
        });

        const rows = await this.mapRows(raw as any[]);
        return { rows, from: query.from, to: query.to };
    }

    public async detail(actor: ScopeActor, id: bigint | number): Promise<ScheduleRowDto> {
        const scopeWhere = buildScopeWhere(actor, SCHEDULE_SCOPE_RULES);
        const idAsBigInt = typeof id === 'bigint' ? id : BigInt(id);
        const row = await this.prisma.lessonSchedule.findFirst({
            where: { id: idAsBigInt, deleted_at: null, ...(scopeWhere as object) },
            select: this.rowSelect(),
        });
        if (!row) {
            throw new NotFoundException({ message: 'schedule.not_found', trans: 'admin.schedules.not_found' });
        }
        const [mapped] = await this.mapRows([row as any]);
        return mapped;
    }

    public async analytics(actor: ScopeActor, query: AnalyticsSchedulesDto): Promise<ScheduleAnalyticsDto> {
        const nowSec = Math.floor(Date.now() / 1000);
        const dayLen = 24 * 60 * 60;
        const from = typeof query.from === 'number' ? query.from : nowSec - 30 * dayLen;
        const to = typeof query.to === 'number' ? query.to : nowSec + 7 * dayLen;

        const scopeWhere = buildScopeWhere(actor, SCHEDULE_SCOPE_RULES);
        const windowWhere: any = {
            deleted_at: null,
            start_at: { lte: to },
            end_at: { gte: from },
            ...(scopeWhere as object),
        };

        const [total, schedules, upcoming7d, overdueCount] = await this.prisma.$transaction([
            this.prisma.lessonSchedule.count({ where: windowWhere }),
            this.prisma.lessonSchedule.findMany({
                where: windowWhere,
                select: {
                    id: true,
                    curator_id: true,
                    start_at: true,
                    end_at: true,
                    status: true,
                    items: { select: { kind: true } },
                    curator: { select: { id: true, full_name: true } },
                },
            }),
            this.prisma.lessonSchedule.count({
                where: {
                    deleted_at: null,
                    status: { in: ['scheduled', 'in_progress'] as any },
                    start_at: { gte: nowSec, lte: nowSec + 7 * dayLen },
                    ...(scopeWhere as object),
                },
            }),
            this.prisma.lessonSchedule.count({
                where: {
                    deleted_at: null,
                    status: { in: ['scheduled', 'in_progress'] as any },
                    end_at: { lt: nowSec },
                    ...(scopeWhere as object),
                },
            }),
        ]);

        const by_status: Record<ScheduleStatus, number> = {
            draft: 0,
            scheduled: 0,
            in_progress: 0,
            completed: 0,
            cancelled: 0,
        };
        for (const s of schedules as any[]) {
            const k = s.status as ScheduleStatus;
            if (k in by_status) by_status[k] += 1;
        }

        const by_kind: Record<ScheduleItemKind, number> = { lesson: 0, quiz: 0, assignment: 0, file: 0 };
        for (const s of schedules as any[]) {
            for (const it of s.items ?? []) {
                const k = it.kind as ScheduleItemKind;
                if (k in by_kind) by_kind[k] += 1;
            }
        }

        const curatorCounts = new Map<number, { name: string | null; count: number }>();
        for (const s of schedules as any[]) {
            const cid = s.curator_id as number;
            const prev = curatorCounts.get(cid) ?? { name: s.curator?.full_name ?? null, count: 0 };
            curatorCounts.set(cid, { name: prev.name, count: prev.count + 1 });
        }
        const top_curators = Array.from(curatorCounts.entries())
            .map(([curator_id, v]) => ({ curator_id, curator_name: v.name, count: v.count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const sparkline = this.buildSparkline((schedules as any[]).map((s) => Number(s.start_at)), nowSec, 30);

        return { total, by_status, by_kind, upcoming_7d: upcoming7d, overdue_count: overdueCount, top_curators, sparkline };
    }

    // ---------------------------------------------------------------- helpers

    private buildBaseWhere(
        actor: ScopeActor,
        f: {
            status?: ScheduleStatus;
            curator_id?: number;
            group_id?: number;
            course_id?: number;
            from?: number;
            to?: number;
            kind?: ScheduleItemKind;
            q?: string;
        },
    ): any {
        const scopeWhere = buildScopeWhere(actor, SCHEDULE_SCOPE_RULES);
        const where: any = { deleted_at: null, ...(scopeWhere as object) };
        if (f.status) where.status = f.status;
        if (typeof f.curator_id === 'number') where.curator_id = f.curator_id;
        if (typeof f.group_id === 'number') where.group_id = f.group_id;
        if (typeof f.course_id === 'number') where.course_id = f.course_id;
        // window intersection: start_at <= to && end_at >= from
        if (typeof f.to === 'number') where.start_at = { ...(where.start_at ?? {}), lte: f.to };
        if (typeof f.from === 'number') where.end_at = { ...(where.end_at ?? {}), gte: f.from };
        if (f.kind) where.items = { some: { kind: f.kind } };
        if (f.q && f.q.trim().length > 0) where.description = { contains: f.q.trim() };
        return where;
    }

    private rowSelect() {
        return {
            id: true,
            curator_id: true,
            group_id: true,
            course_id: true,
            start_at: true,
            end_at: true,
            description: true,
            status: true,
            created_by: true,
            created_at: true,
            updated_at: true,
            curator: { select: { id: true, full_name: true } },
            group: { select: { id: true, name: true } },
            course: { select: { id: true, translations: { select: { locale: true, title: true } } } },
            items: {
                select: { id: true, kind: true, ref_id: true, position: true },
                orderBy: { position: 'asc' as const },
            },
        };
    }

    /**
     * Resolves item titles in batch. For each kind we pull ref_id → title_ru / title_kz
     * from the appropriate table + translations join. Items with no matching ref
     * surface as resolved=false so the UI renders "deleted content".
     */
    private async mapRows(raw: any[]): Promise<ScheduleRowDto[]> {
        const lessonIds = new Set<number>();
        const quizIds = new Set<number>();
        const assignmentIds = new Set<number>();
        const fileIds = new Set<number>();
        for (const r of raw) {
            for (const it of r.items ?? []) {
                if (it.kind === 'lesson') lessonIds.add(it.ref_id);
                else if (it.kind === 'quiz') quizIds.add(it.ref_id);
                else if (it.kind === 'assignment') assignmentIds.add(it.ref_id);
                else if (it.kind === 'file') fileIds.add(it.ref_id);
            }
        }

        const [lessons, quizzes, assignments, files] = await Promise.all([
            lessonIds.size === 0
                ? Promise.resolve([] as any[])
                : this.prisma.webinarChapter.findMany({
                      where: { id: { in: Array.from(lessonIds) } },
                      select: { id: true, translations: { select: { locale: true, title: true } } },
                  }),
            quizIds.size === 0
                ? Promise.resolve([] as any[])
                : this.prisma.quizzes.findMany({
                      where: { id: { in: Array.from(quizIds) } },
                      select: { id: true, translations: { select: { locale: true, title: true } } },
                  }),
            assignmentIds.size === 0
                ? Promise.resolve([] as any[])
                : this.prisma.webinarAssignment.findMany({
                      where: { id: { in: Array.from(assignmentIds) } },
                      select: { id: true, translations: { select: { locale: true, title: true } } },
                  }),
            fileIds.size === 0
                ? Promise.resolve([] as any[])
                : this.prisma.files.findMany({
                      where: { id: { in: Array.from(fileIds) } },
                      select: { id: true, translations: { select: { locale: true, title: true } } },
                  }),
        ]);

        const lessonMap = byId(lessons);
        const quizMap = byId(quizzes);
        const assignmentMap = byId(assignments);
        const fileMap = byId(files);

        return raw.map((r) => {
            const items: ScheduleItemDto[] = (r.items ?? []).map((it: any) => {
                const ref =
                    it.kind === 'lesson'
                        ? lessonMap.get(it.ref_id)
                        : it.kind === 'quiz'
                          ? quizMap.get(it.ref_id)
                          : it.kind === 'assignment'
                            ? assignmentMap.get(it.ref_id)
                            : fileMap.get(it.ref_id);
                const tr: Array<{ locale: string; title: string | null }> = ref?.translations ?? [];
                const title_ru = tr.find((t) => t.locale === 'ru')?.title ?? null;
                const title_kz = tr.find((t) => t.locale === 'kz')?.title ?? null;
                return {
                    id: Number(it.id),
                    kind: it.kind,
                    ref_id: Number(it.ref_id),
                    position: Number(it.position),
                    title_ru,
                    title_kz,
                    resolved: ref != null,
                };
            });

            const courseTr: Array<{ locale: string; title: string }> = r.course?.translations ?? [];
            return {
                id: Number(r.id),
                curator_id: Number(r.curator_id),
                curator_name: r.curator?.full_name ?? null,
                group_id: Number(r.group_id),
                group_name: r.group?.name ?? '',
                course_id: r.course_id == null ? null : Number(r.course_id),
                course_title_ru: courseTr.find((t) => t.locale === 'ru')?.title ?? null,
                course_title_kz: courseTr.find((t) => t.locale === 'kz')?.title ?? null,
                start_at: Number(r.start_at),
                end_at: Number(r.end_at),
                description: r.description ?? null,
                status: r.status,
                item_count: items.length,
                items,
                created_by: Number(r.created_by),
                created_at: Number(r.created_at),
                updated_at: r.updated_at == null ? null : Number(r.updated_at),
            } satisfies ScheduleRowDto;
        });
    }

    private buildSparkline(startTimestamps: number[], nowSec: number, days: number): Array<{ bucket: number; count: number }> {
        const dayLen = 24 * 60 * 60;
        const todayBucket = Math.floor(nowSec / dayLen) * dayLen;
        const earliest = todayBucket - (days - 1) * dayLen;
        const buckets: Record<number, number> = {};
        for (let i = 0; i < days; i += 1) buckets[earliest + i * dayLen] = 0;
        for (const sec of startTimestamps) {
            if (sec < earliest) continue;
            const b = Math.floor(sec / dayLen) * dayLen;
            if (b in buckets) buckets[b] += 1;
        }
        return Object.entries(buckets)
            .map(([bucket, count]) => ({ bucket: Number(bucket), count }))
            .sort((a, b) => a.bucket - b.bucket);
    }
}

function byId(rows: any[]): Map<number, any> {
    const m = new Map<number, any>();
    for (const r of rows) m.set(Number(r.id), r);
    return m;
}
