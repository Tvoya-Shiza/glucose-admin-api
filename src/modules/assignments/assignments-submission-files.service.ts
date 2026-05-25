import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { normalizeMojibakeUtf8 } from '../../common/utils/mojibake';
import { ASSIGNMENT_SUBMISSION_SCOPE_RULES } from './assignments.scope';

export interface ResolvedSubmissionFile {
    absolutePath: string;
    /** Human-readable filename for Content-Disposition (mojibake-normalized). */
    displayName: string;
    size: number;
}

/**
 * Резолвит файл, прикреплённый к сообщению в треде сабмишена, в абсолютный путь
 * на shared docker-volume `/uploads`. Используется новым endpoint-ом
 * `/v1/admin/assignments/.../messages/:id/file`, который стримит файл клиенту
 * через BFF-прокси (AUTH-08: браузер не ходит напрямую за токенами в admin-api,
 * а файлы доступны только авторизованным админам).
 *
 * Поля `file_path` в БД исторически имеют разные форматы:
 *   - `store/assignment_messages/<file>` — legacy Laravel education-app
 *   - `/static/assignment_messages/<file>` — glucose-api с `publicUrlPrefix=/static`
 *   - `http(s)://host/static/assignment_messages/<file>` — после toAbsoluteMediaUrl
 *   - `/static/courses/<file>` — uploads через admin-api
 *
 * Все варианты сводятся к относительному пути от storage root и проверяются на
 * path traversal (резолв должен оставаться внутри `sharedStorage.baseDir`).
 */
@Injectable()
export class AssignmentsSubmissionFilesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
    ) {}

    public async resolve(
        actor: ScopeActor,
        assignmentId: number,
        historyId: number,
        messageId: number,
    ): Promise<ResolvedSubmissionFile> {
        const baseWhere: any = { id: historyId, assignment_id: assignmentId };
        const scoped = await this.applyTeacherSubmissionScope(actor, baseWhere);

        const historyRow = await this.prisma.webinarAssignmentHistory.findFirst({
            where: scoped,
            select: { id: true },
        });
        if (!historyRow) {
            throw new NotFoundException({ message: 'submission.not_found', trans: 'admin.assignments.submission_not_found' });
        }

        const message = await this.prisma.webinarAssignmentHistoryMessage.findFirst({
            where: { id: messageId, assignment_history_id: historyId },
            select: { file_path: true, file_title: true },
        });
        if (!message || !message.file_path) {
            throw new NotFoundException({ message: 'submission.file.not_found', trans: 'admin.assignments.submission_file_not_found' });
        }

        const relative = this.extractRelativePath(message.file_path);
        const absolutePath = this.resolveAbsolutePath(relative);
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile()) {
            throw new NotFoundException({ message: 'submission.file.not_found', trans: 'admin.assignments.submission_file_not_found' });
        }

        const displayName =
            normalizeMojibakeUtf8(message.file_title) ??
            normalizeMojibakeUtf8(path.basename(relative)) ??
            'file';

        return { absolutePath, displayName, size: stat.size };
    }

    /**
     * Снимает любой URL-/префикс-«мусор» с file_path и возвращает путь
     * относительно storage root. Поднимает 404, если путь не соответствует
     * белому списку поддиректорий — иначе мы рискуем отдать что-то постороннее.
     *
     * Поддерживаемые входы (после strip'ов всё должно начинаться с
     * `assignment_messages/`):
     *   - `store/assignment_messages/<file>`              (legacy Laravel)
     *   - `/static/assignment_messages/<file>`            (user-api dev)
     *   - `http(s)://host/static/assignment_messages/<file>` (user-api после toAbsoluteMediaUrl)
     *   - `/static/courses/assignment_messages/<file>`    (если когда-то загружалось через admin-api)
     */
    private extractRelativePath(raw: string): string {
        let s = String(raw).trim();
        s = s.replace(/^https?:\/\/[^/]+/i, ''); // proto+host
        s = s.replace(/^\/+/, ''); // ведущие слэши
        s = s.replace(/^(?:store|static)\//, ''); // публичный префикс
        s = s.replace(/^courses\//, ''); // вложение admin-api uploads

        if (!/^assignment_messages\/[^/]+$/.test(s)) {
            throw new NotFoundException({ message: 'submission.file.not_found', trans: 'admin.assignments.submission_file_not_found' });
        }

        return s;
    }

    private resolveAbsolutePath(relative: string): string {
        const baseDir = this.config.get<string>('sharedStorage.baseDir') ?? '/uploads';
        const root = path.resolve(baseDir);
        const candidate = path.resolve(root, relative);

        // Path traversal guard: финальный путь обязан быть внутри root.
        const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
        if (candidate !== root && !candidate.startsWith(rootWithSep)) {
            throw new NotFoundException({ message: 'submission.file.not_found', trans: 'admin.assignments.submission_file_not_found' });
        }
        if (!fs.existsSync(candidate)) {
            throw new NotFoundException({ message: 'submission.file.not_found', trans: 'admin.assignments.submission_file_not_found' });
        }
        return candidate;
    }

    /**
     * Параллель `AssignmentsSubmissionsService.applyTeacherSubmissionScope`.
     * Дублируем здесь, чтобы не плодить циклические зависимости между сервисами;
     * рул в одной точке (assignments.scope.ts), а teacher-narrowing требует
     * запроса в БД и поэтому остаётся отдельным шагом.
     */
    private async applyTeacherSubmissionScope(actor: ScopeActor, baseWhere: any): Promise<any> {
        if (actor.role_name === 'admin') {
            return baseWhere;
        }
        if (actor.role_name === 'teacher') {
            const own = await this.prisma.webinar.findMany({
                where: { teacher_id: actor.id },
                select: { id: true },
            });
            const webinarIds = own.map((w) => Number(w.id));
            return { ...baseWhere, assignment: { webinar_id: { in: webinarIds.length === 0 ? [-1] : webinarIds } } };
        }
        if (actor.role_name === 'curator') {
            const scopeWhere = buildScopeWhere(actor, ASSIGNMENT_SUBMISSION_SCOPE_RULES);
            return { ...baseWhere, ...(scopeWhere as object) };
        }
        throw new ForbiddenException({ message: 'assignment.forbidden', trans: 'admin.assignments.forbidden' });
    }
}
