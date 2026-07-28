import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListTrainersDto, TrainerPublishStatus } from './dto/list-trainers.dto';
import { TRAINER_SCOPE_RULES } from './trainers.scope';
import { TrainersCacheService } from './utils/trainers-cache.service';
import { buildTrainerListCacheKey } from './utils/trainers-cache';

/**
 * Phase 38 — trainer list + detail read surface.
 *
 * Schema-truth posture (phase-38 MANUAL reuse decisions):
 *   - A trainer IS a quizzes row (kind='trainer') + trainer_settings satellite +
 *     trainer_courses links. No parallel publish/attempt-limit/shuffle columns exist.
 *   - publish_status is DERIVED from Quizzes.status:
 *       'public' ⇔ status='active', 'hidden' ⇔ status='inactive'.
 *     This is exactly what the student API respects (glucose-api trainer-access.ts:
 *     `published = quiz.status === 'active'`), so the admin toggle and student
 *     visibility can never disagree. Consequence: soft-deleted trainers (DELETE →
 *     status='inactive') are indistinguishable from hidden ones — both are
 *     invisible to students and re-publishable.
 *   - attempts_limit ⇔ Quizzes.attempt (NULL = unlimited; student treats 0 the same).
 *   - shuffle_questions ⇔ Quizzes.display_questions_randomly.
 *   - question_count counts ONLY single/multiple bank questions — the only types that
 *     participate in trainer runs (shared-types TrainerRunQuestionType contract), so
 *     the list number matches the student card and the publish gate.
 *
 * Scope: TRAINER_SCOPE_RULES is empty (all staff see all trainers); access is governed
 * by the runtime @RequirePermission('trainers.view') grant.
 *
 * Cache: list reads via TrainersCacheService.getOrSet at TTL=60s. Key embeds
 * role + actor_id BEFORE the filter hash. Invalidation lives in the mutations service.
 */

export interface TrainerCategoryRefDto {
    id: number;
    title_kz: string | null;
}

export interface TrainerCourseRefDto {
    id: number;
    title_kz: string | null;
}

export interface TrainerRowDto {
    id: number;
    title_kz: string | null;
    category: TrainerCategoryRefDto | null;
    question_count: number;
    publish_status: TrainerPublishStatus;
    timer_enabled: boolean;
    seconds_per_question: number | null;
    attempts_limit: number | null;
    available_from: number | null;
    available_to: number | null;
    flashcards_enabled: boolean;
    courses: TrainerCourseRefDto[];
    attempts_count: number;
    created_at: number;
}

export interface TrainerListResponse {
    rows: TrainerRowDto[];
    total: number;
    pageCount: number;
}

/** Question types that participate in trainer runs (shared-types contract). */
export const TRAINER_RUN_QUESTION_TYPES = ['single', 'multiple'] as const;

export function derivePublishStatus(status: string): TrainerPublishStatus {
    return status === 'active' ? 'public' : 'hidden';
}

export function pickKzTitle(translations: Array<{ locale: string; title: string | null }> | undefined | null): string | null {
    const kz = (translations ?? []).find((t) => t.locale === 'kz')?.title?.trim() ?? '';
    return kz.length > 0 ? kz : null;
}

