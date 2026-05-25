import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import type {
    AnswerDto,
    QuestionDto,
    QuizCategoryRef,
    QuizDetailDto,
    QuizSubjectRef,
    QuizTranslationRef,
} from './dto/quiz-detail.dto';
import type { Locale } from './dto/translation.dto';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';

/**
 * QZ-01 — quiz create / update / soft-delete (Plan 02).
 *
 * Decisions baked in:
 *
 *   - Quizzes has NO deleted_at. SOFT DELETE = `status='inactive'`. Children (questions,
 *     answers, translations, results) are preserved. Hard delete deferred.
 *
 *   - QuizTranslation has NO @@unique([quiz_id, locale]). Service uses find-then-update
 *     inside $transaction (FIRST row per locale wins). Create path uses createMany.
 *
 *   - Quiz mutations DO NOT bump `version`. Version bumps are owned by Plan 05's
 *     destructive-edit detection on questions/answers (D-11/D-12).
 *
 *   - Scope check: curator -> 403 (defensive — controller @Roles excludes curator on
 *     create/update; @Roles excludes curator+teacher on delete). Teacher passes (D-21).
 *
 *   - Cache invalidation (T-06-19 / D-26): every mutation calls
 *     `cache.invalidate(QUIZZES_INVALIDATE_PATTERN)` after the tx commits.
 *
 *   - apiResponse wrap: per CLAUDE.md "Mutation/single-resource endpoints wrap with
 *     apiResponse(...)". Controller returns whatever the service returns — services
 *     wrap here, controllers do not double-wrap.
 *
 *   - createMany NOT supported on QuizTranslation in this schema's MySQL +
 *     Prisma combination because QuizTranslation lacks @@unique — but createMany
 *     itself is fine (no skipDuplicates needed). Use plain createMany.
 */
@Injectable()
export class QuizzesMutationsService {
    private readonly logger = new Logger(QuizzesMutationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
    ) {}

