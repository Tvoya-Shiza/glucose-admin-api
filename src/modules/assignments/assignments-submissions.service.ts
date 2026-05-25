import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { normalizeMojibakeUtf8 } from '../../common/utils/mojibake';
import { GradeSubmissionDto } from './dto/grade-submission.dto';
import { ReplyMessageDto } from './dto/reply-message.dto';
import type {
    ListSubmissionsDto,
    SubmissionDetailDto,
    SubmissionListResponseDto,
    SubmissionMessageView,
    SubmissionRowDto,
    SubmissionStatusFilter,
} from './dto/list-submissions.dto';
import { ASSIGNMENT_SUBMISSION_SCOPE_RULES } from './assignments.scope';

/**
 * Submissions / grading surface.
 *
 * Endpoints fulfilled (mounted under /assignments/:assignmentId/submissions):
 *   GET    /                             — paginated list of WebinarAssignmentHistory rows
 *   GET    /:historyId                   — full thread (history + messages)
 *   POST   /:historyId/grade             — set grade + status; optional inline comment
 *                                          (creates a polymorphic message row, not the
 *                                           legacy single-shot curator_comment column)
 *   POST   /:historyId/messages          — curator/admin posts a thread reply
 *
 * Scope (read):
 *   admin   → all submissions
 *   curator → narrowed to submissions whose student is in a group the curator supervises
 *             (ASSIGNMENT_SUBMISSION_SCOPE_RULES.curator)
 *   teacher → narrowed to submissions on the teacher's own webinars (two-step lookup
 *             here at the call site — the scope rules can't query Prisma).
 *
 * Grade authorization: requires assignments.grade permission (enforced at controller).
 * Curators may grade submissions in their scope; teachers cannot grade by default.
 */
