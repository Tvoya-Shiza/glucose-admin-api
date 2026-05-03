import {
    Body,
    Controller,
    Headers,
    HttpCode,
    HttpStatus,
    Post,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Audit } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { UploadTokenRequestDto } from './dto/upload-token.dto';
import { UploadTokenGuard } from './upload-token.guard';
import { UploadsService } from './uploads.service';

/**
 * UploadsController — CRS-05 (Phase 5 Plan 04).
 *
 * Routes:
 *   POST /admin-api/v1/admin/uploads/token   (admin/teacher; via BFF + admin Bearer)
 *   POST /admin-api/v1/admin/uploads/file    (BFF-BYPASS; X-Upload-Token credential)
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
    @UseGuards(JwtGuard, RolesGuard)
    @Roles('admin', 'teacher')
    @Audit('courses.upload.token', 'file')
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
    @Audit('courses.upload.file', 'file')
    @HttpCode(HttpStatus.OK)
    public acceptUpload(
        @Headers('x-upload-token') headerToken: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.service.acceptUpload(headerToken, file);
    }
}