    public async create(actor: ScopeActor, dto: CreateQuizDto) {
        if (actor.role_name === 'curator') {
            throw new ForbiddenException('quizzes.forbidden_scope');
        }

        // Optional category existence check.
        if (typeof dto.category_id === 'number' && dto.category_id > 0) {
            const cat: any = await this.prisma.quizCategory.findFirst({
                where: { id: dto.category_id },
                select: { id: true },
            });
            if (!cat) throw new BadRequestException('quizzes.category_not_found');
        }
        if (typeof dto.subject_id === 'number' && dto.subject_id > 0) {
            const sub: any = await this.prisma.quizSubject.findFirst({
                where: { id: dto.subject_id },
                select: { id: true },
            });
            if (!sub) throw new BadRequestException('quizzes.subject_not_found');
        }

        const pricing = resolvePricingOnCreate(dto);

        const now = nowSec();

        const created: any = await this.prisma.$transaction(async (tx) => {
            const q: any = await tx.quizzes.create({
                data: {
                    status: dto.status ?? 'active',
                    category_id: typeof dto.category_id === 'number' ? dto.category_id : null,
                    subject_id: typeof dto.subject_id === 'number' ? dto.subject_id : null,
                    time: dto.time ?? 0,
                    pass_mark: dto.pass_mark,
                    attempt: typeof dto.attempt === 'number' ? dto.attempt : null,
                    certificate: dto.certificate ?? false,
                    display_questions_randomly: dto.display_questions_randomly ?? false,
                    expiry_days: typeof dto.expiry_days === 'number' ? dto.expiry_days : null,
                    is_listed: pricing.is_listed,
                    is_paid: pricing.is_paid,
                    price: pricing.price,
                    access_days: pricing.access_days,
                    version: 1,
                    created_at: now,
                },
                select: { id: true },
            });

            const kzTranslations = dto.translations.filter((t) => t.locale === 'kz');
            if (kzTranslations.length > 0) {
                await tx.quizTranslation.createMany({
                    data: kzTranslations.map((t) => ({
                        quiz_id: q.id,
                        locale: t.locale,
                        title: t.title,
                    })),
                });
            }

            return q;
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        const detail = await this.readDetail(Number(created.id));
        return apiResponse(1, 'created', 'quizzes.created', detail);
    }

    public async update(actor: ScopeActor, id: number, dto: UpdateQuizDto) {
        const existing = await this.assertScope(actor, id);

        if (typeof dto.category_id === 'number' && dto.category_id > 0) {
            const cat: any = await this.prisma.quizCategory.findFirst({
                where: { id: dto.category_id },
                select: { id: true },
            });
            if (!cat) throw new BadRequestException('quizzes.category_not_found');
        }
        if (typeof dto.subject_id === 'number' && dto.subject_id > 0) {
            const sub: any = await this.prisma.quizSubject.findFirst({
                where: { id: dto.subject_id },
                select: { id: true },
            });
            if (!sub) throw new BadRequestException('quizzes.subject_not_found');
        }

        const now = nowSec();
        const data: Record<string, unknown> = {};
        if (dto.status !== undefined) data.status = dto.status;
        if (dto.category_id === null) data.category_id = null;
        else if (typeof dto.category_id === 'number') data.category_id = dto.category_id;
        if (dto.subject_id === null) data.subject_id = null;
        else if (typeof dto.subject_id === 'number') data.subject_id = dto.subject_id;
        if (dto.time === null) data.time = null;
        else if (typeof dto.time === 'number') data.time = dto.time;
        if (typeof dto.pass_mark === 'number') data.pass_mark = dto.pass_mark;
        if (dto.attempt === null) data.attempt = null;
        else if (typeof dto.attempt === 'number') data.attempt = dto.attempt;
        if (typeof dto.certificate === 'boolean') data.certificate = dto.certificate;
        if (typeof dto.display_questions_randomly === 'boolean') {
            data.display_questions_randomly = dto.display_questions_randomly;
        }
        if (dto.expiry_days === null) data.expiry_days = null;
        else if (typeof dto.expiry_days === 'number') data.expiry_days = dto.expiry_days;

        if (touchesPricing(dto)) {
            const snapshot: any = await this.prisma.quizzes.findUnique({
                where: { id: existing.id },
                select: { is_paid: true, price: true, access_days: true, is_listed: true },
            });
            const resolved = resolvePricingOnUpdate(dto, snapshot);
            if (resolved.is_listed !== undefined) data.is_listed = resolved.is_listed;
            if (resolved.is_paid !== undefined) data.is_paid = resolved.is_paid;
            if (resolved.price !== undefined) data.price = resolved.price;
            if (resolved.access_days !== undefined) data.access_days = resolved.access_days;
        }

        const kzTranslations = Array.isArray(dto.translations)
            ? dto.translations.filter((t) => t.locale === 'kz')
            : [];
        const hasField = Object.keys(data).length > 0;
        const hasTranslations = kzTranslations.length > 0;

        if (!hasField && !hasTranslations) {
            return apiResponse(1, 'noop', 'quizzes.updated', await this.readDetail(id));
        }

        await this.prisma.$transaction(async (tx) => {
            if (hasField) {
                data.updated_at = now;
                await tx.quizzes.update({ where: { id: existing.id }, data });
            } else {
                await tx.quizzes.update({ where: { id: existing.id }, data: { updated_at: now } });
            }

            if (hasTranslations) {
                for (const t of kzTranslations) {
                    const row: any = await tx.quizTranslation.findFirst({
                        where: { quiz_id: existing.id, locale: t.locale },
                        select: { id: true },
                        orderBy: { id: 'asc' },
                    });
                    if (row) {
                        await tx.quizTranslation.update({
                            where: { id: row.id },
                            data: { title: t.title },
                        });
                    } else {
                        await tx.quizTranslation.create({
                            data: { quiz_id: existing.id, locale: t.locale, title: t.title },
                        });
                    }
                }
            }
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'updated', 'quizzes.updated', await this.readDetail(id));
    }

    /**
     * Soft delete: status='inactive' + bump updated_at. Children preserved.
     * Admin-only (controller @Roles excludes teacher per D-21 safe default — teacher
     * can EDIT but not DELETE).
     */
    public async softDelete(actor: ScopeActor, id: number) {
        // Defensive scope check (controller already gates to admin).
        await this.assertScope(actor, id);
        if (actor.role_name !== 'admin') {
            throw new ForbiddenException('quizzes.forbidden_scope');
        }

        const now = nowSec();
        await this.prisma.quizzes.update({
            where: { id },
            data: { status: 'inactive', updated_at: now },
        });
        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'deleted', 'quizzes.deleted', { id, status: 'inactive', deleted: true });
    }

    private async assertScope(actor: ScopeActor, id: number): Promise<{ id: number }> {
        const existing: any = await this.prisma.quizzes.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('quizzes.not_found');
        if (actor.role_name === 'curator') {
            throw new ForbiddenException('quizzes.forbidden_scope');
        }
        return { id: Number(existing.id) };
    }

    /**
     * Re-read full detail. Shared between create / update / duplicate paths.
     * Exposed publicly so the duplicate service can use the same projection.
     */
    public async readDetail(id: number): Promise<QuizDetailDto> {
        return readQuizDetail(this.prisma, id);
    }
}

export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * Phase 22 pricing helpers.
 *
 * Contract:
 *   - is_listed defaults to true on create when omitted (matches schema default).
 *   - is_paid defaults to false on create when omitted.
 *   - When the resolved is_paid is true, both `price > 0` AND `access_days > 0`
 *     MUST be present (either in the DTO or in the existing row for updates).
 *   - When is_paid is false, price + access_days are cleared to null so a quiz
 *     flipped back to free cannot keep stale paid metadata.
 */
type CreatePricingInput = {
    is_listed?: boolean;
    is_paid?: boolean;
    price?: string | null;
    access_days?: number | null;
};

type ResolvedCreate = {
    is_listed: boolean;
    is_paid: boolean;
    price: string | null;
    access_days: number | null;
};

export function resolvePricingOnCreate(dto: CreatePricingInput): ResolvedCreate {
    const is_listed = dto.is_listed ?? true;
    const is_paid = dto.is_paid ?? false;

    if (!is_paid) {
        return { is_listed, is_paid: false, price: null, access_days: null };
    }

    const priceStr = typeof dto.price === 'string' ? dto.price.trim() : '';
    if (!priceStr || !(Number(priceStr) > 0)) {
        throw new BadRequestException('quizzes.pricing_invalid_price');
    }
    const access_days = typeof dto.access_days === 'number' ? dto.access_days : 0;
    if (!(access_days > 0)) {
        throw new BadRequestException('quizzes.pricing_invalid_access_days');
    }
    return { is_listed, is_paid: true, price: priceStr, access_days };
}

export function touchesPricing(dto: CreatePricingInput): boolean {
    return (
        dto.is_listed !== undefined ||
        dto.is_paid !== undefined ||
        dto.price !== undefined ||
        dto.access_days !== undefined
    );
}

type ResolvedUpdate = {
    is_listed?: boolean;
    is_paid?: boolean;
    price?: string | null;
    access_days?: number | null;
};

export function resolvePricingOnUpdate(
    dto: CreatePricingInput,
    snapshot: { is_paid: boolean; price: unknown; access_days: number | null; is_listed: boolean },
): ResolvedUpdate {
    const out: ResolvedUpdate = {};

    if (dto.is_listed !== undefined) out.is_listed = dto.is_listed;

    const nextIsPaid = dto.is_paid !== undefined ? dto.is_paid : snapshot.is_paid;

    if (dto.is_paid !== undefined) out.is_paid = dto.is_paid;

    if (!nextIsPaid) {
        // Flipped to free (or stayed free) — clear paid metadata.
        if (dto.is_paid === false) {
            out.price = null;
            out.access_days = null;
        } else if (dto.price !== undefined || dto.access_days !== undefined) {
            // Free quiz shouldn't carry pricing fields at all; silently ignore
            // explicit price/access_days writes when is_paid is false.
            out.price = null;
            out.access_days = null;
        }
        return out;
    }

    // nextIsPaid === true: validate resolved (DTO or existing) values.
    let nextPrice: string | null;
    if (dto.price !== undefined) {
        const priceStr = typeof dto.price === 'string' ? dto.price.trim() : '';
        if (!priceStr || !(Number(priceStr) > 0)) {
            throw new BadRequestException('quizzes.pricing_invalid_price');
        }
        nextPrice = priceStr;
        out.price = nextPrice;
    } else {
        // Use existing price (Prisma returns Decimal as string-like; coerce).
        const existing = snapshot.price == null ? null : String(snapshot.price);
        if (!existing || !(Number(existing) > 0)) {
            throw new BadRequestException('quizzes.pricing_invalid_price');
        }
        nextPrice = existing;
    }

    let nextAccessDays: number;
    if (dto.access_days !== undefined) {
        if (typeof dto.access_days !== 'number' || !(dto.access_days > 0)) {
            throw new BadRequestException('quizzes.pricing_invalid_access_days');
        }
        nextAccessDays = dto.access_days;
        out.access_days = nextAccessDays;
    } else {
        const existing = snapshot.access_days;
        if (typeof existing !== 'number' || !(existing > 0)) {
            throw new BadRequestException('quizzes.pricing_invalid_access_days');
        }
        nextAccessDays = existing;
    }

    return out;
}

/**
 * Shared QuizDetailDto projection. Used by mutations + duplicate services.
 *
 * Pulls the full graph (translations, questions, answers, badges, category, subject)
 * in a single findUnique. For typical create/duplicate response sizes (one quiz, ≤200
 * questions, ≤2000 answers) this is fine — the duplicate service's main cost is the
 * deep copy itself.
 */
export async function readQuizDetail(prisma: PrismaService, id: number): Promise<QuizDetailDto> {
    const row: any = await prisma.quizzes.findUnique({
        where: { id },
        select: {
            id: true,
            status: true,
            version: true,
            category_id: true,
            subject_id: true,
            time: true,
            pass_mark: true,
            attempt: true,
            certificate: true,
            display_questions_randomly: true,
            expiry_days: true,
            total_mark: true,
            is_listed: true,
            is_paid: true,
            price: true,
            access_days: true,
            created_at: true,
            updated_at: true,
            translations: { select: { locale: true, title: true } },
            quiz_category: {
                select: {
                    id: true,
                    parent_id: true,
                    translations: { select: { locale: true, title: true } },
                },
            },
            subject: {
                select: {
                    id: true,
                    translations: { select: { locale: true, title: true } },
                },
            },
            questions: {
                orderBy: [{ order: 'asc' }, { id: 'asc' }],
                select: {
                    id: true,
                    type: true,
                    grade: true,
                    image: true,
                    video: true,
                    answer_video_url: true,
                    order: true,
                    created_at: true,
                    updated_at: true,
                    translations: {
                        select: { locale: true, title: true, description: true, correct: true },
                    },
                    answers: {
                        orderBy: { id: 'asc' },
                        select: {
                            id: true,
                            parent_id: true,
                            match_target_id: true,
                            image: true,
                            correct: true,
                            created_at: true,
                            updated_at: true,
                            translations: { select: { locale: true, title: true } },
                        },
                    },
                },
            },
            quiz_badge_items: {
                select: {
                    quiz_badge: {
                        select: {
                            id: true,
                            is_active: true,
                            translations: { select: { locale: true, title: true } },
                        },
                    },
                },
            },
        },
    });
    if (!row) throw new NotFoundException('quizzes.not_found');

    const translations: QuizTranslationRef[] = ((row.translations ?? []) as any[])
        .filter((t) => t.locale === 'kz')
        .map((t) => ({ locale: 'kz' as const, title: t.title }));

    const kzTitle = translations.find((t) => t.locale === 'kz')?.title?.trim() ?? '';
    const missing_locales: Locale[] = [];
    if (kzTitle.length === 0) missing_locales.push('kz');
    const translation_completeness: 'complete' | 'incomplete' = missing_locales.length === 0 ? 'complete' : 'incomplete';

    const category: QuizCategoryRef | null = row.quiz_category
        ? {
              id: Number(row.quiz_category.id),
              parent_id: row.quiz_category.parent_id == null ? null : Number(row.quiz_category.parent_id),
              title_kz:
                  (row.quiz_category.translations ?? []).find((t: any) => t.locale === 'kz')?.title ?? null,
          }
        : null;

    const subject: QuizSubjectRef | null = row.subject
        ? {
              id: Number(row.subject.id),
              title_kz: (row.subject.translations ?? []).find((t: any) => t.locale === 'kz')?.title ?? null,
          }
        : null;

    const questions: QuestionDto[] = ((row.questions ?? []) as any[]).map((q) => {
        const answers: AnswerDto[] = ((q.answers ?? []) as any[]).map((a) => ({
            id: Number(a.id),
            parent_id: a.parent_id == null ? null : Number(a.parent_id),
            match_target_id: a.match_target_id == null ? null : Number(a.match_target_id),
            image: a.image ?? null,
            correct: !!a.correct,
            translations: ((a.translations ?? []) as any[])
                .filter((t) => t.locale === 'kz')
                .map((t) => ({ locale: 'kz' as const, title: t.title })),
            created_at: Number(a.created_at),
            updated_at: a.updated_at == null ? null : Number(a.updated_at),
        }));
        return {
            id: Number(q.id),
            type: q.type,
            grade: Number(q.grade ?? 0),
            image: q.image ?? null,
            video: q.video ?? null,
            answer_video_url: q.answer_video_url ?? null,
            order: q.order == null ? null : Number(q.order),
            translations: ((q.translations ?? []) as any[])
                .filter((t) => t.locale === 'kz')
                .map((t) => ({
                    locale: 'kz' as const,
                    title: t.title,
                    description: t.description ?? null,
                    correct: t.correct ?? null,
                })),
            answers,
            created_at: Number(q.created_at),
            updated_at: q.updated_at == null ? null : Number(q.updated_at),
        };
    });

    const badges = ((row.quiz_badge_items ?? []) as any[])
        .filter((it: any) => it.quiz_badge)
        .map((it: any) => ({
            id: Number(it.quiz_badge.id),
            title_kz: (it.quiz_badge.translations ?? []).find((t: any) => t.locale === 'kz')?.title ?? null,
            is_active: !!it.quiz_badge.is_active,
        }));

    const total_mark =
        row.total_mark != null
            ? Number(row.total_mark)
            : questions.reduce((acc, q) => acc + (q.grade ?? 0), 0);

    return {
        id: Number(row.id),
        status: row.status,
        version: Number(row.version ?? 1),
        category,
        subject,
        time: row.time == null ? null : Number(row.time),
        pass_mark: Number(row.pass_mark ?? 0),
        attempt: row.attempt == null ? null : Number(row.attempt),
        certificate: !!row.certificate,
        display_questions_randomly: !!row.display_questions_randomly,
        expiry_days: row.expiry_days == null ? null : Number(row.expiry_days),
        is_listed: !!row.is_listed,
        is_paid: !!row.is_paid,
        price: row.price == null ? null : String(row.price),
        access_days: row.access_days == null ? null : Number(row.access_days),
        translations,
        translation_completeness,
        missing_locales,
        questions,
        badges,
        counts: {
            question_count: questions.length,
            total_mark,
        },
        created_at: Number(row.created_at),
        updated_at: row.updated_at == null ? null : Number(row.updated_at),
    };
}
