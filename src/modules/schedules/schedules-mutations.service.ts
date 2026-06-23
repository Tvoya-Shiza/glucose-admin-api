import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CreateScheduleDto, ScheduleItemInputDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { SCHEDULE_SCOPE_RULES } from './schedules.scope';
import { normalizeScheduleDescription } from './utils/sanitize-html-server';

/**
 * Write surface for LessonSchedule.
 *
 *   POST   /schedules         — create with optional items array
 *   PATCH  /schedules/:id     — partial update; items array, when provided, is FULL-REPLACED
 *   DELETE /schedules/:id     — soft-delete (sets deleted_at)
 *
 * Invariants enforced here:
 *   - start_at < end_at (else 400 schedule.invalid_range)
 *   - non-admin actors must set curator_id = self (else 403 schedule.curator_mismatch)
 *   - referenced curator/group/course must exist (400 schedule.{curator,group,course}_not_found)
 *   - each item's (kind, ref_id) must exist in its target table (400 schedule.item_not_found)
 *   - duplicate items in the same schedule are intentionally allowed
 *     (mirrors stakeholder: "несколько записей с одинаковыми данными разрешены")
 */
@Injectable()
export class SchedulesMutationsService {
    constructor(private readonly prisma: PrismaService) {}

    public async create(actor: ScopeActor, dto: CreateScheduleDto) {
        this.assertCuratorOwnership(actor, dto.curator_id);
        this.assertValidRange(dto.start_at, dto.end_at);

        await this.assertRefsExist({
            curator_id: dto.curator_id,
            group_id: dto.group_id ?? null,
            course_id: dto.course_id,
            items: dto.items ?? [],
        });

        const nowSec = Math.floor(Date.now() / 1000);
        const created = await this.prisma.lessonSchedule.create({
            data: {
                curator_id: dto.curator_id,
                group_id: dto.group_id ?? null,
                course_id: dto.course_id,
                start_at: dto.start_at,
                end_at: dto.end_at,
                description: normalizeScheduleDescription(dto.description),
                status: dto.status ?? 'scheduled',
                block_before_start: dto.block_before_start ?? false,
                block_after_end: dto.block_after_end ?? false,
                created_by: actor.id,
                created_at: nowSec,
                items: {
                    create: (dto.items ?? []).map((it, idx) => ({
                        kind: it.kind,
                        ref_id: it.ref_id,
                        position: it.position ?? idx,
                        created_at: nowSec,
                    })),
                },
            },
            select: { id: true },
        });

        return { id: Number(created.id) };
    }

    public async update(actor: ScopeActor, id: bigint | number, dto: UpdateScheduleDto) {
        const idAsBigInt = typeof id === 'bigint' ? id : BigInt(id);
        const existing = await this.findWritable(actor, idAsBigInt);

        const start_at = dto.start_at ?? existing.start_at;
        const end_at = dto.end_at ?? existing.end_at;
        this.assertValidRange(start_at, end_at);

        await this.assertRefsExist({
            curator_id: existing.curator_id,
            // undefined = keep existing group; explicit null = convert to general.
            group_id: dto.group_id === undefined ? existing.group_id : dto.group_id,
            course_id: dto.course_id === undefined ? existing.course_id : dto.course_id ?? undefined,
            items: dto.items ?? [],
        });

        const nowSec = Math.floor(Date.now() / 1000);

        await this.prisma.$transaction(async (tx) => {
            await tx.lessonSchedule.update({
                where: { id: idAsBigInt },
                data: {
                    // undefined → unchanged; null → general; number → group-scoped.
                    group_id: dto.group_id,
                    course_id: dto.course_id === undefined ? undefined : dto.course_id,
                    start_at,
                    end_at,
                    description: dto.description === undefined ? undefined : normalizeScheduleDescription(dto.description),
                    status: dto.status,
                    block_before_start: dto.block_before_start,
                    block_after_end: dto.block_after_end,
                    updated_at: nowSec,
                },
            });

            if (dto.items !== undefined) {
                await tx.lessonScheduleItem.deleteMany({ where: { schedule_id: idAsBigInt } });
                if (dto.items.length > 0) {
                    await tx.lessonScheduleItem.createMany({
                        data: dto.items.map((it, idx) => ({
                            schedule_id: idAsBigInt,
                            kind: it.kind,
                            ref_id: it.ref_id,
                            position: it.position ?? idx,
                            created_at: nowSec,
                        })),
                    });
                }
            }
        });

        return { id: Number(idAsBigInt) };
    }

    public async remove(actor: ScopeActor, id: bigint | number) {
        const idAsBigInt = typeof id === 'bigint' ? id : BigInt(id);
        await this.findWritable(actor, idAsBigInt);
        const nowSec = Math.floor(Date.now() / 1000);
        await this.prisma.lessonSchedule.update({
            where: { id: idAsBigInt },
            data: { deleted_at: nowSec },
        });
        return { id: Number(idAsBigInt), deleted: true };
    }

    // -------------------------------------------------------------- helpers

    private assertCuratorOwnership(actor: ScopeActor, curator_id: number): void {
        if (actor.role_name === 'admin') return;
        if (curator_id !== actor.id) {
            throw new ForbiddenException({
                message: 'schedule.curator_mismatch',
                trans: 'admin.schedules.curator_mismatch',
            });
        }
    }

    private assertValidRange(start_at: number, end_at: number): void {
        if (end_at <= start_at) {
            throw new BadRequestException({
                message: 'schedule.invalid_range',
                trans: 'admin.schedules.invalid_range',
            });
        }
    }

