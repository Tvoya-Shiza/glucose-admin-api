import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { PublishTrainerDto } from './dto/publish-trainer.dto';
import { TRAINER_RUN_QUESTION_TYPES, TrainersService, derivePublishStatus } from './trainers.service';
import { TrainersCacheService } from './utils/trainers-cache.service';
import { TRAINERS_INVALIDATE_PATTERN, TRAINERS_PUBLIC_INVALIDATE_PATTERN } from './utils/trainers-cache';

/**
 * Phase 38 — trainer create / update / soft-delete / publish.
 *
 * Storage decisions (phase-38 MANUAL: "Reuse Quizzes.status for publication state,
 * Quizzes.attempt for the trainer attempt limit, Quizzes.display_questions_randomly
 * for question ordering. Do not add parallel columns."):
 *
 *   - publish_status ⇔ Quizzes.status ('public'=active / 'hidden'=inactive). The student
 *     API gates on exactly this (`published = quiz.status === 'active'`), so the admin
 *     toggle and student visibility can never disagree.
 *   - ★ DEVIATION from the ТЗ letter: create() writes status='inactive' (born HIDDEN),
 *     not 'active'. The ТЗ assumed a separate trainer_settings.publish_status column
 *     (born hidden with quizzes.status='active'); with the merged column, born-'active'
 *     would make a freshly created, question-less trainer instantly student-visible and
 *     the publish gate meaningless. Born-hidden preserves the ТЗ intent: nothing reaches
 *     students until PATCH :id/publish passes the question/course gate.
 *   - DELETE = status='inactive' + updated_at bump. With the merged column this IS
 *     publish_status='hidden' — one write satisfies both halves of the ТЗ contract
 *     ("quizzes.status='inactive' AND publish_status='hidden'"). Children (settings,
 *     course links, questions, attempts) are preserved; re-publish resurrects.
 *   - is_listed=false on create keeps trainer rows out of the legacy public quiz
 *     catalog surfaces (which filter is_listed=true); the student /trainers catalog
 *     ignores is_listed entirely.
 *   - attempts_limit 0 → stored NULL (unlimited); the student side treats 0 and NULL
 *     identically (buildRunSettings: attempt > 0 ? attempt : null).
 *
 * Publish gate: 'public' is refused with 409 ConflictException('trainers.publish_blocked')
 * + {question_count, course_count} while the trainer has zero runnable (single/multiple)
 * questions or zero linked courses — mirrors the student-side no_questions/not_configured
 * dead-ends so students never see a broken card.
 *
 * Cache: every mutation invalidates the admin namespace `geonline-admin:trainers:*`
 * AND the student namespace `geonline:trainers:*` (shared Redis — precedent:
 * BLOGS_PUBLIC_INVALIDATE_PATTERN in src/modules/blogs/utils/blogs-cache.ts).
 *
 * Questions/answers are NOT managed here — the existing
 * /admin-api/v1/admin/quizzes/:quizId/questions* routes serve trainers already
 * (assertQuizScope has no kind filter).
 */
@Injectable()
export class TrainersMutationsService {
    private readonly logger = new Logger(TrainersMutationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly trainersService: TrainersService,
        private readonly cache: TrainersCacheService,
    ) {}

