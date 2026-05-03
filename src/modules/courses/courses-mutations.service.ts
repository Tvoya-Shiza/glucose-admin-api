import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import type { CourseDetailDto, TranslationRowDto } from './dto/course-detail.dto';
import { deriveTranslationCompleteness } from './utils/translation-completeness';

/**
 * CRS-01 + CRS-07 — course create / update / soft-delete (Plan 02 task 2).
 *
 * Decisions baked in (per Plan 01 schema-truth notes + Plan 02 actions):
 *
 *   - Soft-delete: Webinar.deleted_at exists (schema line 821). DELETE = update with
 *     deleted_at = Math.floor(Date.now() / 1000). Does NOT cascade — translations,
 *     chapters, items, schedules remain in DB and are filtered out of subsequent
 *     reads via `deleted_at: null`. Future hard-delete is out of scope.
 *
 *   - 3-step assertScope (mirrors Phase 4 Plan 03 GroupsDetail pattern):
 *       1) Existence: findFirst({ where: { id, deleted_at: null } }) -> 404 on null.
 *       2) Teacher gate: if actor.role_name !== 'admin' AND existing.teacher_id !== actor.id -> 403.
 *       3) Proceed with mutation.
 *     This is the canonical "courses.forbidden_scope" surface.
 *
 *   - Teacher-create gate (T-05-10 mitigation):
 *     When actor.role_name === 'teacher', dto.teacher_id MUST equal actor.id.
 *     Mismatch -> 403 'courses.forbidden_assign_teacher'.
 *
 *   - Webinar.image_cover and Webinar.thumbnail are NOT NULL on schema (lines 813-814).
 *     Default to '' on create when caller omits.
 *
 *   - WebinarTranslations has NO @@unique([webinar_id, locale]) — service uses
 *     find-then-update on the update path (FIRST row per (webinar_id, locale) wins).
 *     Create path uses createMany (no dedup gate at create time — DTO @ArrayMaxSize(2)
 *     and the locale union narrow this to ru+kz).
 *
 *   - WebinarChapter has no `description` column; chapters not touched here.
 *
 *   - Audit: each mutation handler in courses-mutations.controller.ts wears @Audit.
 *     Service-layer cache invalidation hooked here per CONTEXT D-25.
 *
 *   - Cache invalidation: deferred to a follow-up wire-up (CacheService not yet injected
 *     into CoursesModule). The call sites are explicitly marked TODO so Plan 03 (which
 *     introduces detail-cache reads) can flip the switch in one go. The list endpoint is
 *     uncached today — staleness is bounded.
 */
@Injectable()
export class CoursesMutationsService {
    private readonly logger = new Logger(CoursesMutationsService.name);

    constructor(private readonly prisma: PrismaService) {}

    /** CRS-01 create. */
    public async create(actor: ScopeActor, dto: CreateCourseDto): Promise<CourseDetailDto> {
        // T-05-10: teacher creating on behalf of someone else -> 403.
        if (actor.role_name === 'teacher' && dto.teacher_id !== actor.id) {
            throw new ForbiddenException('courses.forbidden_assign_teacher');
        }
        if (actor.role_name === 'curator') {
            // Defensive — controller @Roles already excludes curator.
            throw new ForbiddenException('courses.forbidden_scope');
        }

        // Validate target teacher exists and has role_name='teacher'.
        const teacher: any = await this.prisma.user.findFirst({
            where: { id: dto.teacher_id, deleted_at: null, role_name: 'teacher' },
            select: { id: true },
        });
        if (!teacher) {
            throw new BadRequestException('courses.teacher_not_found');
        }

        // Optional category_id validation: only check existence (not scope) — admin governs.
        if (typeof dto.category_id === 'number' && dto.category_id > 0) {
            const cat: any = await this.prisma.webinarCategory.findFirst({
                where: { id: dto.category_id },
                select: { id: true },
            });
            if (!cat) {
                throw new BadRequestException('courses.category_not_found');
            }
        }

        const now = Math.floor(Date.now() / 1000);

        // create -> then translations.createMany inside the same $transaction so a
        // translation insert failure rolls back the webinar row.
        const created: any = await this.prisma.$transaction(async (tx) => {
            const w: any = await tx.webinar.create({
                data: {
                    slug: dto.slug,
                    type: dto.type ?? 'course',
                    status: dto.status,
                    teacher_id: dto.teacher_id,
                    creator_id: actor.id,
                    category_id: typeof dto.category_id === 'number' ? dto.category_id : null,
                    image_cover: dto.image_cover ?? '',
                    thumbnail: dto.thumbnail ?? '',
                    created_at: now,
                },
                select: { id: true },
            });

            if (dto.translations.length > 0) {
                await tx.webinarTranslations.createMany({
                    data: dto.translations.map((t) => ({
                        webinar_id: w.id,
                        locale: t.locale,
                        title: t.title,
                        description: t.description ?? null,
                    })),
                });
            }

            return w;
        });

        // TODO (Plan 03 wire-up): cache.invalidate(COURSES_INVALIDATE_PATTERN)
        return this.readDetail(Number(created.id));
    }

