import { Controller, Get, Param, ParseIntPipe, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { AssignmentsSubmissionFilesService } from './assignments-submission-files.service';

/**
 * Стримит файл, прикреплённый к сообщению в треде сабмишена.
 *
 * Архитектурно: AUTH-08 запрещает браузеру стучаться напрямую за токеном в
 * admin-api или legacy storage. Старый `file_path` отдавался как сырой
 * относительный путь (`store/assignment_messages/...`), что ломалось на
 * клиенте — браузер резолвил его относительно текущего URL. Теперь клиент
 * получает `file_url` = `/v1/admin/assignments/:id/submissions/:hid/messages/:mid/file`,
 * BFF-прокси кладёт Bearer и форвардит сюда, мы стримим файл с shared docker
 * volume `/uploads`.
 *
 * Mime-type вычисляется по расширению; для PDF — `application/pdf` с
 * `Content-Disposition: inline`, чтобы открывалось во встроенном просмотрщике.
 */
@Controller('admin-api/v1/admin/assignments/:assignmentId/submissions/:historyId/messages')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class AssignmentsSubmissionFilesController {
    constructor(private readonly svc: AssignmentsSubmissionFilesService) {}

    @Get(':messageId/file')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('assignments.submissions_view')
    public async getFile(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('assignmentId', ParseIntPipe) assignmentId: number,
        @Param('historyId', ParseIntPipe) historyId: number,
        @Param('messageId', ParseIntPipe) messageId: number,
        @Res({ passthrough: true }) res: Response,
    ): Promise<StreamableFile> {
        const resolved = await this.svc.resolve(
            { id: actor.id, role_name: actor.role_name },
            assignmentId,
            historyId,
            messageId,
        );

        const ext = path.extname(resolved.absolutePath).toLowerCase();
        const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
        const disposition = contentType === 'application/pdf' ? 'inline' : 'attachment';

        // RFC 5987: filename* для корректной отдачи unicode имени файла.
        const encodedName = encodeURIComponent(resolved.displayName);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(resolved.size));
        res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedName}`);
        // Студенческие работы — никаких прокси-кэшей.
        res.setHeader('Cache-Control', 'private, no-store');

        return new StreamableFile(fs.createReadStream(resolved.absolutePath));
    }
}

const MIME_BY_EXT: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
};
