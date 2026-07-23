import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListTrainerResultsDto } from './dto/list-trainer-results.dto';
import { TrainerResultsStatsDto } from './dto/trainer-results-stats.dto';
import { buildTrainerResultsWhere } from './utils/trainer-results-where';
import { TrainersCacheService } from './utils/trainers-cache.service';
import { buildTrainerResultsCacheKey } from './utils/trainers-cache';
import { pickKzTitle } from './trainers.service';

/**
 * Phase 38 — trainer attempt results: paginated list + aggregate stats.
 *
 * RBAC scope is centralized in buildTrainerResultsWhere (admin all, curator via
 * supervised groups' students, teacher via own-webinar trainer links with
 * default-deny) so list, stats, and export always agree for the same actor+filters.
 *
 * BigInt: TrainerAttempt.id is BigInt — serialized as STRING in every row
 * (CLAUDE.md BigInt convention; stringified here so cached JSON is stable too).
 *
 * Cache: 30s TTL via TrainersCacheService. Attempt rows are written by the
 * student-facing glucose-api, so admin-api cannot proactively invalidate on row
 * writes — 30s staleness is acceptable for admin oversight (same posture as the
 * legacy quiz-results list). Admin-side trainer mutations DO nuke the namespace.
 */

export interface TrainerResultTrainerRefDto {
    id: number;
    title_kz: string | null;
}

export interface TrainerResultUserRefDto {
    id: number;
    full_name: string | null;
    mobile: string | null;
}

export interface TrainerResultRowDto {
    /** trainer_attempts.id — BigInt serialized as string. */
    id: string;
    trainer: TrainerResultTrainerRefDto | null;
    user: TrainerResultUserRefDto | null;
    /** Names of every group the student belongs to. */
    groups: string[];
    attempt_number: number | null;
    mode: 'trainer' | 'flashcards';
    status: 'in_progress' | 'paused' | 'finished' | 'abandoned';
    score: number;
    max_score: number;
    correct_count: number;
    incorrect_count: number;
    skipped_count: number;
    elapsed_sec: number;
    started_at: number;
    finished_at: number | null;
}

export interface TrainerResultsListResponse {
    rows: TrainerResultRowDto[];
    total: number;
    pageCount: number;
}

export interface TrainerResultsStatsResponse {
    total: number;
    finished: number;
    in_progress: number;
    /** Mean of score/max_score*100 over finished attempts with max_score>0; null when none. */
    avg_score_percent: number | null;
    unique_students: number;
}

