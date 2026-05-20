import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { UpsertAttachmentDto } from './dto/upsert-attachment.dto';
import { ASSIGNMENT_SCOPE_RULES } from './assignments.scope';

/**
 * Write surface for WebinarAssignment + its translations + attachments.
 *
 * Endpoints fulfilled:
 *   POST   /assignments                              — create with translations
 *   PATCH  /assignments/:id                          — partial update (translations are full-replace)
 *   PATCH  /assignments/:id/status                   — toggle active/inactive (publish)
 *   DELETE /assignments/:id                          — hard delete (cascades translations,
 *                                                      attachments, history via FK)
 *   POST   /assignments/:id/attachments              — add attachment (cap = 5)
 *   DELETE /assignments/:id/attachments/:attachId    — remove attachment
 *
 * Concurrency / rules:
 *   - Attachment cap (5) enforced in-service. Reject 6th with 422 + i18n key.
 *   - Curator scope = default-deny; only admin + teacher pass.
 *   - Translations are FULL-REPLACE on update for simplicity (matches quizzes pattern).
 *     Caller must always send both ru + kz if either changes.
 */
@Injectable()
export class AssignmentsMutationsService {
    public static readonly MAX_ATTACHMENTS = 5;

    constructor(private readonly prisma: PrismaService) {}

    public async create(actor: ScopeActor, dto: CreateAssignmentDto) {
        if (actor.role_name === 'curator') {
            throw new ForbiddenException({ message: 'assignment.curator_cannot_author', trans: 'admin.assignments.forbidden' });
        }

        // Course/chapter binding is OPTIONAL at create time. When both are
        // supplied, the chapter must belong to the webinar; when only one is
        // supplied the request is rejected (ambiguous half-binding).
        const hasWebinar = typeof dto.webinar_id === 'number';
        const hasChapter = typeof dto.chapter_id === 'number';
        if (hasWebinar !== hasChapter) {
            throw new BadRequestException({ message: 'assignment.binding_incomplete', trans: 'admin.assignments.binding_incomplete' });
        }
        if (hasWebinar && hasChapter) {
            const chapter = await this.prisma.webinarChapter.findFirst({
                where: { id: dto.chapter_id, webinar_id: dto.webinar_id },
                select: { id: true },
            });
            if (!chapter) {
                throw new BadRequestException({ message: 'assignment.chapter_mismatch', trans: 'admin.assignments.chapter_mismatch' });
            }
        }

        const created = await this.prisma.webinarAssignment.create({
            data: {
                creator_id: actor.id,
                webinar_id: hasWebinar ? dto.webinar_id : null,
                chapter_id: hasChapter ? dto.chapter_id : null,
                status: dto.status ?? 'active',
                grade: dto.grade,
                pass_grade: dto.pass_grade,
                deadline: dto.deadline,
                attempts: dto.attempts,
                check_previous_parts: dto.check_previous_parts ?? false,
                access_after_day: dto.access_after_day,
                created_at: BigInt(Math.floor(Date.now() / 1000)),
                translations: {
                    create: dto.translations.map((t) => ({
                        locale: t.locale,
                        title: t.title,
                        description: t.description,
                    })),
                },
            },
            select: { id: true },
        });
        return { id: Number(created.id) };
    }

    public async update(actor: ScopeActor, id: number, dto: UpdateAssignmentDto) {
        await this.assertWritable(actor, id);

        await this.prisma.$transaction(async (tx) => {
            await tx.webinarAssignment.update({
                where: { id },
                data: {
                    chapter_id: dto.chapter_id,
                    status: dto.status,
                    grade: dto.grade,
                    pass_grade: dto.pass_grade,
                    deadline: dto.deadline,
                    attempts: dto.attempts,
                    check_previous_parts: dto.check_previous_parts,
                    access_after_day: dto.access_after_day,
                },
            });

            if (dto.translations && dto.translations.length > 0) {
                await tx.webinarAssignmentTranslation.deleteMany({ where: { webinar_assignment_id: id } });
                await tx.webinarAssignmentTranslation.createMany({
                    data: dto.translations.map((t) => ({
                        webinar_assignment_id: id,
                        locale: t.locale,
                        title: t.title,
                        description: t.description,
                    })),
                });
            }
        });

        return { id };
    }

    public async toggleStatus(actor: ScopeActor, id: number, status: 'active' | 'inactive') {
        await this.assertWritable(actor, id);
        await this.prisma.webinarAssignment.update({ where: { id }, data: { status } });
        return { id, status };
    }

    public async remove(actor: ScopeActor, id: number) {
        await this.assertWritable(actor, id);
        // Cascade FKs handle translations + attachments + history + messages on schema-level.
        await this.prisma.webinarAssignment.delete({ where: { id } });
        return { id, deleted: true };
    }

    public async addAttachment(actor: ScopeActor, id: number, dto: UpsertAttachmentDto) {
        await this.assertWritable(actor, id);

        const existing = await this.prisma.webinarAssignmentAttachment.count({ where: { assignment_id: id } });
        if (existing >= AssignmentsMutationsService.MAX_ATTACHMENTS) {
            throw new ConflictException({
                message: 'assignment.too_many_attachments',
                trans: 'admin.assignments.too_many_attachments',
            });
        }

        const created = await this.prisma.webinarAssignmentAttachment.create({
            data: {
                creator_id: actor.id,
                assignment_id: id,
                title: dto.title,
                attach: dto.attach,
            },
            select: { id: true, title: true, attach: true },
        });
        return { id: Number(created.id), title: created.title, attach: created.attach };
    }

    public async removeAttachment(actor: ScopeActor, id: number, attachmentId: number) {
        await this.assertWritable(actor, id);
        const row = await this.prisma.webinarAssignmentAttachment.findFirst({
            where: { id: attachmentId, assignment_id: id },
            select: { id: true },
        });
        if (!row) {
            throw new NotFoundException({ message: 'assignment.attachment_not_found', trans: 'admin.assignments.attachment_not_found' });
        }
        await this.prisma.webinarAssignmentAttachment.delete({ where: { id: attachmentId } });
        return { id: attachmentId, deleted: true };
    }

    private async assertWritable(actor: ScopeActor, id: number): Promise<void> {
        const scopeWhere = buildScopeWhere(actor, ASSIGNMENT_SCOPE_RULES);
        const found = await this.prisma.webinarAssignment.findFirst({
            where: { id, ...(scopeWhere as object) },
            select: { id: true },
        });
        if (!found) {
            throw new NotFoundException({ message: 'assignment.not_found', trans: 'admin.assignments.not_found' });
        }
    }
}