    public async create(actor: ScopeActor, dto: CreateTrainerDto) {
        // Access governed by @Roles + @RequirePermission('trainers.create') at the controller.
        await this.assertCategoryExists(dto.category_id ?? undefined);
        await this.assertSubjectExists(dto.subject_id ?? undefined);
        await this.assertThemeExists(dto.theme_id ?? undefined);
        this.assertTimerRule(dto.timer_enabled ?? false, dto.seconds_per_question ?? null);
        this.assertAvailabilityWindow(dto.available_from ?? null, dto.available_to ?? null);
        const courseIds = await this.resolveCourseIds(dto.course_ids);

        const now = nowSec();

        const created: any = await this.prisma.$transaction(async (tx) => {
            const quiz: any = await tx.quizzes.create({
                data: {
                    kind: 'trainer',
                    // Born HIDDEN (see header) — publish via PATCH :id/publish.
                    status: 'inactive',
                    is_listed: false,
                    pass_mark: 0,
                    certificate: false,
                    category_id: typeof dto.category_id === 'number' ? dto.category_id : null,
                    subject_id: typeof dto.subject_id === 'number' ? dto.subject_id : null,
                    attempt: normalizeAttemptsLimit(dto.attempts_limit),
                    display_questions_randomly: dto.shuffle_questions ?? false,
                    version: 1,
                    created_at: now,
                },
                select: { id: true },
            });

            await tx.quizTranslation.create({
                data: { quiz_id: quiz.id, locale: 'kz', title: dto.title },
            });

            await tx.trainerSettings.create({
                data: {
                    quiz_id: quiz.id,
                    timer_enabled: dto.timer_enabled ?? false,
                    seconds_per_question: dto.seconds_per_question ?? null,
                    shuffle_answers: dto.shuffle_answers ?? false,
                    flashcards_enabled: dto.flashcards_enabled ?? true,
                    background_image: dto.background_image ?? null,
                    theme_id: dto.theme_id ?? null,
                    available_from: dto.available_from ?? null,
                    available_to: dto.available_to ?? null,
                    created_at: now,
                },
            });

            if (courseIds.length > 0) {
                await tx.trainerCourse.createMany({
                    data: courseIds.map((webinar_id) => ({ quiz_id: quiz.id, webinar_id, created_at: now })),
                });
            }

            return quiz;
        });

        await this.invalidateCaches();
        const detail = await this.trainersService.readDetail(Number(created.id));
        return apiResponse(1, 'created', 'trainers.created', detail);
    }