@Injectable()
export class TrainersService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;
    public static readonly LIST_CACHE_TTL_SECONDS = 60;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: TrainersCacheService,
    ) {}

    public async list(actor: ScopeActor, query: ListTrainersDto): Promise<TrainerListResponse> {
        const cacheKey = buildTrainerListCacheKey(actor.role_name, actor.id, query as Record<string, unknown>);
        return this.cache.getOrSet<TrainerListResponse>(cacheKey, () => this.runListQuery(actor, query), TrainersService.LIST_CACHE_TTL_SECONDS);
    }

    private async runListQuery(actor: ScopeActor, query: ListTrainersDto): Promise<TrainerListResponse> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(TrainersService.MAX_PAGE_SIZE, Math.max(1, query.page_size ?? TrainersService.DEFAULT_PAGE_SIZE));

        // ---- Filter where (only kind='trainer' rows ever surface here) ----
        const filterWhere: any = { kind: 'trainer' };

        if (query.publish_status) {
            filterWhere.status = query.publish_status === 'public' ? 'active' : 'inactive';
        }
        if (typeof query.category_id === 'number') filterWhere.category_id = query.category_id;
        if (typeof query.course_id === 'number') {
            filterWhere.trainer_courses = { some: { webinar_id: query.course_id } };
        }
        if (query.q && query.q.trim().length > 0) {
            const needle = query.q.trim();
            // kz locale title contains; MySQL collation makes this case-insensitive.
            filterWhere.translations = { some: { locale: 'kz', title: { contains: needle } } };
        }

        const scopeWhere = buildScopeWhere(actor, TRAINER_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        const skip = (page - 1) * page_size;

        const [total, rowsRaw] = await this.prisma.$transaction([
            this.prisma.quizzes.count({ where }),
            this.prisma.quizzes.findMany({
                where,
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                take: page_size,
                skip,
                select: {
                    id: true,
                    status: true,
                    attempt: true,
                    created_at: true,
                    translations: { select: { locale: true, title: true } },
                    quiz_category: {
                        select: { id: true, translations: { select: { locale: true, title: true } } },
                    },
                    trainer_settings: {
                        select: {
                            timer_enabled: true,
                            seconds_per_question: true,
                            flashcards_enabled: true,
                            available_from: true,
                            available_to: true,
                        },
                    },
                    trainer_courses: {
                        select: { webinar: { select: { id: true, translations: { select: { locale: true, title: true } } } } },
                    },
                    _count: {
                        select: {
                            questions: { where: { type: { in: [...TRAINER_RUN_QUESTION_TYPES] } } },
                            trainer_attempts: true,
                        },
                    },
                },
            }),
        ]);

        const rows: TrainerRowDto[] = (rowsRaw as any[]).map((r) => this.mapRow(r));
        return { rows, total, pageCount: Math.max(1, Math.ceil(total / page_size)) };
    }

    private mapRow(r: any): TrainerRowDto {
        const settings = r.trainer_settings;
        return {
            id: Number(r.id),
            title_kz: pickKzTitle(r.translations),
            category: r.quiz_category ? { id: Number(r.quiz_category.id), title_kz: pickKzTitle(r.quiz_category.translations) } : null,
            question_count: Number(r._count?.questions ?? 0),
            publish_status: derivePublishStatus(r.status),
            timer_enabled: !!settings?.timer_enabled,
            seconds_per_question: settings?.seconds_per_question == null ? null : Number(settings.seconds_per_question),
            attempts_limit: r.attempt == null || Number(r.attempt) === 0 ? null : Number(r.attempt),
            available_from: settings?.available_from == null ? null : Number(settings.available_from),
            available_to: settings?.available_to == null ? null : Number(settings.available_to),
            flashcards_enabled: settings?.flashcards_enabled ?? true,
            courses: ((r.trainer_courses ?? []) as any[])
                .filter((link) => link.webinar)
                .map((link) => ({ id: Number(link.webinar.id), title_kz: pickKzTitle(link.webinar.translations) })),
            attempts_count: Number(r._count?.trainer_attempts ?? 0),
            created_at: Number(r.created_at),
        };
    }

    /**
     * GET /admin-api/v1/admin/trainers/:id — full detail (settings + course links +
     * kz translation + counts). 404 unless the row exists AND kind='trainer' —
     * legacy tests are invisible to this surface, mirroring how trainer rows 404
     * on the legacy quiz CRUD.
     */
    public async detail(actor: ScopeActor, id: number) {
        void actor; // access governed by @Roles + @RequirePermission('trainers.view')
        const detail = await this.readDetail(id);
        return apiResponse(1, 'ok', 'trainers.detail', detail);
    }

    /** Shared full-detail projection (also re-read by the mutations service after writes). */
    public async readDetail(id: number) {
        const r: any = await this.prisma.quizzes.findUnique({
            where: { id, kind: 'trainer' },
            select: {
                id: true,
                status: true,
                attempt: true,
                category_id: true,
                display_questions_randomly: true,
                subject_id: true,
                created_at: true,
                updated_at: true,
                translations: { select: { locale: true, title: true } },
                quiz_category: {
                    select: { id: true, translations: { select: { locale: true, title: true } } },
                },
                subject: {
                    select: { id: true, translations: { select: { locale: true, title: true } } },
                },
                trainer_settings: { include: { theme: { select: { id: true, title: true, image: true, palette: true } } } },
                trainer_courses: {
                    orderBy: { id: 'asc' },
                    select: {
                        webinar_id: true,
                        webinar: { select: { id: true, translations: { select: { locale: true, title: true } } } },
                    },
                },
                _count: {
                    select: {
                        questions: { where: { type: { in: [...TRAINER_RUN_QUESTION_TYPES] } } },
                        trainer_attempts: true,
                    },
                },
            },
        });
        if (!r) throw new NotFoundException('trainers.not_found');

        const settings = r.trainer_settings;
        return {
            id: Number(r.id),
            title_kz: pickKzTitle(r.translations),
            translations: ((r.translations ?? []) as any[])
                .filter((t) => t.locale === 'kz')
                .map((t) => ({ locale: 'kz' as const, title: t.title })),
            category: r.quiz_category ? { id: Number(r.quiz_category.id), title_kz: pickKzTitle(r.quiz_category.translations) } : null,
            subject: r.subject ? { id: Number(r.subject.id), title_kz: pickKzTitle(r.subject.translations) } : null,
            theme: settings?.theme
                ? {
                      id: Number(settings.theme.id),
                      title: settings.theme.title,
                      image: settings.theme.image ?? null,
                      palette: settings.theme.palette,
                  }
                : null,
            publish_status: derivePublishStatus(r.status),
            timer_enabled: !!settings?.timer_enabled,
            seconds_per_question: settings?.seconds_per_question == null ? null : Number(settings.seconds_per_question),
            shuffle_questions: !!r.display_questions_randomly,
            shuffle_answers: !!settings?.shuffle_answers,
            flashcards_enabled: settings?.flashcards_enabled ?? true,
            attempts_limit: r.attempt == null || Number(r.attempt) === 0 ? null : Number(r.attempt),
            background_image: settings?.background_image ?? null,
            available_from: settings?.available_from == null ? null : Number(settings.available_from),
            available_to: settings?.available_to == null ? null : Number(settings.available_to),
            courses: ((r.trainer_courses ?? []) as any[]).map((link) => ({
                id: Number(link.webinar?.id ?? link.webinar_id),
                title_kz: pickKzTitle(link.webinar?.translations),
            })),
            counts: {
                question_count: Number(r._count?.questions ?? 0),
                attempts_count: Number(r._count?.trainer_attempts ?? 0),
            },
            created_at: Number(r.created_at),
            updated_at: r.updated_at == null ? null : Number(r.updated_at),
        };
    }
}
