import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListUploadsQueryDto } from './dto/list-uploads.dto';
import { MoveFileDto } from './dto/move-file.dto';
import { RenameFileDto } from './dto/rename-file.dto';
import { UploadTokenRequestDto } from './dto/upload-token.dto';
import { UploadTokenGuard } from './upload-token.guard';
import { UploadsService } from './uploads.service';

/**
 * UploadsController — Phase 5 Plan 04 (CRS-05) + Phase 5+ file-library extension.
 *
 * Routes:
 *   POST   /admin-api/v1/admin/uploads/token  (admin/teacher; via BFF + admin Bearer)
 *   POST   /admin-api/v1/admin/uploads/file   (BFF-BYPASS; X-Upload-Token credential)
 *   GET    /admin-api/v1/admin/uploads        (admin/teacher/curator; list + filter)
 *   DELETE /admin-api/v1/admin/uploads/:id    (admin/teacher; soft-delete + unlink)
 *
 * The /file endpoint deliberately does NOT use JwtGuard. The admin Bearer cookie
 * is intentionally NOT trusted on this route per CONTEXT D-13 — the browser hits
 * admin-api directly without going through the Next.js BFF, and the X-Upload-Token
 * header (a 5-min single-use JWT) IS the credential. UploadTokenGuard verifies the
 * token and populates req.user from its claims so the global AuditInterceptor can
 * attribute the row to the issuing actor.
 *
 * Multer config: memoryStorage with fileSize = 200MB (largest kind cap = video).
 * Per-kind size enforcement happens in UploadsService against the token's claim,
 * so a token issued for kind=image (10MB cap) still rejects a 50MB upload even
 * though Multer admitted it.
 */
@Controller('admin-api/v1/admin/uploads')
export class UploadsController {
    constructor(private readonly service: UploadsService) {}

    @Post('token')
    @UseGuards(JwtGuard, RolesGuard, PermissionGuard)
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('files.create')
    @Audit('uploads.token', 'file')
    @HttpCode(HttpStatus.OK)
    public issueToken(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: UploadTokenRequestDto) {
        return this.service.issueToken(actor, dto);
    }

    @Post('file')
    @UseGuards(UploadTokenGuard)
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 200 * 1024 * 1024 },
        }),
    )
    @Audit('uploads.file', 'file')
    @HttpCode(HttpStatus.OK)
    public acceptUpload(@Headers('x-upload-token') headerToken: string, @UploadedFile() file: Express.Multer.File) {
        return this.service.acceptUpload(headerToken, file);
    }

    @Get()
    @UseGuards(JwtGuard, RolesGuard, PermissionGuard)
    @Roles('admin', 'teacher', 'curator')
    @RequirePermission('files.view')
    public list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListUploadsQueryDto) {
        return this.service.listUploads(actor, query);
    }

    @Patch(':id/move')
    @UseGuards(JwtGuard, RolesGuard, PermissionGuard)
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('files.create')
    @Audit('uploads.move', 'upload')
    public move(@Param('id') id: string, @Body() dto: MoveFileDto) {
        return this.service.moveFile(id, dto.folder_id ?? null);
    }

    @Patch(':id/rename')
    @UseGuards(JwtGuard, RolesGuard, PermissionGuard)
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('files.create')
    @Audit('uploads.rename', 'upload')
    public rename(@Param('id') id: string, @Body() dto: RenameFileDto) {
        return this.service.renameFile(id, dto.original_name);
    }

    /**
     * Replace an asset's content IN PLACE — same BFF-bypass trust model as
     * /file (X-Upload-Token IS the credential, admin Bearer not trusted here).
     * The asset id comes from the path; the token authorizes an actor with
     * files.create rights. file_url stays identical (same MIME → same filename).
     */
    @Post(':id/replace')
    @UseGuards(UploadTokenGuard)
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 200 * 1024 * 1024 },
        }),
    )
    @Audit('uploads.replace', 'upload')
    @HttpCode(HttpStatus.OK)
    public replace(
        @Param('id') id: string,
        @Headers('x-upload-token') headerToken: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.service.replaceFile(id, headerToken, file);
    }

    @Delete(':id')
    @UseGuards(JwtGuard, RolesGuard, PermissionGuard)
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('files.delete')
    @Audit('uploads.delete', 'upload')
    @HttpCode(HttpStatus.NO_CONTENT)
    public async remove(@Param('id') id: string): Promise<void> {
        await this.service.deleteUpload(id);
    }
}