    public async update(actor: ScopeActor, id: number, dto: UpdateTrainerDto) {
        const existing = await this.assertTrainer(id);
        const settings: any = await this.prisma.trainerSettings.findUnique({ where: { quiz_id: id } });

        if (dto.category_id !== undefined && dto.category_id !== null) {
            await this.assertCategoryExists(dto.category_id);
        }
        if (dto.subject_id !== undefined && dto.subject_id !== null) {
            await this.assertSubjectExists(dto.subject_id);
        }
        if (dto.theme_id !== undefined && dto.theme_id !== null) {
            await this.assertThemeExists(dto.theme_id);
        }

        // Cross-field rules validated against the MERGED (dto over existing) state.
        const nextTimer = dto.timer_enabled !== undefined ? dto.timer_enabled : !!settings?.timer_enabled;
        const nextSeconds = dto.seconds_per_question !== undefined ? dto.seconds_per_question : (settings?.seconds_per_question ?? null);
        this.assertTimerRule(nextTimer, nextSeconds);

        const nextFrom = dto.available_from !== undefined ? dto.available_from : (settings?.available_from ?? null);
        const nextTo = dto.available_to !== undefined ? dto.available_to : (settings?.available_to ?? null);
        this.assertAvailabilityWindow(nextFrom, nextTo);

        const courseIds = dto.course_ids !== undefined ? await this.resolveCourseIds(dto.course_ids) : undefined;

        const now = nowSec();

        // ---- quizzes-row diff ----
        const quizData: Record<string, unknown> = {};
        if (dto.category_id === null) quizData.category_id = null;
        else if (typeof dto.category_id === 'number') quizData.category_id = dto.category_id;
        if (dto.subject_id === null) quizData.subject_id = null;
        else if (typeof dto.subject_id === 'number') quizData.subject_id = dto.subject_id;
        if (dto.attempts_limit !== undefined) quizData.attempt = normalizeAttemptsLimit(dto.attempts_limit);
        if (typeof dto.shuffle_questions === 'boolean') quizData.display_questions_randomly = dto.shuffle_questions;

        // ---- trainer_settings diff ----
        const settingsData: Record<string, unknown> = {};
        if (typeof dto.timer_enabled === 'boolean') settingsData.timer_enabled = dto.timer_enabled;
        if (dto.seconds_per_question !== undefined) settingsData.seconds_per_question = dto.seconds_per_question;
        if (typeof dto.shuffle_answers === 'boolean') settingsData.shuffle_answers = dto.shuffle_answers;
        if (typeof dto.flashcards_enabled === 'boolean') settingsData.flashcards_enabled = dto.flashcards_enabled;
        if (dto.background_image !== undefined) settingsData.background_image = dto.background_image;
        if (dto.theme_id !== undefined) settingsData.theme_id = dto.theme_id;
        if (dto.available_from !== undefined) settingsData.available_from = dto.available_from;
        if (dto.available_to !== undefined) settingsData.available_to = dto.available_to;

        await this.prisma.$transaction(async (tx) => {
            await tx.quizzes.update({ where: { id: existing.id }, data: { ...quizData, updated_at: now } });

            if (Object.keys(settingsData).length > 0 || !settings) {
                // Defensive upsert: a trainer created through this module always has a
                // settings row, but rows minted elsewhere might not.
                await tx.trainerSettings.upsert({
                    where: { quiz_id: existing.id },
                    create: {
                        quiz_id: existing.id,
                        timer_enabled: (settingsData.timer_enabled as boolean | undefined) ?? false,
                        seconds_per_question: (settingsData.seconds_per_question as number | null | undefined) ?? null,
                        shuffle_answers: (settingsData.shuffle_answers as boolean | undefined) ?? false,
                        flashcards_enabled: (settingsData.flashcards_enabled as boolean | undefined) ?? true,
                        background_image: (settingsData.background_image as string | null | undefined) ?? null,
                        theme_id: (settingsData.theme_id as number | null | undefined) ?? null,
                        available_from: (settingsData.available_from as number | null | undefined) ?? null,
                        available_to: (settingsData.available_to as number | null | undefined) ?? null,
                        created_at: now,
                    },
                    update: { ...settingsData, updated_at: now },
                });
            }

            if (typeof dto.title === 'string') {
                const row: any = await tx.quizTranslation.findFirst({
                    where: { quiz_id: existing.id, locale: 'kz' },
                    select: { id: true },
                    orderBy: { id: 'asc' },
                });
                if (row) {
                    await tx.quizTranslation.update({ where: { id: row.id }, data: { title: dto.title } });
                } else {
                    await tx.quizTranslation.create({ data: { quiz_id: existing.id, locale: 'kz', title: dto.title } });
                }
            }

            // ---- diff-replace trainer_courses ----
            if (courseIds !== undefined) {
                const links: any[] = await tx.trainerCourse.findMany({
                    where: { quiz_id: existing.id },
                    select: { webinar_id: true },
                });
                const current = new Set<number>(links.map((l) => Number(l.webinar_id)));
                const next = new Set<number>(courseIds);
                const toRemove = [...current].filter((webinarId) => !next.has(webinarId));
                const toAdd = [...next].filter((webinarId) => !current.has(webinarId));

                if (toRemove.length > 0) {
                    await tx.trainerCourse.deleteMany({ where: { quiz_id: existing.id, webinar_id: { in: toRemove } } });
                }
                if (toAdd.length > 0) {
                    await tx.trainerCourse.createMany({
                        data: toAdd.map((webinar_id) => ({ quiz_id: existing.id, webinar_id, created_at: now })),
                    });
                }
            }
        });

        await this.invalidateCaches();
        return apiResponse(1, 'updated', 'trainers.updated', await this.trainersService.readDetail(id));
    }

    /**
     * Soft delete. With the merged publish column this single write IS
     * "status='inactive' AND publish_status='hidden'" (see header).
     */
    public async softDelete(actor: ScopeActor, id: number) {
        await this.assertTrainer(id);

        await this.prisma.quizzes.update({
            where: { id },
            data: { status: 'inactive', updated_at: nowSec() },
        });

        await this.invalidateCaches();
        return apiResponse(1, 'deleted', 'trainers.deleted', { id, publish_status: 'hidden', deleted: true });
    }