    /** CRS-01 update. Partial PATCH; translations upserted by locale (no @@unique). */
    public async update(actor: ScopeActor, id: number, dto: UpdateCourseDto): Promise<CourseDetailDto> {
        const existing = await this.assertScope(actor, id);

        // category_id existence (optional — null clears).
        if (typeof dto.category_id === 'number' && dto.category_id > 0) {
            const cat: any = await this.prisma.webinarCategory.findFirst({
                where: { id: dto.category_id },
                select: { id: true },
            });
            if (!cat) {
                throw new BadRequestException('courses.category_not_found');
            }
        }

        const now = Math.floor(Date.now() / 1000);

        const data: Record<string, unknown> = {};
        if (typeof dto.slug === 'string') data.slug = dto.slug;
        if (typeof dto.status === 'string') data.status = dto.status;
        if (typeof dto.image_cover === 'string') data.image_cover = dto.image_cover;
        if (typeof dto.thumbnail === 'string') data.thumbnail = dto.thumbnail;
        if (dto.category_id === null) data.category_id = null;
        else if (typeof dto.category_id === 'number') data.category_id = dto.category_id;

        const hasField = Object.keys(data).length > 0;
        const hasTranslations = Array.isArray(dto.translations) && dto.translations.length > 0;

        if (!hasField && !hasTranslations) {
            // No-op — return current state.
            return this.readDetail(id);
        }

        await this.prisma.$transaction(async (tx) => {
            if (hasField) {
                data.updated_at = now;
                await tx.webinar.update({ where: { id: existing.id }, data });
            } else {
                // bump updated_at on translation-only edits
                await tx.webinar.update({ where: { id: existing.id }, data: { updated_at: now } });
            }

            if (hasTranslations) {
                for (const t of dto.translations!) {
                    // Find FIRST row by (webinar_id, locale) — schema lacks @@unique so we cannot
                    // use upsert. Documented in DTO header.
                    const row: any = await tx.webinarTranslations.findFirst({
                        where: { webinar_id: existing.id, locale: t.locale },
                        select: { id: true },
                        orderBy: { id: 'asc' },
                    });
                    if (row) {
                        await tx.webinarTranslations.update({
                            where: { id: row.id },
                            data: {
                                title: t.title,
                                description: t.description ?? null,
                            },
                        });
                    } else {
                        await tx.webinarTranslations.create({
                            data: {
                                webinar_id: existing.id,
                                locale: t.locale,
                                title: t.title,
                                description: t.description ?? null,
                            },
                        });
                    }
                }
            }
        });

        // TODO (Plan 03 wire-up): cache.invalidate(COURSES_INVALIDATE_PATTERN)
        return this.readDetail(id);
    }

