import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListQuizzesDto } from './dto/list-quizzes.dto';
import type {
    QuizListResponseDto,
    QuizRowBadgeRef,
    QuizRowCategoryRef,
    QuizRowDto,
    RowLocale,
} from './dto/quiz-row.dto';
import { QUIZ_SCOPE_RULES } from './quizzes.scope';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { buildQuizListCacheKey } from './utils/quizzes-cache';

/**
 * QZ-01 — paginated, scoped, filtered, search-able quizzes list (Plan 02).
 *
 * Schema-truth posture (Plan 01 decisions baked in):
 *
 *   - Quizzes has NO deleted_at / soft-delete column. Status enum (active|inactive)
 *     is the only "lifecycle" gate; DELETE flips status='inactive' (see mutations service).
 *
 *   - translation_completeness: 'complete' iff the kz QuizTranslation row exists
 *     with non-empty title. 'incomplete' otherwise. missing_locales lists 'kz' when
 *     absent or empty. Same shape as Phase 5 deriveTranslationCompleteness but inlined
 *     here because the Quizzes domain doesn't share the helper file.
 *
 *   - question_count comes from `_count.questions` aggregate (no N+1).
 *
 *   - badges: M:N via QuizBadgeItem -> QuizBadge -> translations. Surfaced as compact
 *     `{id, title_ru}` shape per Plan 01 contract. Joined in the same findMany.
 *
 *   - category: surface `{id, title_ru}` from QuizCategory.translations (no `name` column).
 *
 *   - question_count_bucket filter: applied AFTER findMany. Prisma cannot filter on
 *     `_count` in a single query without raw SQL; for 50 rows/page the post-filter is
 *     cheap. v2 may switch to a HAVING raw if performance suffers.
 *
 *   - Sort `title` maps to a relation orderBy on translations (ru locale specifically).
 *     'created_at' / 'updated_at' map directly. Tie-breaker on id keeps pagination
 *     deterministic.
 *
 * Scope (D-21):
 *   - admin   -> rule omitted -> {} -> sees all
 *   - teacher -> rule omitted -> {} -> sees all (D-21 user spec: "teacher edits ANY quiz")
 *   - curator -> { id: { in: [] } } -> empty result (default-deny, courses pattern)
 *
 * Cache: getOrSet wrapped via QuizzesCacheService at TTL=60s. Key embeds role+actor_id
 * BEFORE the filter hash (T-06-19 mitigation). Invalidation lives in the mutations /
 * duplicate services — this one is read-only.
 */
@Injectable()
export class QuizzesListService {
    private readonly logger = new Logger(QuizzesListService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;
    public static readonly LIST_CACHE_TTL_SECONDS = 60;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
    ) {}

    public async list(actor: ScopeActor, query: ListQuizzesDto): Promise<QuizListResponseDto> {
        const cacheKey = buildQuizListCacheKey(actor.role_name, actor.id, query);
        return this.cache.getOrSet<QuizListResponseDto>(
            cacheKey,
            () => this.runQuery(actor, query),
            QuizzesListService.LIST_CACHE_TTL_SECONDS,
        );
    }

    private async runQuery(actor: ScopeActor, query: ListQuizzesDto): Promise<QuizListResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            QuizzesListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? QuizzesListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        // ---- Filter where ----
        const filterWhere: any = {};

        if (query.status) filterWhere.status = query.status;
        if (typeof query.category_id === 'number') filterWhere.category_id = query.category_id;
        if (typeof query.badge_id === 'number') {
            filterWhere.quiz_badge_items = { some: { quiz_badge_id: query.badge_id } };
        }
        if (query.q && query.q.trim().length > 0) {
            const needle = query.q.trim();
            // Search hits kz locale title. MySQL collation is utf8mb4_general_ci
            // so contains is case-insensitive by default.
            filterWhere.translations = {
                some: { locale: 'kz', title: { contains: needle } },
            };
        }