@Injectable()
export class AssignmentsSubmissionsService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async listForAssignment(
        actor: ScopeActor,
        assignmentId: number,
        query: ListSubmissionsDto,
    ): Promise<SubmissionListResponseDto> {
        await this.assertAssignmentVisible(actor, assignmentId);

        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            AssignmentsSubmissionsService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? AssignmentsSubmissionsService.DEFAULT_PAGE_SIZE),
        );
        const order: 'asc' | 'desc' = query.order ?? 'desc';
        const orderField = query.sort === 'grade' ? 'grade' : 'created_at';

        const filterWhere: any = { assignment_id: assignmentId };
        if (query.status) filterWhere.status = query.status;
        if (query.q && query.q.trim().length > 0) {
            filterWhere.student = { full_name: { contains: query.q.trim() } };
        }

        const scoped = await this.applyTeacherSubmissionScope(actor, filterWhere);

        const skip = (page - 1) * page_size;
        const [total, rows] = await this.prisma.$transaction([
            this.prisma.webinarAssignmentHistory.count({ where: scoped }),
            this.prisma.webinarAssignmentHistory.findMany({
                where: scoped,
                orderBy: [{ [orderField]: order }, { id: order }],
                take: page_size,
                skip,
                select: {
                    id: true,
                    student_id: true,
                    status: true,
                    grade: true,
                    created_at: true,
                    student: { select: { id: true, full_name: true } },
                    messages: {
                        select: { sender_id: true, file_path: true, sender: { select: { role_name: true } } },
                    },
                },
            }),
        ]);

        const mapped: SubmissionRowDto[] = (rows as any[]).map((r) => {
            const files_count = (r.messages ?? []).filter((m: any) => m.file_path).length;
            const has_curator_reply = (r.messages ?? []).some((m: any) => {
                const role = m.sender?.role_name;
                return role && role !== 'student';
            });
            return {
                history_id: Number(r.id),
                student_id: Number(r.student_id),
                student_name: r.student?.full_name ?? null,
                status: r.status as SubmissionStatusFilter,
                grade: r.grade == null ? null : Number(r.grade),
                submitted_at: String(r.created_at),
                files_count,
                has_curator_reply,
            };
        });

        return { rows: mapped, total, page, page_size };
    }

    public async detail(actor: ScopeActor, assignmentId: number, historyId: number): Promise<SubmissionDetailDto> {
        await this.assertAssignmentVisible(actor, assignmentId);
        const baseWhere: any = { id: historyId, assignment_id: assignmentId };
        const scoped = await this.applyTeacherSubmissionScope(actor, baseWhere);

        const row = await this.prisma.webinarAssignmentHistory.findFirst({
            where: scoped,
            select: {
                id: true,
                assignment_id: true,
                student_id: true,
                instructor_id: true,
                status: true,
                grade: true,
                created_at: true,
                student: { select: { full_name: true } },
                messages: {
                    orderBy: { created_at: 'asc' },
                    select: {
                        id: true,
                        sender_id: true,
                        message: true,
                        curator_comment: true,
                        file_title: true,
                        file_path: true,
                        created_at: true,
                        sender: { select: { full_name: true, role_name: true } },
                    },
                },
            },
        });
        if (!row) {
            throw new NotFoundException({ message: 'submission.not_found', trans: 'admin.assignments.submission_not_found' });
        }

        const messages: SubmissionMessageView[] = (row.messages ?? []).map((m: any) => {
            const hasFile = Boolean(m.file_path);
            return {
                id: Number(m.id),
                sender_id: Number(m.sender_id),
                sender_name: m.sender?.full_name ?? null,
                sender_role: m.sender?.role_name ?? null,
                message: m.message ?? '',
                curator_comment: m.curator_comment ?? null,
                // Normalize double-encoded UTF-8 (cyrillic uploads from legacy education saved
                // bytes interpreted as latin-1 and re-encoded). See common/utils/mojibake.ts.
                file_title: normalizeMojibakeUtf8(m.file_title) ?? null,
                file_url: hasFile
                    ? `/v1/admin/assignments/${assignmentId}/submissions/${historyId}/messages/${Number(m.id)}/file`
                    : null,
                created_at: String(m.created_at),
            };
        });

        return {
            history_id: Number(row.id),
            assignment_id: Number(row.assignment_id),
            student_id: Number(row.student_id),
            student_name: row.student?.full_name ?? null,
            instructor_id: Number(row.instructor_id),
            status: row.status as SubmissionStatusFilter,
            grade: row.grade == null ? null : Number(row.grade),
            submitted_at: String(row.created_at),
            messages,
        };
    }

    public async grade(actor: ScopeActor, assignmentId: number, historyId: number, dto: GradeSubmissionDto) {
        await this.assertAssignmentVisible(actor, assignmentId);
        const baseWhere: any = { id: historyId, assignment_id: assignmentId };
        const scoped = await this.applyTeacherSubmissionScope(actor, baseWhere);
        const found = await this.prisma.webinarAssignmentHistory.findFirst({ where: scoped, select: { id: true } });
        if (!found) {
            throw new NotFoundException({ message: 'submission.not_found', trans: 'admin.assignments.submission_not_found' });
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.webinarAssignmentHistory.update({
                where: { id: historyId },
                data: {
                    status: dto.status,
                    grade: dto.grade ?? undefined,
                    instructor_id: actor.id,
                },
            });
            if (dto.comment && dto.comment.trim().length > 0) {
                await tx.webinarAssignmentHistoryMessage.create({
                    data: {
                        assignment_history_id: historyId,
                        sender_id: actor.id,
                        message: dto.comment.trim(),
                        created_at: BigInt(Math.floor(Date.now() / 1000)),
                    },
                });
            }
        });
        return { history_id: historyId, status: dto.status, grade: dto.grade ?? null };
    }

    public async reply(actor: ScopeActor, assignmentId: number, historyId: number, dto: ReplyMessageDto) {
        await this.assertAssignmentVisible(actor, assignmentId);
        const baseWhere: any = { id: historyId, assignment_id: assignmentId };
        const scoped = await this.applyTeacherSubmissionScope(actor, baseWhere);
        const found = await this.prisma.webinarAssignmentHistory.findFirst({ where: scoped, select: { id: true } });
        if (!found) {
            throw new NotFoundException({ message: 'submission.not_found', trans: 'admin.assignments.submission_not_found' });
        }
        if (!dto.message || dto.message.trim().length === 0) {
            throw new ForbiddenException({ message: 'submission.empty_reply', trans: 'admin.assignments.empty_reply' });
        }

        const created = await this.prisma.webinarAssignmentHistoryMessage.create({
            data: {
                assignment_history_id: historyId,
                sender_id: actor.id,
                message: dto.message.trim(),
                created_at: BigInt(Math.floor(Date.now() / 1000)),
            },
            select: { id: true, created_at: true },
        });
        return { id: Number(created.id), created_at: String(created.created_at) };
    }

    /** Confirms the assignment is visible (admin sees all; teacher sees own; curator denied). */
    private async assertAssignmentVisible(actor: ScopeActor, assignmentId: number): Promise<void> {
        if (actor.role_name === 'admin') return;
        if (actor.role_name === 'teacher') {
            const owns = await this.prisma.webinarAssignment.findFirst({
                where: { id: assignmentId, webinar: { teacher_id: actor.id } },
                select: { id: true },
            });
            if (!owns) {
                throw new NotFoundException({ message: 'assignment.not_found', trans: 'admin.assignments.not_found' });
            }
            return;
        }
        if (actor.role_name === 'curator') {
            // curator submissions scope is applied at the message level via group supervision;
            // they may not browse the full assignment list, but they can read submissions for
            // students they supervise. Confirm at least one such submission exists.
            const reachable = await this.prisma.webinarAssignmentHistory.findFirst({
                where: {
                    assignment_id: assignmentId,
                    student: { group_users: { some: { group: { supervisor_id: actor.id } } } },
                },
                select: { id: true },
            });
            if (!reachable) {
                throw new NotFoundException({ message: 'assignment.not_found', trans: 'admin.assignments.not_found' });
            }
            return;
        }
        // Unknown role: deny.
        throw new ForbiddenException({ message: 'assignment.forbidden', trans: 'admin.assignments.forbidden' });
    }

    /**
     * Merges the static scope rules with a teacher-specific narrowing (own webinars).
     * Returns the merged where clause ready to feed into Prisma.
     */
    private async applyTeacherSubmissionScope(actor: ScopeActor, baseWhere: any): Promise<any> {
        if (actor.role_name === 'teacher') {
            const own = await this.prisma.webinar.findMany({
                where: { teacher_id: actor.id },
                select: { id: true },
            });
            const webinarIds = own.map((w) => Number(w.id));
            return { ...baseWhere, assignment: { webinar_id: { in: webinarIds.length === 0 ? [-1] : webinarIds } } };
        }
        const scopeWhere = buildScopeWhere(actor, ASSIGNMENT_SUBMISSION_SCOPE_RULES);
        return { ...baseWhere, ...(scopeWhere as object) };
    }
}