    /** CRS-01 soft-delete. */
    public async softDelete(actor: ScopeActor, id: number): Promise<{ id: number; deleted: true }> {
        const existing = await this.assertScope(actor, id);
        const now = Math.floor(Date.now() / 1000);
        await this.prisma.webinar.update({
            where: { id: existing.id },
            data: { deleted_at: now, updated_at: now },
        });
        // TODO (Plan 03 wire-up): cache.invalidate(COURSES_INVALIDATE_PATTERN)
        return { id, deleted: true };
    }

    /**
     * 3-step assertScope: existence -> teacher gate -> proceed.
     * Returns the existing row (id + teacher_id + creator_id) for caller use.
     */
    private async assertScope(
        actor: ScopeActor,
        id: number,
    ): Promise<{ id: number; teacher_id: number; creator_id: number }> {
        const existing: any = await this.prisma.webinar.findFirst({
            where: { id, deleted_at: null },
            select: { id: true, teacher_id: true, creator_id: true },
        });
        if (!existing) {
            throw new NotFoundException('courses.not_found');
        }
        if (actor.role_name !== 'admin') {
            // Teacher path: must own the course. Curator path: never reached (controller
            // @Roles excludes curator) — defensive.
            if (actor.role_name === 'teacher' && Number(existing.teacher_id) !== actor.id) {
                throw new ForbiddenException('courses.forbidden_scope');
            }
            if (actor.role_name === 'curator') {
                throw new ForbiddenException('courses.forbidden_scope');
            }
        }
        return {
            id: Number(existing.id),
            teacher_id: Number(existing.teacher_id),
            creator_id: Number(existing.creator_id),
        };
    }

    /** Re-read the full detail shape. Used by create + update return values. */
    private async readDetail(id: number): Promise<CourseDetailDto> {
        const row: any = await this.prisma.webinar.findFirst({
            where: { id },
            select: {
                id: true,
                slug: true,
                type: true,
                status: true,
                image_cover: true,
                thumbnail: true,
                capacity: true,
                certificate: true,
                start_date: true,
                duration: true,
                position: true,
                created_at: true,
                updated_at: true,
                deleted_at: true,
                teacher: { select: { id: true, full_name: true, email: true } },
                category: { select: { id: true, slug: true } },
                translations: { select: { locale: true, title: true, description: true } },
                _count: { select: { chapters: true } },
            },
        });
        if (!row) {
            // Should not happen — caller just created/updated this id.
            throw new NotFoundException('courses.not_found');
        }

        const translations: TranslationRowDto[] = (row.translations ?? [])
            .filter((t: any) => t.locale === 'ru' || t.locale === 'kz')
            .map((t: any) => ({
                locale: t.locale as 'ru' | 'kz',
                title: t.title,
                description: t.description ?? null,
            }));

        const completeness = deriveTranslationCompleteness(
            translations.map((t) => ({ locale: t.locale, title: t.title })),
        );

        return {
            id: Number(row.id),
            slug: row.slug,
            type: row.type,
            status: row.status,
            teacher: row.teacher
                ? {
                      id: Number(row.teacher.id),
                      full_name: row.teacher.full_name ?? null,
                      email: row.teacher.email ?? null,
                  }
                : null,
            // category title-locales not available in this select — Plan 03 detail service joins translations.
            category: row.category
                ? { id: Number(row.category.id), slug: row.category.slug, title_ru: null, title_kz: null }
                : null,
            image_cover: row.image_cover ?? '',
            thumbnail: row.thumbnail ?? '',
            capacity: row.capacity == null ? null : Number(row.capacity),
            certificate: !!row.certificate,
            start_date: row.start_date == null ? null : Number(row.start_date),
            duration: row.duration == null ? null : Number(row.duration),
            position: row.position == null ? null : Number(row.position),
            created_at: Number(row.created_at),
            updated_at: row.updated_at == null ? null : Number(row.updated_at),
            deleted_at: row.deleted_at == null ? null : Number(row.deleted_at),
            translations,
            translation_completeness: completeness.translation_completeness,
            missing_locales: completeness.missing_locales,
            chapters: [],
            counts: {
                chapter_count: row._count?.chapters ?? 0,
                item_count: 0,
                schedule_count: 0,
            },
        };
    }
}
