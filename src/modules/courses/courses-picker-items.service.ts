import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
    ListPickerItemsDto,
    PickerItemRow,
    PickerItemScope,
    PickerItemsResponseDto,
} from './dto/list-picker-items.dto';
import { flattenTranslationsToTitles } from './utils/flatten-translations';

/**
 * Backs GET /admin-api/v1/admin/courses/:id/picker-items — populates the item
 * pickers (lesson / quiz / assignment / file) for two consumers: the schedules
 * editor (schedule an item already in the course) and the course-content editor
 * (attach a new entity as a chapter item).
 *
 * lesson/file/assignment carry their own `webinar_id`, so they are always scoped
 * to ONE course. quiz is the exception — quizzes are global (no `webinar_id`), so
 * the `scope` query param selects the result set: 'course' (default) = quizzes
 * already attached to this course (schedules editor); 'all' = the whole catalog
 * (content editor, attach flow). See listQuizzes for the rationale.
 *
 * Pagination + search: page_size capped at 100 in DTO. `q` matches a server-side
 * `contains` over translations.title (MySQL utf8mb4 is case-insensitive by
 * default; Prisma `mode: 'insensitive'` is Postgres-only) OR the row's numeric
 * id when `q` is all digits — see searchOr.
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
        const scope: PickerItemScope = query.scope ?? 'course';

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
                return this.listQuizzes(courseId, q, scope, skip, page_size, page);
        }
    }

    /**
     * Search predicate shared by every kind: match `q` against any kz/ru
     * translation title AND — when `q` is a positive integer — against the row's
     * own numeric id. Lets curators paste a known id ("10") instead of typing a
     * title. Returns a Prisma `OR` array; callers AND it with their own scope.
     */
    private searchOr(q: string): any[] {
        const ors: any[] = [{ translations: { some: { title: { contains: q } } } }];
        if (/^\d+$/.test(q)) {
            const id = Number(q);
            if (Number.isSafeInteger(id) && id > 0) {
                ors.push({ id });
            }
        }
        return ors;
    }

    private async listLessons(
        courseId: number,
        q: string,
        skip: number,
        take: number,
        page: number,
    ): Promise<PickerItemsResponseDto> {
        const where: any = { webinar_id: courseId, status: 'active' };
        if (q.length > 0) where.OR = this.searchOr(q);

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
        if (q.length > 0) where.OR = this.searchOr(q);

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
            // Course-specific (webinar_id) OR global (null) assignments. `q` is
            // ANDed in as a second OR group so it doesn't clobber this scope OR.
            OR: [{ webinar_id: courseId }, { webinar_id: null }],
        };
        if (q.length > 0) where.AND = [{ OR: this.searchOr(q) }];

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
     * Quizzes have NO `webinar_id` — they are global entities linked to a course
     * only via WebinarChapterItem rows (`type='quiz'`, `item_id` → `quizzes.id`,
     * scoped through `webinar_chapters.webinar_id`).
     *
     * That gives two legitimate result sets, selected by `scope`:
     *   - 'course' (default): quizzes already attached to this course. Used by
     *     the schedules editor — you can only schedule existing course items.
     *   - 'all': the whole quiz catalog. Used by the course-content editor when
     *     ATTACHING a new quiz. Scoping to already-attached quizzes there is a
     *     chicken-and-egg dead end (you could never attach the first quiz).
     *
     * NOTE: the schema also defines a `WebinarQuiz` junction (webinar_id/quiz_id/
     * chapter_id), but it is empty in production data and the chapter-items path
     * is the authoritative source — same approach the courses-content editor and
     * detail service use to expose quiz items.
     */
    private async listQuizzes(
        courseId: number,
        q: string,
        scope: PickerItemScope,
        skip: number,
        take: number,
        page: number,
    ): Promise<PickerItemsResponseDto> {
        const quizWhere: any = {};

        if (scope === 'course') {
            // Collect distinct quiz ids attached to any chapter of this course.
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
            quizWhere.id = { in: quizIds };
        }

        // Search (title or numeric id) on top of the chosen scope. For 'course'
        // this ANDs with `id IN (quizIds)`, so an id match still has to be a
        // course quiz; for 'all' it searches the whole catalog.
        if (q.length > 0) {
            quizWhere.OR = this.searchOr(q);
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
