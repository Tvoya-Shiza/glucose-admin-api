import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
    ListPickerItemsDto,
    PickerItemRow,
    PickerItemsResponseDto,
} from './dto/list-picker-items.dto';
import { flattenTranslationsToTitles } from './utils/flatten-translations';

/**
 * Backs GET /admin-api/v1/admin/courses/:id/picker-items — used by the schedules
 * editor to populate the items pickers (lesson / quiz / assignment / file) scoped
 * to ONE course.
 *
 * RBAC posture: course-scope is intentionally NOT applied here. Curators edit
 * schedules (RolesGuard + 'schedules.edit'), so they need to pick items inside
 * the course bound to the schedule. Existence-check only — same liberal stance
 * the existing `assertRefsExist` in schedules-mutations takes for refs.
 *
 * Pagination + search: page_size capped at 100 in DTO. `q` is a server-side
 * `contains` over translations.title (MySQL utf8mb4 is case-insensitive by
 * default; Prisma `mode: 'insensitive'` is Postgres-only).
 *
 * Shape: returns `{ rows: [{id, title_kz, title_ru}], total, page, page_size }`
 * raw (no apiResponse wrapper) — matches list-endpoint convention.
 */
@Injectable()
export class CoursesPickerItemsService {
    private readonly logger = new Logger(CoursesPickerItemsService.name);

    public static readonly DEFAULT_PAGE_SIZE = 20;

    constructor(private readonly prisma: PrismaService) {}

    public async list(courseId: number, query: ListPickerItemsDto): Promise<PickerItemsResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.max(1, Math.min(100, query.page_size ?? CoursesPickerItemsService.DEFAULT_PAGE_SIZE));
        const skip = (page - 1) * page_size;
        const q = query.q?.trim() ?? '';

        // Existence check (no scope) — 404 if the course is missing / soft-deleted.
        const exists = await this.prisma.webinar.findFirst({
            where: { id: courseId, deleted_at: null },
            select: { id: true },
        });
        if (!exists) {
            throw new NotFoundException('courses.not_found');
        }

        switch (query.kind) {
            case 'lesson':
                return this.listLessons(courseId, q, skip, page_size, page);
            case 'file':
                return this.listFiles(courseId, q, skip, page_size, page);
            case 'assignment':
                return this.listAssignments(courseId, q, skip, page_size, page);
            case 'quiz':
                return this.listQuizzes(courseId, q, skip, page_size, page);
        }
    }

    private async listLessons(
        courseId: number,
        q: string,
        skip: number,
        take: number,
        page: number,
    ): Promise<PickerItemsResponseDto> {
        const where: any = { webinar_id: courseId, status: 'active' };
        if (q.length > 0) where.translations = { some: { title: { contains: q } } };

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.webinarChapter.count({ where }),
            this.prisma.webinarChapter.findMany({
                where,
                select: {
                    id: true,
                    translations: {
                        where: { locale: { in: ['kz', 'ru'] } },
                        select: { locale: true, title: true },
                    },
                },
                orderBy: [{ order: 'asc' }, { id: 'asc' }],
                skip,
                take,
            }),
        ]);

        return this.shape(rows, total, page, take);
    }

    private async listFiles(
        courseId: number,
        q: string,
        skip: number,
        take: number,
        page: number,
    ): Promise<PickerItemsResponseDto> {
        const where: any = { webinar_id: courseId, status: 'active', deleted_at: null };
        if (q.length > 0) where.translations = { some: { title: { contains: q } } };

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.files.count({ where }),
            this.prisma.files.findMany({
                where,
                select: {
                    id: true,
                    translations: {
                        where: { locale: { in: ['kz', 'ru'] } },
                        select: { locale: true, title: true },
                    },
                },
                orderBy: [{ order: 'asc' }, { id: 'asc' }],
                skip,
                take,
            }),
        ]);

        return this.shape(rows, total, page, take);
    }

    private async listAssignments(
        courseId: number,
        q: string,
        skip: number,
        take: number,
        page: number,
    ): Promise<PickerItemsResponseDto> {
        const where: any = {
            status: 'active',
            OR: [{ webinar_id: courseId }, { webinar_id: null }],
        };
        if (q.length > 0) where.translations = { some: { title: { contains: q } } };

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.webinarAssignment.count({ where }),
            this.prisma.webinarAssignment.findMany({
                where,
                select: {
                    id: true,
                    translations: {
                        where: { locale: { in: ['kz', 'ru'] } },
                        select: { locale: true, title: true },
                    },
                },
                orderBy: [{ id: 'asc' }],
                skip,
                take,
            }),
        ]);

        return this.shape(rows, total, page, take);
    }

    /**
     * Quizzes are linked to courses via WebinarChapterItem rows where `type='quiz'`
     * and `item_id` references `quizzes.id`. The `webinar_chapter_items.chapter_id`
     * → `webinar_chapters.webinar_id` chain scopes them to a course.
     *
     * NOTE: the schema also defines a `WebinarQuiz` junction (webinar_id/quiz_id/
     * chapter_id), but it is empty in production data and the chapter-items path
     * is the authoritative source — same approach the courses-content editor and
     * detail service use to expose quiz items.
     */
    private async listQuizzes(
        courseId: number,
        q: string,
        skip: number,
        take: number,
        page: number,
    ): Promise<PickerItemsResponseDto> {
        // 1. Collect distinct quiz ids attached to any chapter of this course.
        const chapterItems = await this.prisma.webinarChapterItem.findMany({
            where: {
                type: 'quiz',
                webinar_chapter: { webinar_id: courseId },
            },
            select: { item_id: true },
            distinct: ['item_id'],
        });
        const quizIds = chapterItems.map((r) => r.item_id);

        if (quizIds.length === 0) {
            return { rows: [], total: 0, page, page_size: take };
        }

        // 2. Apply search + pagination at the quizzes table level.
        const quizWhere: any = { id: { in: quizIds } };
        if (q.length > 0) {
            quizWhere.translations = { some: { title: { contains: q } } };
        }

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.quizzes.count({ where: quizWhere }),
            this.prisma.quizzes.findMany({
                where: quizWhere,
                select: {
                    id: true,
                    translations: {
                        where: { locale: { in: ['kz', 'ru'] } },
                        select: { locale: true, title: true },
                    },
                },
                orderBy: [{ id: 'asc' }],
                skip,
                take,
            }),
        ]);

        return this.shape(rows, total, page, take);
    }

    private shape(
        rows: Array<{ id: number; translations: Array<{ locale: string; title: string | null }> }>,
        total: number,
        page: number,
        page_size: number,
    ): PickerItemsResponseDto {
        const out: PickerItemRow[] = rows.map((r) => ({
            id: Number(r.id),
            ...flattenTranslationsToTitles(r.translations),
        }));
        return { rows: out, total, page, page_size };
    }
}
