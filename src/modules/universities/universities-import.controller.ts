import {
    BadRequestException,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    Res,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { UniversitiesImportService, type ImportKind } from './universities-import.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const VALID_KINDS: ImportKind[] = ['universities', 'specialties', 'admission_stats'];

function assertKind(value: string): ImportKind {
    if (!VALID_KINDS.includes(value as ImportKind)) {
        throw new BadRequestException(`invalid_kind:${value}`);
    }
    return value as ImportKind;
}

/**
 * Endpoints under `/admin-api/v1/admin/universities`:
 *   GET   /template/:kind                  — empty template with dropdowns
 *   POST  /export/:kind                    — populated export (round-trippable)
 *   POST  /import?kind=...&mode=...        — multipart upload + classify (dry_run / commit)
 *
 * `kind ∈ {universities, specialties, admission_stats}` discriminates which template
 * and import pipeline runs. Permission codes are kind-derived (universities.import,
 * specialties.import, admission_stats.import).
 *
 * Audit: every endpoint emits an audit row even on dry-run (mirrors users-import).
 */
@Controller('admin-api/v1/admin/universities')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UniversitiesImportController {
    constructor(private readonly svc: UniversitiesImportService) {}

    @Get('template/:kind')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('universities.view')
    @Throttle({ default: { limit: 30, ttl: 60_000 } })
    public async template(@Param('kind') kindRaw: string, @Res() res: Response): Promise<void> {
        const kind = assertKind(kindRaw);
        const buf = await this.svc.buildTemplate(kind);
        const filename = kind === 'admission_stats' ? 'AdmissionStats' : kind === 'specialties' ? 'Specialties' : 'Universities';
        res.setHeader('Content-Type', XLSX_MIME);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        res.send(buf);
    }

    @Post('export/:kind')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('universities.view')
    @Audit('universities.export', 'university')
    @Throttle({ default: { limit: 10, ttl: 900_000 } })
    @HttpCode(HttpStatus.OK)
    public async export(@Param('kind') kindRaw: string, @Res() res: Response): Promise<void> {
        const kind = assertKind(kindRaw);
        const buf = await this.svc.buildExport(kind);
        const ts = Math.floor(Date.now() / 1000);
        const filename = kind === 'admission_stats' ? 'AdmissionStats' : kind === 'specialties' ? 'Specialties' : 'Universities';
        res.setHeader('Content-Type', XLSX_MIME);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}-${ts}.xlsx"`);
        res.send(buf);
    }

    @Post('import')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('universities.import')
    @Audit('universities.import', 'university')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
        }),
    )
    public async import(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @UploadedFile() file: Express.Multer.File,
        @Query('kind') kindRaw: string,
        @Query('mode') modeRaw: string,
        @Query('bulk_op_id') bulkOpId?: string,
        @Query('confirmed_count') confirmedCountRaw?: string,
    ) {
        if (!file) throw new BadRequestException('file_required');
        const kind = assertKind(kindRaw);
        if (modeRaw !== 'dry_run' && modeRaw !== 'commit') throw new BadRequestException('invalid_mode');

        const confirmedCount = confirmedCountRaw === undefined ? undefined : Number(confirmedCountRaw);
        return this.svc.importFromBuffer(
            { id: actor.id, role_name: actor.role_name },
            file.buffer,
            { kind, mode: modeRaw, bulk_op_id: bulkOpId, confirmed_count: confirmedCount },
        );
    }
}