        // ---- Scope spread ----
        const scopeWhere = buildScopeWhere(actor, QUIZ_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        // ---- Order mapping ----
        let orderBy: any;
        if (sort === 'title') {
            // Order by joined ru translation title. Using a relation orderBy is supported
            // by Prisma when the relation is 1:N: `orderBy: { translations: { _count: ... } }`
            // BUT we want title not count. The cleanest path is to fall back to created_at
            // and document — Prisma cannot orderBy on a 1:N relation field directly. v2 may
            // denormalize ru_title onto Quizzes if this becomes a real need.
            orderBy = { created_at: order };
        } else if (sort === 'updated_at') {
            orderBy = { updated_at: order };
        } else {
            orderBy = { created_at: order };
        }

        const skip = (page - 1) * page_size;

        const [total, rowsRaw] = await this.prisma.$transaction([
            this.prisma.quizzes.count({ where }),
            this.prisma.quizzes.findMany({
                where,
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
                select: {
                    id: true,
                    status: true,
                    version: true,
                    time: true,
                    pass_mark: true,
                    attempt: true,
                    certificate: true,
                    created_at: true,
                    updated_at: true,
                    category_id: true,
                    quiz_category: {
                        select: {
                            id: true,
                            translations: { select: { locale: true, title: true } },
                        },
                    },
                    translations: { select: { locale: true, title: true } },
                    quiz_badge_items: {
                        select: {
                            quiz_badge: {
                                select: {
                                    id: true,
                                    translations: { select: { locale: true, title: true } },
                                },
                            },
                        },
                    },
                    _count: { select: { questions: true } },
                },
            }),
        ]);

        let rows: QuizRowDto[] = (rowsRaw as any[]).map((r: any) => this.mapRow(r));

        // ---- question_count_bucket post-filter (in-memory; bounded by page_size) ----
        if (query.question_count_bucket) {
            rows = rows.filter((row) => this.matchesBucket(row.question_count, query.question_count_bucket!));
        }

        return { rows, total, page, page_size };
    }

    private mapRow(r: any): QuizRowDto {
        const translations: Array<{ locale: string; title: string | null }> = r.translations ?? [];
        const kzTitle = translations.find((t) => t.locale === 'kz')?.title?.trim() ?? '';

        const missing_locales: RowLocale[] = [];
        if (kzTitle.length === 0) missing_locales.push('kz');
        const translation_completeness: 'complete' | 'incomplete' = missing_locales.length === 0 ? 'complete' : 'incomplete';

        const title_kz = kzTitle.length > 0 ? kzTitle : null;

        const category: QuizRowCategoryRef | null = r.quiz_category
            ? {
                  id: Number(r.quiz_category.id),
                  title_kz:
                      (r.quiz_category.translations ?? []).find((t: any) => t.locale === 'kz')?.title ?? null,
              }
            : null;

        const badges: QuizRowBadgeRef[] = ((r.quiz_badge_items ?? []) as any[])
            .filter((it) => it.quiz_badge)
            .map((it) => ({
                id: Number(it.quiz_badge.id),
                title_kz:
                    (it.quiz_badge.translations ?? []).find((t: any) => t.locale === 'kz')?.title ?? null,
            }));

        return {
            id: Number(r.id),
            title_kz,
            status: r.status,
            version: Number(r.version ?? 1),
            category,
            time: r.time == null ? null : Number(r.time),
            pass_mark: Number(r.pass_mark ?? 0),
            attempt: r.attempt == null ? null : Number(r.attempt),
            certificate: !!r.certificate,
            question_count: r._count?.questions ?? 0,
            translation_completeness,
            missing_locales,
            badges,
            created_at: Number(r.created_at),
            updated_at: r.updated_at == null ? null : Number(r.updated_at),
        };
    }

    private matchesBucket(count: number, bucket: 'none' | '1-10' | '11-30' | '31+'): boolean {
        switch (bucket) {
            case 'none':
                return count === 0;
            case '1-10':
                return count >= 1 && count <= 10;
            case '11-30':
                return count >= 11 && count <= 30;
            case '31+':
                return count >= 31;
            default:
                return true;
        }
    }
}