@Injectable()
export class TrainerResultsService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;
    public static readonly CACHE_TTL_SECONDS = 30;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: TrainersCacheService,
    ) {}

    public async list(actor: ScopeActor, filters: ListTrainerResultsDto): Promise<TrainerResultsListResponse> {
        const cacheKey = buildTrainerResultsCacheKey('list', actor.role_name, actor.id, filters as Record<string, unknown>);
        return this.cache.getOrSet<TrainerResultsListResponse>(
            cacheKey,
            () => this.runListQuery(actor, filters),
            TrainerResultsService.CACHE_TTL_SECONDS,
        );
    }

    private async runListQuery(actor: ScopeActor, filters: ListTrainerResultsDto): Promise<TrainerResultsListResponse> {
        const page = Math.max(1, filters.page ?? 1);
        const page_size = Math.min(
            TrainerResultsService.MAX_PAGE_SIZE,
            Math.max(1, filters.page_size ?? TrainerResultsService.DEFAULT_PAGE_SIZE),
        );
        const sort = filters.sort ?? 'started_at';
        const order: 'asc' | 'desc' = filters.order ?? 'desc';
        const skip = (page - 1) * page_size;

        const { where, shortCircuit } = await buildTrainerResultsWhere(actor, filters, this.prisma);
        if (shortCircuit) {
            return { rows: [], total: 0, pageCount: 1 };
        }

        const orderBy: any = sort === 'score' ? { score: order } : { started_at: order };

        const [total, rowsRaw] = await this.prisma.$transaction([
            this.prisma.trainerAttempt.count({ where: where as any }),
            this.prisma.trainerAttempt.findMany({
                where: where as any,
                orderBy: [orderBy, { id: order }],
                skip,
                take: page_size,
                select: {
                    id: true,
                    attempt_number: true,
                    mode: true,
                    status: true,
                    score: true,
                    max_score: true,
                    correct_count: true,
                    incorrect_count: true,
                    skipped_count: true,
                    elapsed_sec: true,
                    started_at: true,
                    finished_at: true,
                    // Quiz FK is real (phase-38 migration) — never orphan, safe to inline.
                    quiz: { select: { id: true, translations: { select: { locale: true, title: true } } } },
                    user: {
                        select: {
                            id: true,
                            full_name: true,
                            mobile: true,
                            group_users: { select: { group: { select: { name: true } } } },
                        },
                    },
                },
            }),
        ]);

        const rows: TrainerResultRowDto[] = (rowsRaw as any[]).map((r) => this.mapRow(r));
        return { rows, total, pageCount: Math.max(1, Math.ceil(total / page_size)) };
    }

    public mapRow(r: any): TrainerResultRowDto {
        return {
            id: String(r.id),
            trainer: r.quiz ? { id: Number(r.quiz.id), title_kz: pickKzTitle(r.quiz.translations) } : null,
            user: r.user ? { id: Number(r.user.id), full_name: r.user.full_name ?? null, mobile: r.user.mobile ?? null } : null,
            groups: ((r.user?.group_users ?? []) as any[]).map((gu) => String(gu.group?.name ?? '')).filter((name) => name.length > 0),
            attempt_number: r.attempt_number == null ? null : Number(r.attempt_number),
            mode: r.mode,
            status: r.status,
            score: Number(r.score ?? 0),
            max_score: Number(r.max_score ?? 0),
            correct_count: Number(r.correct_count ?? 0),
            incorrect_count: Number(r.incorrect_count ?? 0),
            skipped_count: Number(r.skipped_count ?? 0),
            elapsed_sec: Number(r.elapsed_sec ?? 0),
            started_at: Number(r.started_at),
            finished_at: r.finished_at == null ? null : Number(r.finished_at),
        };
    }

    /**
     * GET /admin-api/v1/admin/trainer-results/stats — aggregate header for the
     * same filter set (and the exact same WHERE) as the list.
     */
    public async stats(actor: ScopeActor, filters: TrainerResultsStatsDto): Promise<TrainerResultsStatsResponse> {
        const cacheKey = buildTrainerResultsCacheKey('stats', actor.role_name, actor.id, filters as Record<string, unknown>);
        return this.cache.getOrSet<TrainerResultsStatsResponse>(
            cacheKey,
            () => this.runStatsQuery(actor, filters),
            TrainerResultsService.CACHE_TTL_SECONDS,
        );
    }

    private async runStatsQuery(actor: ScopeActor, filters: TrainerResultsStatsDto): Promise<TrainerResultsStatsResponse> {
        const { where, shortCircuit } = await buildTrainerResultsWhere(actor, filters, this.prisma);
        if (shortCircuit) {
            return { total: 0, finished: 0, in_progress: 0, avg_score_percent: null, unique_students: 0 };
        }

        // One narrow projection covers every aggregate (same in-memory posture as
        // the legacy quiz-results stats service).
        const rows = await this.prisma.trainerAttempt.findMany({
            where: where as any,
            select: { user_id: true, status: true, score: true, max_score: true },
        });

        const userIds = new Set<number>();
        let finished = 0;
        let in_progress = 0;
        let percentSum = 0;
        let percentCount = 0;
        for (const r of rows) {
            userIds.add(Number(r.user_id));
            if (r.status === 'finished') {
                finished += 1;
                const maxScore = Number(r.max_score ?? 0);
                if (maxScore > 0) {
                    percentSum += (Number(r.score ?? 0) / maxScore) * 100;
                    percentCount += 1;
                }
            } else if (r.status === 'in_progress') {
                in_progress += 1;
            }
        }

        return {
            total: rows.length,
            finished,
            in_progress,
            avg_score_percent: percentCount > 0 ? Math.round((percentSum / percentCount) * 10) / 10 : null,
            unique_students: userIds.size,
        };
    }
}