    private async assertRefsExist(args: {
        curator_id: number;
        // Phase 32 — null/undefined = general schedule, no group to validate.
        group_id?: number | null;
        course_id?: number | null;
        items: ScheduleItemInputDto[];
    }): Promise<void> {
        const checks: Promise<unknown>[] = [
            this.prisma.user.findUnique({ where: { id: args.curator_id }, select: { id: true } }).then((u) => {
                if (!u) {
                    throw new BadRequestException({
                        message: 'schedule.curator_not_found',
                        trans: 'admin.schedules.curator_not_found',
                    });
                }
            }),
        ];
        if (typeof args.group_id === 'number') {
            checks.push(
                this.prisma.group.findUnique({ where: { id: args.group_id }, select: { id: true } }).then((g) => {
                    if (!g) {
                        throw new BadRequestException({
                            message: 'schedule.group_not_found',
                            trans: 'admin.schedules.group_not_found',
                        });
                    }
                }),
            );
        }
        if (typeof args.course_id === 'number') {
            checks.push(
                this.prisma.webinar.findUnique({ where: { id: args.course_id }, select: { id: true } }).then((w) => {
                    if (!w) {
                        throw new BadRequestException({
                            message: 'schedule.course_not_found',
                            trans: 'admin.schedules.course_not_found',
                        });
                    }
                }),
            );
        }
        await Promise.all(checks);

        if (args.items.length === 0) return;

        const lessonIds = new Set<number>();
        const quizIds = new Set<number>();
        const assignmentIds = new Set<number>();
        const fileIds = new Set<number>();
        for (const it of args.items) {
            if (it.kind === 'lesson') lessonIds.add(it.ref_id);
            else if (it.kind === 'quiz') quizIds.add(it.ref_id);
            else if (it.kind === 'assignment') assignmentIds.add(it.ref_id);
            else if (it.kind === 'file') fileIds.add(it.ref_id);
        }

        // When course_id is bound to the schedule, every ref MUST belong to that
        // course. Lessons / files / assignments are filtered by their own
        // webinar_id column. Quizzes link to courses via WebinarChapterItem rows
        // (`type='quiz'`, `item_id=quiz.id`) joined through WebinarChapter — the
        // legacy WebinarQuiz junction is unused in production data. This mirrors
        // the picker source-of-truth (CoursesPickerItemsService.listQuizzes).
        const courseFilter = typeof args.course_id === 'number' ? { webinar_id: args.course_id } : {};

        const [lessons, quizzes, assignments, files] = await Promise.all([
            lessonIds.size === 0
                ? Promise.resolve([] as Array<{ id: number }>)
                : this.prisma.webinarChapter.findMany({
                      where: { id: { in: Array.from(lessonIds) }, ...courseFilter },
                      select: { id: true },
                  }),
            quizIds.size === 0
                ? Promise.resolve([] as Array<{ quiz_id?: number; id?: number }>)
                : typeof args.course_id === 'number'
                  ? this.prisma.webinarChapterItem.findMany({
                        where: {
                            type: 'quiz',
                            item_id: { in: Array.from(quizIds) },
                            webinar_chapter: { webinar_id: args.course_id },
                        },
                        select: { item_id: true },
                        distinct: ['item_id'],
                    }).then((rows) => rows.map((r) => ({ quiz_id: r.item_id })))
                  : this.prisma.quizzes.findMany({
                        where: { id: { in: Array.from(quizIds) } },
                        select: { id: true },
                    }),
            assignmentIds.size === 0
                ? Promise.resolve([] as Array<{ id: number }>)
                : this.prisma.webinarAssignment.findMany({
                      where: { id: { in: Array.from(assignmentIds) }, ...courseFilter },
                      select: { id: true },
                  }),
            fileIds.size === 0
                ? Promise.resolve([] as Array<{ id: number }>)
                : this.prisma.files.findMany({
                      where: { id: { in: Array.from(fileIds) }, ...courseFilter },
                      select: { id: true },
                  }),
        ]);

        if (
            lessons.length !== lessonIds.size ||
            quizzes.length !== quizIds.size ||
            assignments.length !== assignmentIds.size ||
            files.length !== fileIds.size
        ) {
            throw new BadRequestException({
                message:
                    typeof args.course_id === 'number'
                        ? 'schedule.item_not_in_course'
                        : 'schedule.item_not_found',
                trans:
                    typeof args.course_id === 'number'
                        ? 'admin.schedules.item_not_in_course'
                        : 'admin.schedules.item_not_found',
            });
        }
    }

    private async findWritable(actor: ScopeActor, id: bigint) {
        const scopeWhere = buildScopeWhere(actor, SCHEDULE_SCOPE_RULES);
        const found = await this.prisma.lessonSchedule.findFirst({
            where: { id, deleted_at: null, ...(scopeWhere as object) },
            select: { id: true, curator_id: true, group_id: true, course_id: true, start_at: true, end_at: true },
        });
        if (!found) {
            throw new NotFoundException({ message: 'schedule.not_found', trans: 'admin.schedules.not_found' });
        }
        return {
            id: found.id,
            curator_id: Number(found.curator_id),
            group_id: found.group_id == null ? null : Number(found.group_id),
            course_id: found.course_id == null ? null : Number(found.course_id),
            start_at: Number(found.start_at),
            end_at: Number(found.end_at),
        };
    }
}
