import { Module } from '@nestjs/common';
import { FoldersController } from './folders/folders.controller';
import { FoldersService } from './folders/folders.service';
import { UploadTokenGuard } from './upload-token.guard';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * UploadsModule — Phase 5+ extraction of the upload subsystem from CoursesModule.
 *
 * Owns:
 *   - BFF-bypass file upload (POST /token + POST /file)  — CRS-05 (Phase 5 Plan 04)
 *   - Upload registry (GET /uploads, DELETE /uploads/:id) — used by the admin
 *     file-library UI and future GC of orphaned files.
 *
 * Why a dedicated module: uploads are not a courses concern — banners, blogs,
 * stories, quizzes all consume the upload endpoint too. Keeping it in
 * CoursesModule was a Phase-5 expedient; cross-feature reuse makes a top-level
 * module the right home.
 *
 * PrismaModule + RedisModule + AuditModule (interceptor) are @Global() in
 * AppModule so we don't list them as imports here.
 */
@Module({
    controllers: [UploadsController, FoldersController],
    providers: [UploadsService, UploadTokenGuard, FoldersService],
    exports: [FoldersService],
})
export class UploadsModule {}