    public async publish(actor: ScopeActor, id: number, dto: PublishTrainerDto) {
        await this.assertTrainer(id);

        if (dto.publish_status === 'public') {
            const [question_count, course_count] = await Promise.all([
                this.prisma.quizQuestion.count({ where: { quiz_id: id, type: { in: [...TRAINER_RUN_QUESTION_TYPES] } } }),
                this.prisma.trainerCourse.count({ where: { quiz_id: id } }),
            ]);
            if (question_count === 0 || course_count === 0) {
                throw new ConflictException({
                    status: 'trainers.publish_blocked',
                    message: 'trainers.publish_blocked',
                    question_count,
                    course_count,
                });
            }
        }

        const nextStatus = dto.publish_status === 'public' ? 'active' : 'inactive';
        const updated: any = await this.prisma.quizzes.update({
            where: { id },
            data: { status: nextStatus, updated_at: nowSec() },
            select: { id: true, status: true },
        });

        await this.invalidateCaches();
        return apiResponse(1, 'updated', 'trainers.publish_updated', {
            id: Number(updated.id),
            publish_status: derivePublishStatus(updated.status),
        });
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private async assertTrainer(id: number): Promise<{ id: number }> {
        // Trainer surface must never touch legacy tests — 404 unless kind='trainer'.
        const existing: any = await this.prisma.quizzes.findFirst({
            where: { id, kind: 'trainer' },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('trainers.not_found');
        return { id: Number(existing.id) };
    }

    private async assertCategoryExists(categoryId: number | undefined): Promise<void> {
        if (typeof categoryId !== 'number') return;
        const cat: any = await this.prisma.quizCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
        if (!cat) throw new BadRequestException('trainers.category_not_found');
    }

    private async assertSubjectExists(subjectId: number | undefined): Promise<void> {
        if (typeof subjectId !== 'number') return;
        const subject: any = await this.prisma.quizSubject.findUnique({ where: { id: subjectId }, select: { id: true } });
        if (!subject) throw new BadRequestException('trainers.subject_not_found');
    }

    private async assertThemeExists(themeId: number | undefined): Promise<void> {
        if (typeof themeId !== 'number') return;
        const theme: any = await this.prisma.trainerTheme.findUnique({ where: { id: themeId }, select: { id: true } });
        if (!theme) throw new BadRequestException('trainers.theme_not_found');
    }

    private assertTimerRule(timerEnabled: boolean, secondsPerQuestion: number | null): void {
        if (timerEnabled && secondsPerQuestion == null) {
            throw new BadRequestException('trainers.seconds_per_question_required');
        }
    }

    private assertAvailabilityWindow(from: number | null, to: number | null): void {
        if (from != null && to != null && from >= to) {
            throw new BadRequestException('trainers.availability_window_invalid');
        }
    }

    /** Dedupe + verify every webinar id exists (soft-deleted webinars rejected). */
    private async resolveCourseIds(courseIds: number[] | undefined): Promise<number[]> {
        const ids = [...new Set(courseIds ?? [])];
        if (ids.length === 0) return [];
        const found: any[] = await this.prisma.webinar.findMany({
            where: { id: { in: ids }, deleted_at: null },
            select: { id: true },
        });
        if (found.length !== ids.length) {
            const known = new Set(found.map((w) => Number(w.id)));
            const missing = ids.filter((id) => !known.has(id));
            throw new BadRequestException({
                status: 'trainers.course_not_found',
                message: 'trainers.course_not_found',
                missing_course_ids: missing,
            });
        }
        return ids;
    }

    private async invalidateCaches(): Promise<void> {
        await this.cache.invalidate(TRAINERS_INVALIDATE_PATTERN);
        await this.cache.invalidate(TRAINERS_PUBLIC_INVALIDATE_PATTERN);
    }
}

export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

/** 0 = unlimited → stored as NULL (student side treats 0 and NULL identically). */
function normalizeAttemptsLimit(value: number | null | undefined): number | null {
    if (value == null || value === 0) return null;
    return value;
}
